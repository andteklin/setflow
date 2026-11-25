import {
  fitText,
  liveView,
  occurrenceLines,
  occurrenceText,
  previewLines,
  renderLines,
  serviceView,
  type DisplayMode,
} from "../chart";
import { h, mount } from "../dom";
import type { LiveSnapshot } from "../live";
import { sectionMap } from "../sectionMap";

/** The next section's opening lines to preview. */
const PREVIEW_LINES = 2;

export interface StageRenderer {
  /** Root element containing the complete Stage display. */
  el: HTMLElement;

  /** Render the latest network-delivered snapshot. */
  render(snapshot: LiveSnapshot): void;

  /** Remove event listeners and release renderer resources. */
  dispose(): void;
}

/**
 * Shared Stage display renderer.
 *
 * Used by both Stage View clients and the Control View Stage View tab.
 * Receives the same LiveSnapshot supplied by LiveClient, ensuring that
 * both displays use the same session state, content and rendering logic.
 *
 * This renderer does not:
 * - Establish network connections.
 * - Fetch or reconstruct song lyrics.
 * - Control the performance.
 * - Handle clicker input.
 * - Manage display preferences.
 */
export function stageRenderer(
  display: DisplayMode = "chords",
): StageRenderer {
  // These elements persist across renders so the section map retains its
  // scroll position and internal state.
  const top = h("header", { class: "stage-top" });
  const map = sectionMap();
  const body = h("div", { class: "stage-body" });
  const screen = h("div", { class: "stage" }, top, map.el, body);

  let disposed = false;
  let resizeFrame = 0;

  const render = (snap: LiveSnapshot): void => {
    if (disposed) return;

    const state = snap.status?.state ?? null;
    const view = liveView(state, snap.content);
    const service = serviceView(snap.status);

    // Update the section map using the same authoritative state and
    // content that Stage View receives.
    map.update(state, snap.content);

    // Stage header.
    mount(
      top,
      h(
        "span",
        { class: "stage-title" },
        (snap.content?.title ?? "SetFlow").toUpperCase(),
      ),
      h(
        "span",
        { class: "row" },
        service.position
          ? h("span", { class: "stage-position" }, service.position.toUpperCase())
          : null,
        view.key
          ? h("span", { class: "stage-key" }, view.key)
          : null,
      ),
    );

    // Preview the opening lines of the next section.
    const preview = view.next
      ? h(
          "div",
          { class: "stage-next-preview" },
          renderLines(
            previewLines(
              occurrenceLines(
                snap.content,
                view.next.occ,
                view.next.section,
              ),
              PREVIEW_LINES,
            ),
            view.semitones,
            { mode: display, key: view.key },
          ),
        )
      : null;

    const nextSong = service.nextSong
      ? h(
          "div",
          null,
          h("span", { class: "muted" }, "NEXT SONG: "),
          service.nextSong.toUpperCase(),
        )
      : null;

    // Next-section / vamp / ended sidebar.
    let side: HTMLElement;

    if (view.status === "ended") {
      side = h(
        "aside",
        { class: nextSong ? "stage-next" : "stage-next ended" },
        nextSong ?? "ENDED",
      );
    } else if (view.vamping) {
      side = h(
        "aside",
        { class: "stage-next" },
        h(
          "div",
          null,
          h("span", { class: "muted" }, "EXIT TO: "),
          occurrenceText(view.next?.section, view.next?.occ) || "END",
        ),
        preview,
      );
    } else if (view.next) {
      side = h(
        "aside",
        { class: "stage-next" },
        h(
          "div",
          null,
          h(
            "span",
            { class: "muted" },
            view.status === "ready" ? "FIRST: " : "NEXT: ",
          ),
          occurrenceText(view.next.section, view.next.occ),
        ),
        preview,
      );
    } else {
      side = h(
        "aside",
        { class: "stage-next" },
        view.status === "active"
          ? [
              h("div", { class: "muted" }, "LAST SECTION"),
              nextSong,
            ]
          : "",
      );
    }

    // Current section and lyrics chart.
    const chart = h("div", { class: "stage-chart" });

    let heading: HTMLElement;

    if (view.status === "idle") {
      heading = h(
        "div",
        { class: "stage-current idle" },
        snap.status?.recovery ? "WAITING TO RESUME" : "WAITING FOR MD",
      );
    } else if (view.status === "ready") {
      heading = h(
        "div",
        { class: "stage-current idle" },
        "READY",
      );
    } else if (view.status === "ended") {
      heading = h(
        "div",
        { class: "stage-current idle" },
        "ENDED",
      );
    } else {
      heading = h(
        "div",
        { class: "stage-current" },
        h(
          "span",
          null,
          view.current?.section.sourceLabel.toUpperCase() ?? "",
        ),
        view.repetition && !view.vamping
          ? h("span", { class: "stage-rep" }, view.repetition)
          : null,
      );

      if (view.current) {
        chart.append(
          renderLines(
            occurrenceLines(
              snap.content,
              view.current.occ,
              view.current.section,
            ),
            view.semitones,
            { mode: display, key: view.key },
          ),
        );
      }
    }

    // Render the complete Stage body.
    mount(
      body,
      h(
        "main",
        { class: "stage-main" },

        // Preserve the last known state when disconnected.
        snap.connected
          ? null
          : h(
              "div",
              { class: "banner warn" },
              "Disconnected — last known state",
            ),

        heading,

        view.vamping
          ? h("div", { class: "vamp-badge" }, "VAMP — UNTIL CUE")
          : null,

        state?.cues.length
          ? h(
              "div",
              { class: "stage-cues" },
              state.cues.join(" · "),
            )
          : null,

        chart,
      ),
      side,
    );

    // Fit the lyrics to the available chart area.
    if (resizeFrame) cancelAnimationFrame(resizeFrame);

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (disposed || !screen.isConnected) return;

      if (chart.clientHeight === 0 || chart.clientWidth === 0) return;

      fitText(
        chart,
        Math.round(chart.clientHeight / 7),
        14,
      );
    });
  };

  const onResize = (): void => {
    map.reflow();
  };


  window.addEventListener("resize", onResize);

  return {
    el: screen,

    render(snapshot: LiveSnapshot): void {
      if (disposed) return;
      render(snapshot);
    },

    dispose(): void {
      if (disposed) return;

      disposed = true;

      window.removeEventListener("resize", onResize);

      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = 0;
      }
    },
  };
}
