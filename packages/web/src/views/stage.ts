import { fitText, liveView, occurrenceLines, occurrenceText, previewLines, renderLines, serviceView } from "../chart";
import { api, clientId } from "../api";
import { h, mount } from "../dom";
import type { LiveClient, LiveSnapshot } from "../live";
import { sectionMap } from "../sectionMap";

/** How many lines of the next section to preview: below the chart in portrait, beside it in landscape (issue #14). */
const PREVIEW_LINES = { portrait: 2, landscape: 6 };

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

/** True when the window is wider than tall. The CSS uses the same media query for the layout. */
const isLandscape = () => window.matchMedia("(orientation: landscape)").matches;

/**
 * Band display (spec §21): song map, current section, exact variant,
 * repetition or vamp, next section, key and MD cues. It shows band state and
 * never decides it. A presentation clicker plugged into this computer can
 * send NEXT and PREVIOUS (issue #4), but only when this browser is the
 * conductor or the MD has approved it as an input; the host stays in charge.
 *
 * Layout follows the window (issue #14): in portrait the next section sits
 * below the chart; in landscape, to its right.
 */
export function stageView(root: HTMLElement, live: LiveClient): () => void {
  document.body.dataset.view = "stage";
  // These stay in place across renders; only their contents change, so the map keeps its scroll position.
  const top = h("header", { class: "stage-top" });
  const map = sectionMap();
  const body = h("div", { class: "stage-body" });
  const screen = h("div", { class: "stage" }, top, map.el, body);
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
    const service = serviceView(snap.status);
    const landscape = isLandscape();
    map.update(state, snap.content);

    mount(
      top,
      h("span", { class: "stage-title" }, (snap.content?.title ?? "SetFlow").toUpperCase()),
      h(
        "span",
        { class: "row" },
        service.position ? h("span", { class: "stage-position" }, service.position.toUpperCase()) : null,
        view.key ? h("span", { class: "stage-key" }, view.key) : null,
      ),
    );

    // The opening lines of what comes next, so the band can see it coming (issue #3).
    const preview = view.next
      ? h(
          "div",
          { class: "stage-next-preview" },
          renderLines(previewLines(occurrenceLines(snap.content, view.next.occ, view.next.section), landscape ? PREVIEW_LINES.landscape : PREVIEW_LINES.portrait), view.semitones),
        )
      : null;
    const nextSong = service.nextSong ? h("div", null, h("span", { class: "muted" }, "NEXT SONG: "), service.nextSong.toUpperCase()) : null;

    let side: HTMLElement;
    if (view.status === "ended") side = h("aside", { class: nextSong ? "stage-next" : "stage-next ended" }, nextSong ?? "ENDED");
    else if (view.vamping) side = h("aside", { class: "stage-next" }, h("div", null, h("span", { class: "muted" }, "EXIT TO: "), occurrenceText(view.next?.section, view.next?.occ) || "END"), preview);
    else if (view.next) side = h("aside", { class: "stage-next" }, h("div", null, h("span", { class: "muted" }, view.status === "ready" ? "FIRST: " : "NEXT: "), occurrenceText(view.next.section, view.next.occ)), preview);
    else side = h("aside", { class: "stage-next" }, view.status === "active" ? [h("div", { class: "muted" }, "LAST SECTION"), nextSong] : "");

    const chart = h("div", { class: "stage-chart" });
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
      body,
      h(
        "main",
        { class: "stage-main" },
        snap.connected ? null : h("div", { class: "banner warn" }, "Disconnected — last known state"),
        heading,
        view.vamping ? h("div", { class: "vamp-badge" }, "VAMP — UNTIL CUE") : null,
        state?.cues.length ? h("div", { class: "stage-cues" }, state.cues.join(" · ")) : null,
        chart,
      ),
      side,
    );
    // Fill the space the chart has (issue #13): short sections grow, long ones shrink.
    requestAnimationFrame(() => fitText(chart, Math.round(window.innerHeight / 7), 14));
  };

  const unsubscribe = live.subscribe(render);
  const onResize = () => {
    render(live.current);
    map.reflow();
  };
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
