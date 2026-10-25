import type { PerformanceCommand } from "@setflow/core";
import type { LiveStatus } from "@setflow/server/protocol";
import { api, clientId } from "../api";
import { liveView, occurrenceText, renderLines } from "../chart";
import { h, isTyping, mount } from "../dom";
import type { LiveClient, LiveSnapshot } from "../live";

export const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** What the MD can start from: the song and arrangement selected in the library. */
export interface StartTarget {
  songId: string;
  songTitle: string;
  arrangementId: string;
  arrangementName: string;
  performanceKey: string;
  ready: boolean;
}

/** Keyboard equivalents (spec §19.3). Common USB foot pedals send arrows or Page Up/Down. */
const SHORTCUTS: Record<string, PerformanceCommand["type"]> = {
  ArrowRight: "NEXT",
  PageDown: "NEXT",
  " ": "NEXT",
  ArrowLeft: "PREVIOUS",
  PageUp: "PREVIOUS",
  r: "REPEAT",
  v: "VAMP",
  End: "END",
};

/**
 * The live conducting panel of Control View (spec §20, §2.7): routine
 * actions are one press, with every exact section variant visible as a jump.
 */
export function livePanel(live: LiveClient, getTarget: () => StartTarget | null) {
  const el = h("aside", { class: "live-panel" });
  let message = "";
  let messageIsError = false;

  const flash = (text: string, isError = false) => {
    message = text;
    messageIsError = isError;
    render(live.current);
  };

  const send = async (command: PerformanceCommand) => {
    try {
      const ack = await live.command(command);
      if (!ack.accepted) flash(ack.message, true);
      else if (message) flash("");
    } catch (err) {
      flash((err as Error).message, true);
    }
  };

  const post = async (route: string, body: unknown) => {
    try {
      live.refresh(await api<LiveStatus>("POST", route, body));
      flash("");
    } catch (err) {
      flash((err as Error).message, true);
    }
  };

  const jumpTargets = (snap: LiveSnapshot) => snap.content?.sections ?? [];

  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || !live.isConductor) return;
    const state = live.current.status?.state;
    if (!state || state.status === "ended") return;
    const type = SHORTCUTS[e.key] ?? SHORTCUTS[e.key.toLowerCase()];
    if (type) {
      e.preventDefault();
      if (type === "END" && !confirm("End the performance?")) return;
      void send({ type } as PerformanceCommand);
      return;
    }
    const digit = "1234567890".indexOf(e.key);
    const target = digit >= 0 ? jumpTargets(live.current)[digit] : undefined;
    if (target) {
      e.preventDefault();
      void send({ type: "JUMP", sectionId: target.id });
    }
  };
  window.addEventListener("keydown", onKey);

  const render = (snap: LiveSnapshot) => {
    cueFocused = document.activeElement instanceof HTMLInputElement && document.activeElement.closest(".cues") !== null;
    const status = snap.status;
    const state = status?.state ?? null;
    const view = liveView(state, snap.content);
    const conducting = status?.controllerId === clientId;
    const target = getTarget();
    const running = state && state.status !== "ended";

    const startBox = h(
      "div",
      { class: "card" },
      h("h3", null, running ? "Start another song" : "Start performance"),
      target
        ? h("p", null, h("strong", null, target.songTitle), " — ", target.arrangementName, target.performanceKey ? ` · Key ${target.performanceKey}` : "")
        : h("p", { class: "muted" }, "Select a song and arrangement in the library."),
      h(
        "button",
        {
          class: running ? "" : "primary big",
          disabled: !target?.ready || !snap.connected,
          onclick: () => {
            if (!target) return;
            if (running && !confirm(`Stop "${status?.title}" and start "${target.songTitle}"?`)) return;
            void post("/api/session/start", {
              songId: target.songId,
              arrangementId: target.arrangementId,
              performanceKey: target.performanceKey || undefined,
              controllerId: clientId,
            });
          },
        },
        running ? "Start selected song" : "Start",
      ),
    );

    const recovery = status?.recovery
      ? h(
          "div",
          { class: "card warn" },
          h("h3", null, "Unfinished performance found"),
          h("p", null, h("strong", null, status.recovery.title), " — ", status.recovery.arrangementName, h("br"), "Last at: ", status.recovery.current ?? "not started", h("br"), h("span", { class: "muted" }, new Date(status.recovery.savedAt).toLocaleString())),
          h("p", { class: "muted" }, "Resuming shows that position again; it does not advance the band."),
          h(
            "div",
            { class: "row" },
            h("button", { class: "primary", onclick: () => void post("/api/recovery/resume", { controllerId: clientId }) }, "Resume"),
            h("button", { onclick: () => void post("/api/recovery/discard", {}) }, "Discard"),
          ),
        )
      : null;

    const transport =
      state && running
        ? [
            conducting
              ? null
              : h(
                  "div",
                  { class: "card warn" },
                  h("p", null, "Another device is conducting this performance."),
                  h("button", { onclick: () => void post("/api/session/control", { controllerId: clientId }) }, "Take control here"),
                ),
            h(
              "div",
              { class: "now" },
              h("div", { class: "now-label" }, view.status === "ready" ? "READY" : "CURRENT"),
              h("div", { class: "now-section" }, view.current ? occurrenceText(view.current.section, view.current.occ) : "—"),
              view.vamping ? h("div", { class: "vamp-badge" }, "VAMP — UNTIL CUE") : null,
              h("div", { class: "now-next" }, view.vamping ? "Exit to: " : "Next: ", occurrenceText(view.next?.section, view.next?.occ) || (view.status === "active" ? "end" : "—")),
            ),
            h(
              "div",
              { class: "transport" },
              h("button", { disabled: !conducting, onclick: () => void send({ type: "PREVIOUS" }), title: "← or Page Up" }, "◀ PREV"),
              h("button", { class: "primary next", disabled: !conducting, onclick: () => void send({ type: "NEXT" }), title: "→, Space or Page Down" }, view.status === "ready" ? "START ▶" : "NEXT ▶"),
              h("button", { disabled: !conducting || view.status !== "active", onclick: () => void send({ type: "REPEAT" }), title: "R" }, "REPEAT"),
              h("button", { class: view.vamping ? "active" : "", disabled: !conducting || view.status !== "active", onclick: () => void send({ type: "VAMP" }), title: "V" }, "VAMP"),
              h("button", { class: "danger", disabled: !conducting, onclick: () => confirm("End the performance?") && void send({ type: "END" }), title: "End key" }, "END"),
            ),
            h("h4", null, "Jump to"),
            h(
              "div",
              { class: "jumps" },
              jumpTargets(snap).map((s, i) =>
                h(
                  "button",
                  {
                    class: view.current?.section.id === s.id ? "jump active" : "jump",
                    disabled: !conducting,
                    title: `${s.sourceLabel}${i < 10 ? ` — key ${(i + 1) % 10}` : ""}`,
                    onclick: () => void send({ type: "JUMP", sectionId: s.id }),
                  },
                  h("span", { class: "token" }, s.token),
                  i < 10 ? h("span", { class: "hotkey" }, String((i + 1) % 10)) : null,
                ),
              ),
            ),
            h(
              "div",
              { class: "row" },
              h("label", null, "Key "),
              h(
                "select",
                {
                  disabled: !conducting,
                  onchange: (e: Event) => void post("/api/session/key", { controllerId: clientId, performanceKey: (e.target as HTMLSelectElement).value }),
                },
                keyOptions(snap.content?.metadata.originalKey, state.performanceKey).map((k) =>
                  h("option", { value: k, selected: k === state.performanceKey }, k === snap.content?.metadata.originalKey ? `${k} (original)` : k),
                ),
              ),
            ),
            cueEditor(state.cues, conducting, (cues) => void post("/api/session/cues", { controllerId: clientId, cues })),
            view.current
              ? h("details", { class: "preview", open: true }, h("summary", null, "Current chart"), renderLines(view.current.section.lines, view.semitones))
              : null,
            state.liveDeviations.length
              ? h(
                  "details",
                  null,
                  h("summary", null, `Live changes (${state.liveDeviations.length})`),
                  h("ol", { class: "deviations" }, state.liveDeviations.slice(-12).map((d) => h("li", null, describe(d.command, snap)))),
                )
              : null,
          ]
        : state?.status === "ended"
          ? h("div", { class: "now" }, h("div", { class: "now-section" }, "ENDED"), h("p", { class: "muted" }, status?.title ?? ""))
          : null;

    mount(
      el,
      h("h2", null, "Live", status?.title ? h("span", { class: "muted" }, ` — ${status.title}`) : null),
      snap.connected ? null : h("div", { class: "banner warn" }, "Disconnected from the host — reconnecting…"),
      message ? h("div", { class: messageIsError ? "banner error" : "banner" }, message) : null,
      recovery,
      transport,
      startBox,
      h("p", { class: "muted small" }, "Keys: → / Space next · ← previous · R repeat · V vamp · 1–0 jump · End to end"),
    );
  };

  const unsubscribe = live.subscribe(render);
  return {
    el,
    refresh: () => render(live.current),
    dispose: () => {
      unsubscribe();
      window.removeEventListener("keydown", onKey);
    },
  };
}

