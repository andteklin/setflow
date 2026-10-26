import type { MidiAction, MidiBinding, MidiEvent, MidiSettings, MidiStatus } from "@setflow/server/protocol";
import { api } from "../api";
import { h, mount } from "../dom";
import type { LiveClient } from "../live";

const TRANSPORT: MidiAction[] = [{ type: "NEXT" }, { type: "PREVIOUS" }, { type: "REPEAT" }, { type: "VAMP" }, { type: "END" }];

const actionKey = (a: MidiAction) => (a.type === "JUMP" ? `JUMP:${a.token.toUpperCase()}` : a.type);
const actionLabel = (a: MidiAction) => (a.type === "JUMP" ? `Jump ${a.token}` : a.type);
const eventLabel = (e: { kind: string; number: number; channel?: number }) =>
  `${e.kind === "note" ? "Note" : "CC"} ${e.number}${e.channel ? ` · ch ${e.channel}` : ""}`;

/**
 * MIDI controller setup in Control View (spec §19.3): pick the one host-
 * connected device and channel, learn a button for each action, and test
 * what each press does. Mappings are saved on the host.
 */
export function midiPanel(live: LiveClient) {
  const el = h("details", { class: "card midi" });
  let status: MidiStatus | null = null;
  let learning: MidiAction | null = null;
  /** The last press already seen when Learn was clicked; the next different one is learned. */
  let learnAfter: string | null = null;
  let error = "";

  const save = async (settings: MidiSettings) => {
    try {
      status = await api<MidiStatus>("PUT", "/api/midi", settings);
      error = "";
    } catch (err) {
      error = (err as Error).message;
    }
    render();
  };

  const bind = (action: MidiAction, event: MidiEvent) => {
    if (!status) return;
    const bindings = status.settings.bindings.filter(
      (b) => actionKey(b.action) !== actionKey(action) && !(b.kind === event.kind && b.number === event.number),
    );
    bindings.push({ kind: event.kind, number: event.number, action });
    void save({ ...status.settings, bindings });
  };

  const onStatus = (next: MidiStatus) => {
    status = next;
    const event = next.lastEvent;
    if (learning && event && event.at !== learnAfter) {
      const action = learning;
      learning = null;
      bind(action, event);
      return;
    }
    render();
  };

  function render() {
    if (!status) {
      mount(el, h("summary", null, "MIDI controller"), h("p", { class: "muted" }, "Loading…"));
      return;
    }
    const s = status.settings;
    const summary = h(
      "summary",
      null,
      "MIDI controller ",
      h(
        "span",
        { class: status.connected && s.enabled ? "dot ok small" : "dot bad small" },
        !status.available ? "unavailable" : status.connected ? (s.enabled ? `on · ${s.deviceName}` : `off · ${s.deviceName}`) : s.deviceName ? "not connected" : "not set up",
      ),
    );
    if (!status.available) {
      mount(el, summary, h("p", { class: "muted" }, status.unavailableReason ?? "MIDI is not available on this host.", " Keyboard and foot pedals that send keys still work."));
      return;
    }

    const tokens = new Set<string>(live.current.content?.sections.map((x) => x.token) ?? []);
    for (const b of s.bindings) if (b.action.type === "JUMP") tokens.add(b.action.token);
    const actions: MidiAction[] = [...TRANSPORT, ...[...tokens].map((token) => ({ type: "JUMP" as const, token }))];
    const bindingFor = (a: MidiAction): MidiBinding | undefined => s.bindings.find((b) => actionKey(b.action) === actionKey(a));

    const devices = [...status.devices];
    if (s.deviceName && !devices.includes(s.deviceName)) devices.unshift(s.deviceName);

    mount(
      el,
      summary,
      error ? h("div", { class: "banner error" }, error) : null,
      status.error ? h("div", { class: "banner warn" }, status.error) : null,
      h(
        "div",
        { class: "row wrap" },
        h("label", { class: "row tight" }, h("input", { type: "checkbox", checked: s.enabled, style: "width:auto", onchange: (e: Event) => void save({ ...s, enabled: (e.target as HTMLInputElement).checked }) }), "Use for conducting"),
      ),
      h(
        "div",
        { class: "row wrap" },
        h(
          "select",
          { onchange: (e: Event) => void save({ ...s, deviceName: (e.target as HTMLSelectElement).value || null }) },
          h("option", { value: "" }, devices.length ? "Choose a device…" : "No MIDI devices found"),
          devices.map((d) => h("option", { value: d, selected: d === s.deviceName }, status!.devices.includes(d) ? d : `${d} (not connected)`)),
        ),
        h(
          "select",
          { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; void save({ ...s, channel: v ? Number(v) : null }); } },
          h("option", { value: "" }, "Any channel"),
          Array.from({ length: 16 }, (_, i) => h("option", { value: String(i + 1), selected: s.channel === i + 1 }, `Channel ${i + 1}`)),
        ),
      ),
      h(
        "table",
        { class: "midi-map" },
        actions.map((a) => {
          const b = bindingFor(a);
          const isLearning = learning !== null && actionKey(learning) === actionKey(a);
          return h(
            "tr",
            null,
            h("td", null, actionLabel(a)),
            h("td", { class: "muted" }, isLearning ? "Press a button…" : b ? eventLabel(b) : "—"),
            h(
              "td",
              null,
              h("button", { class: isLearning ? "small active" : "small", onclick: () => { learning = isLearning ? null : a; learnAfter = status?.lastEvent?.at ?? null; render(); } }, isLearning ? "Cancel" : "Learn"),
              b ? h("button", { class: "small x", title: "Clear", onclick: () => void save({ ...s, bindings: s.bindings.filter((x) => x !== b) }) }, "×") : null,
            ),
          );
        }),
      ),
      h(
        "p",
        { class: "small" },
        "Test: ",
        status.lastEvent ? h("span", null, h("code", null, eventLabel(status.lastEvent)), " → ", status.lastResult ?? "") : h("span", { class: "muted" }, "press a button on the controller"),
      ),
      h("p", { class: "muted small" }, "Jump buttons name an exact section (C1A, C1C…). They work in any song that has that section."),
    );
  }

  const unsubscribe = live.onMidi(onStatus);
  // Jump rows list the sections of the song being performed.
  let shownSession: string | undefined;
  const unsubscribeLive = live.subscribe((snap) => {
    if (snap.content?.sessionId === shownSession) return;
    shownSession = snap.content?.sessionId;
    render();
  });
  void api<MidiStatus>("GET", "/api/midi").then(onStatus).catch(() => undefined);
  render();
  return {
    el,
    dispose: () => {
      unsubscribe();
      unsubscribeLive();
    },
  };
}
