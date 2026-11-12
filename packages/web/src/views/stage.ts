import { fitText, liveView, occurrenceLines, occurrenceText, previewLines, renderLines, serviceView } from "../chart";
import { api, clientId } from "../api";
import { h, mount } from "../dom";
import type { LiveClient, LiveSnapshot } from "../live";

/** How many lines of the next section the footer previews. */
const NEXT_PREVIEW_LINES = 2;

/** Keys a presentation clicker sends: forward and back. Anything else (blackout, F5) is ignored. */
const CLICKER_KEYS: Record<string, "NEXT" | "PREVIOUS"> = {
  ArrowRight: "NEXT",
  ArrowDown: "NEXT",
  PageDown: "NEXT",
  " ": "NEXT",
  ArrowLeft: "PREVIOUS",
  ArrowUp: "PREVIOUS",
  PageUp: "PREVIOUS",
};

/**
 * Portrait band display (spec §21): current section, exact variant,
 * repetition or vamp, next section, key and MD cues. It shows band state and
 * never decides it. A presentation clicker plugged into this computer can
 * send NEXT and PREVIOUS (issue #4), but only when this browser is the
 * conductor or the MD has approved it as an input; the host stays in charge.
 */
export function stageView(root: HTMLElement, live: LiveClient): () => void {
  document.body.dataset.view = "stage";
  const screen = h("div", { class: "stage" });
  const corner = h("div", { class: "stage-input" });
  mount(root, screen, corner);

  let note = "";
  let noteTimer = 0;
  const flash = (text: string) => {
    note = text;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => ((note = ""), renderCorner(live.current)), 2500);
    renderCorner(live.current);
  };

  const onKey = (e: KeyboardEvent) => {
    const type = CLICKER_KEYS[e.key];
    if (!type || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (live.isConductor) {
      e.preventDefault();
      live.command({ type }).then((ack) => !ack.accepted && flash(ack.message), (err: Error) => flash(err.message));
    } else if (live.isPairedInput) {
      e.preventDefault();
      void live.input(type).then((why) => why && flash(why));
    }
  };
  window.addEventListener("keydown", onKey);

  // The pairing control stays out of the band's way: it shows only while the mouse moves.
  let revealTimer = 0;
  const onMouse = () => {
    corner.classList.add("reveal");
    clearTimeout(revealTimer);
    revealTimer = window.setTimeout(() => corner.classList.remove("reveal"), 4000);
  };
  window.addEventListener("mousemove", onMouse);

  const renderCorner = (snap: LiveSnapshot) => {
    const pending = snap.inputs?.pending.some((r) => r.clientId === clientId) ?? false;
    corner.classList.toggle("pinned", pending || note !== "");
    mount(
      corner,
      note
        ? h("span", null, note)
        : live.isConductor
          ? h("span", null, "Clicker: this browser is conducting")
          : live.isPairedInput
            ? h("span", null, "Clicker on — approved by the MD")
            : pending
              ? h("span", null, "Waiting for the MD to allow this clicker…")
              : h(
                  "button",
                  {
                    disabled: !snap.connected,
                    onclick: () => void api("POST", "/api/inputs/request", { clientId, label: "Stage display" }).catch((err: Error) => flash(err.message)),
                  },
                  "Use a clicker here",
                ),
    );
  };

  const render = (snap: LiveSnapshot) => {
    renderCorner(snap);
    const state = snap.status?.state ?? null;
    const view = liveView(state, snap.content);
    const chart = h("div", { class: "stage-chart" });

    // The opening lines of what comes next, so the band can see it coming (issue #3).
    const preview = view.next
      ? h("div", { class: "stage-next-preview" }, renderLines(previewLines(occurrenceLines(snap.content, view.next.occ, view.next.section), NEXT_PREVIEW_LINES), view.semitones))
      : null;

    const service = serviceView(snap.status);
    const nextSong = service.nextSong ? h("div", null, h("span", { class: "muted" }, "NEXT SONG: "), service.nextSong.toUpperCase()) : null;

    let footer: HTMLElement;
    if (view.status === "ended") footer = h("div", { class: nextSong ? "stage-next" : "stage-next ended" }, nextSong ?? "ENDED");
    else if (view.vamping) footer = h("div", { class: "stage-next" }, h("div", null, h("span", { class: "muted" }, "EXIT TO: "), occurrenceText(view.next?.section, view.next?.occ) || "END"), preview);
    else if (view.next) footer = h("div", { class: "stage-next" }, h("div", null, h("span", { class: "muted" }, view.status === "ready" ? "FIRST: " : "NEXT: "), occurrenceText(view.next.section, view.next.occ)), preview);
    else footer = h("div", { class: "stage-next" }, view.status === "active" ? [h("div", { class: "muted" }, "LAST SECTION"), nextSong] : "");

    let heading: HTMLElement;
    if (view.status === "idle") heading = h("div", { class: "stage-current idle" }, snap.status?.recovery ? "WAITING TO RESUME" : "WAITING FOR MD");
    else if (view.status === "ready") heading = h("div", { class: "stage-current idle" }, "READY");
    else if (view.status === "ended") heading = h("div", { class: "stage-current idle" }, "ENDED");
    else {
      heading = h(
        "div",
        { class: "stage-current" },
        h("span", null, view.current?.section.sourceLabel.toUpperCase() ?? ""),
        view.repetition && !view.vamping ? h("span", { class: "stage-rep" }, view.repetition) : null,
      );
      if (view.current) chart.append(renderLines(occurrenceLines(snap.content, view.current.occ, view.current.section), view.semitones));
    }

    mount(
      screen,
      h(
        "header",
        { class: "stage-top" },
        h("span", { class: "stage-title" }, (snap.content?.title ?? "SetFlow").toUpperCase()),
        h(
          "span",
          { class: "row" },
          service.position ? h("span", { class: "stage-position" }, service.position.toUpperCase()) : null,
          view.key ? h("span", { class: "stage-key" }, view.key) : null,
        ),
      ),
      snap.connected ? null : h("div", { class: "banner warn" }, "Disconnected — last known state"),
      heading,
      view.vamping ? h("div", { class: "vamp-badge" }, "VAMP — UNTIL CUE") : null,
      state?.cues.length ? h("div", { class: "stage-cues" }, state.cues.join(" · ")) : null,
      chart,
      footer,
    );
    requestAnimationFrame(() => fitText(chart, Math.round(window.innerHeight / 22), 14));
  };

  const unsubscribe = live.subscribe(render);
  const onResize = () => render(live.current);
  window.addEventListener("resize", onResize);
  return () => {
    unsubscribe();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("mousemove", onMouse);
    clearTimeout(noteTimer);
    clearTimeout(revealTimer);
  };
}
