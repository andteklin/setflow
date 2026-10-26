import { createRequire } from "node:module";
import type { PerformanceCommand } from "@setflow/core";
import type { MidiAction, MidiBinding, MidiEvent, MidiSettings, MidiStatus } from "./protocol.js";

export const DEFAULT_MIDI_SETTINGS: MidiSettings = { enabled: false, deviceName: null, channel: null, bindings: [] };

/** Ignore a second identical press this soon after the first: switch bounce, not a deliberate press. */
const BOUNCE_MS = 60;
const POLL_MS = 2000;

/** Decode one raw MIDI message. Only note and control-change messages matter for button input. */
export function decodeMidi(bytes: readonly number[]): Omit<MidiEvent, "press" | "at"> | null {
  const [status, number, value = 0] = bytes;
  if (status === undefined || number === undefined) return null;
  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  if (type === 0x90) return { kind: "note", channel, number, value };
  if (type === 0x80) return { kind: "note", channel, number, value: 0 };
  if (type === 0xb0) return { kind: "cc", channel, number, value };
  return null;
}

/**
 * Turns decoded messages into presses (spec §19.3): note-on with velocity
 * triggers, note-off and velocity 0 never do; a control change triggers only
 * when it crosses from released (< 64) to pressed (≥ 64).
 */
export class PressDetector {
  private readonly ccValues = new Map<string, number>();
  private readonly lastPress = new Map<string, number>();

  isPress(event: Omit<MidiEvent, "press" | "at">, now = Date.now()): boolean {
    const key = `${event.kind}:${event.channel}:${event.number}`;
    let press: boolean;
    if (event.kind === "note") {
      press = event.value > 0;
    } else {
      const previous = this.ccValues.get(key) ?? 0;
      this.ccValues.set(key, event.value);
      press = event.value >= 64 && previous < 64;
    }
    if (!press) return false;
    const last = this.lastPress.get(key);
    this.lastPress.set(key, now);
    return last === undefined || now - last >= BOUNCE_MS;
  }
}

export function findBinding(settings: MidiSettings, event: MidiEvent): MidiBinding | undefined {
  if (settings.channel !== null && settings.channel !== event.channel) return undefined;
  return settings.bindings.find((b) => b.kind === event.kind && b.number === event.number);
}

/** Resolve a mapped action against the song being performed; jumps name a section by its exact token. */
export function toCommand(action: MidiAction, sections: ReadonlyArray<{ id: string; token: string }>): PerformanceCommand | string {
  if (action.type !== "JUMP") return { type: action.type };
  const section = sections.find((s) => s.token.toLowerCase() === action.token.toLowerCase());
  return section ? { type: "JUMP", sectionId: section.id } : `This song has no section ${action.token}`;
}

/** A source of MIDI input ports. The real one wraps a native module; tests pass a fake. */
export interface MidiDriver {
  listPorts(): string[];
  /** Open a port by name; returns a function that closes it. */
  open(name: string, onMessage: (bytes: number[]) => void): () => void;
}

export function loadNativeDriver(): MidiDriver | Error {
  try {
    const midi = createRequire(import.meta.url)("@julusian/midi") as {
      Input: new () => {
        getPortCount(): number;
        getPortName(i: number): string;
        openPort(i: number): void;
        closePort(): void;
        ignoreTypes(sysex: boolean, timing: boolean, sensing: boolean): void;
        on(event: "message", fn: (delta: number, bytes: number[]) => void): void;
      };
    };
    const list = () => {
      const probe = new midi.Input();
      const names = Array.from({ length: probe.getPortCount() }, (_, i) => probe.getPortName(i));
      probe.closePort();
      return names;
    };
    return {
      listPorts: list,
      open(name, onMessage) {
        const input = new midi.Input();
        const index = Array.from({ length: input.getPortCount() }, (_, i) => input.getPortName(i)).indexOf(name);
        if (index < 0) throw new Error(`MIDI device "${name}" is not connected`);
        input.ignoreTypes(true, true, true);
        input.on("message", (_delta, bytes) => onMessage(bytes));
        input.openPort(index);
        return () => input.closePort();
      },
    };
  } catch (err) {
    return err as Error;
  }
}

