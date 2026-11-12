import { HttpError } from "./library.js";
import type { InputDevice, InputDevicesStatus, InputRequest } from "./protocol.js";
import type { Store } from "./store.js";

/** Commands a paired input may send: a presentation clicker's forward and back. */
export const PAIRED_INPUT_COMMANDS = ["NEXT", "PREVIOUS"] as const;
export type PairedInputCommand = (typeof PAIRED_INPUT_COMMANDS)[number];

const SETTING = "inputDevices";
const MAX_PENDING = 10;

/**
 * Devices the MD has approved to send clicker presses, e.g. the Stage display
 * computer a presentation clicker is plugged into (issue #4). Approval is
 * explicit and revocable, and an approved device never conducts by itself:
 * the host submits its presses on behalf of the conducting controller, so
 * there is still exactly one conductor (spec §19.3).
 */
export class InputDevices {
  private approved: InputDevice[];
  private pending: InputRequest[] = [];
  private readonly listeners = new Set<(status: InputDevicesStatus) => void>();

  constructor(private readonly store: Store) {
    this.approved = store.getSetting<InputDevice[]>(SETTING) ?? [];
  }

  onChange(listener: (status: InputDevicesStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): InputDevicesStatus {
    return { approved: [...this.approved], pending: [...this.pending] };
  }

  isApproved(clientId: string | undefined): boolean {
    return clientId !== undefined && this.approved.some((d) => d.clientId === clientId);
  }

  /** A device asks to be allowed. Repeating the request just refreshes it. */
  request(clientId: unknown, label: unknown): InputDevicesStatus {
    const id = requireId(clientId);
    if (this.isApproved(id)) return this.status();
    const name = typeof label === "string" && label.trim() ? label.trim().slice(0, 60) : "Device";
    this.pending = [{ clientId: id, label: name, requestedAt: new Date().toISOString() }, ...this.pending.filter((r) => r.clientId !== id)].slice(0, MAX_PENDING);
    return this.changed();
  }

  approve(clientId: unknown): InputDevicesStatus {
    const id = requireId(clientId);
    const request = this.pending.find((r) => r.clientId === id);
    if (!request) throw new HttpError(404, "That device has not asked to be an input");
    this.pending = this.pending.filter((r) => r.clientId !== id);
    this.approved = [...this.approved, { clientId: id, label: request.label, approvedAt: new Date().toISOString() }];
    this.store.setSetting(SETTING, this.approved);
    return this.changed();
  }

  deny(clientId: unknown): InputDevicesStatus {
    const id = requireId(clientId);
    this.pending = this.pending.filter((r) => r.clientId !== id);
    return this.changed();
  }

  revoke(clientId: unknown): InputDevicesStatus {
    const id = requireId(clientId);
    this.approved = this.approved.filter((d) => d.clientId !== id);
    this.store.setSetting(SETTING, this.approved);
    return this.changed();
  }

  private changed(): InputDevicesStatus {
    const status = this.status();
    for (const listener of this.listeners) listener(status);
    return status;
  }
}

export function isPairedInputCommand(type: unknown): type is PairedInputCommand {
  return (PAIRED_INPUT_COMMANDS as readonly unknown[]).includes(type);
}

function requireId(clientId: unknown): string {
  if (typeof clientId !== "string" || clientId.trim() === "") throw new HttpError(400, "clientId is required");
  return clientId;
}