function keyOptions(original: string | undefined, current: string): string[] {
  const minor = original?.endsWith("m") && !original.endsWith("maj");
  const keys = KEYS.map((k) => (minor ? `${k}m` : k));
  for (const k of [original, current]) if (k && !keys.includes(k)) keys.unshift(k);
  return keys;
}

// The panel re-renders on every band change; keep a half-typed cue and its focus across renders.
let cueDraft = "";
let cueFocused = false;

function cueEditor(cues: readonly string[], enabled: boolean, save: (cues: string[]) => void): HTMLElement {
  const input = h("input", {
    placeholder: "Cue for the band, e.g. Build into chorus",
    disabled: !enabled,
    value: cueDraft,
    oninput: () => (cueDraft = input.value),
  });
  if (cueFocused) requestAnimationFrame(() => input.focus());
  const submit = (e: Event) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    save([...cues, input.value.trim()]);
    cueDraft = "";
  };
  return h(
    "form",
    { class: "cues", onsubmit: submit },
    h("div", { class: "row" }, input, h("button", { type: "submit", disabled: !enabled }, "Cue")),
    cues.length
      ? h(
          "div",
          { class: "row wrap" },
          cues.map((c, i) => h("span", { class: "chip" }, c, h("button", { type: "button", class: "x", disabled: !enabled, onclick: () => save(cues.filter((_, j) => j !== i)) }, "×"))),
          h("button", { type: "button", disabled: !enabled, onclick: () => save([]) }, "Clear"),
        )
      : null,
  );
}

function describe(command: PerformanceCommand, snap: LiveSnapshot): string {
  if (command.type !== "JUMP") return command.type;
  const section = snap.content?.sections.find((s) => s.id === command.sectionId);
  return `JUMP → ${section?.sourceLabel ?? command.sectionId}`;
}