export interface MidiTarget {
  /** Submit a command as the conducting controller. Returns an error message, or null when accepted. */
  conduct(command: PerformanceCommand, source: "midi"): string | null;
  /** Sections of the song being performed, for resolving jump tokens; empty when nothing is running. */
  sections(): ReadonlyArray<{ id: string; token: string }>;
}

/**
 * Host-side MIDI controller input (spec §19.3): one selected device, saved
 * mappings, a learn/test feed of the last press, and hot-unplug that only
 * affects this adapter while web and keyboard control keep working.
 */
export class MidiInput {
  private settings: MidiSettings;
  private readonly detector = new PressDetector();
  private close: (() => void) | null = null;
  private connectedName: string | null = null;
  private devices: string[] = [];
  private lastEvent: MidiEvent | null = null;
  private lastResult: string | null = null;
  private error: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(status: MidiStatus) => void>();

  constructor(
    private readonly driver: MidiDriver | Error,
    private readonly target: MidiTarget,
    settings: MidiSettings,
    private readonly saveSettings: (settings: MidiSettings) => void,
  ) {
    this.settings = settings;
    if (!(driver instanceof Error)) {
      this.refreshDevices();
      this.timer = setInterval(() => this.refreshDevices(), POLL_MS);
      this.timer.unref();
    }
  }

  onChange(listener: (status: MidiStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): MidiStatus {
    return {
      available: !(this.driver instanceof Error),
      unavailableReason: this.driver instanceof Error ? "MIDI support could not be loaded on this host" : null,
      devices: this.devices,
      connected: this.connectedName !== null,
      error: this.error,
      settings: this.settings,
      lastEvent: this.lastEvent,
      lastResult: this.lastResult,
    };
  }

  configure(next: MidiSettings): MidiStatus {
    const deviceChanged = next.deviceName !== this.settings.deviceName;
    this.settings = next;
    this.saveSettings(next);
    if (deviceChanged) this.disconnect();
    this.refreshDevices();
    this.emit();
    return this.status();
  }

  /** Handle one raw message. Public so tests and virtual devices can feed it. */
  receive(bytes: readonly number[]): void {
    const decoded = decodeMidi(bytes);
    if (!decoded) return;
    const press = this.detector.isPress(decoded);
    if (!press) return; // Releases never trigger and are not shown in the test feed.
    const event: MidiEvent = { ...decoded, press, at: new Date().toISOString() };
    this.lastEvent = event;

    const binding = findBinding(this.settings, event);
    if (!binding) this.lastResult = "Not mapped";
    else if (!this.settings.enabled) this.lastResult = `${label(binding.action)} (MIDI control is off)`;
    else {
      const command = toCommand(binding.action, this.target.sections());
      this.lastResult = typeof command === "string" ? command : (this.target.conduct(command, "midi") ?? label(binding.action));
    }
    this.emit();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.disconnect();
  }

  /** Rescan devices: connect the selected one when it appears, report it when it goes away. */
  refreshDevices(): void {
    if (this.driver instanceof Error) return;
    const before = `${this.devices.join("|")}/${this.connectedName}`;
    try {
      this.devices = this.driver.listPorts();
    } catch (err) {
      this.devices = [];
      this.error = (err as Error).message;
    }
    const wanted = this.settings.deviceName;
    if (this.connectedName && !this.devices.includes(this.connectedName)) {
      this.disconnect();
      this.error = `${wanted} was disconnected`;
    }
    if (wanted && !this.connectedName && this.devices.includes(wanted)) {
      try {
        this.close = this.driver.open(wanted, (bytes) => this.receive(bytes));
        this.connectedName = wanted;
        this.error = null;
      } catch (err) {
        this.error = (err as Error).message;
      }
    }
    if (`${this.devices.join("|")}/${this.connectedName}` !== before) this.emit();
  }

  private disconnect(): void {
    try {
      this.close?.();
    } catch {
      // The device may already be gone.
    }
    this.close = null;
    this.connectedName = null;
  }

  private emit(): void {
    const status = this.status();
    for (const l of this.listeners) l(status);
  }
}

function label(action: MidiAction): string {
  return action.type === "JUMP" ? `JUMP ${action.token}` : action.type;
}
