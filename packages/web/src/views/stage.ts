import { fitText, liveView, occurrenceText, renderLines } from "../chart";
import { h, mount } from "../dom";
import type { LiveClient, LiveSnapshot } from "../live";

/**
 * Portrait band display (spec §21): current section, exact variant,
 * repetition or vamp, next section, key and MD cues. It only follows band
 * state; nothing here can change it.
 */
export function stageView(root: HTMLElement, live: LiveClient): () => void {
  document.body.dataset.view = "stage";
  const screen = h("div", { class: "stage" });
  mount(root, screen);

  const render = (snap: LiveSnapshot) => {
    const state = snap.status?.state ?? null;
    const view = liveView(state, snap.content);
    const chart = h("div", { class: "stage-chart" });

    let footer: HTMLElement;
    if (view.status === "ended") footer = h("div", { class: "stage-next ended" }, "ENDED");
    else if (view.vamping) footer = h("div", { class: "stage-next" }, h("span", { class: "muted" }, "EXIT TO: "), occurrenceText(view.next?.section, view.next?.occ) || "END");
    else if (view.next) footer = h("div", { class: "stage-next" }, h("span", { class: "muted" }, view.status === "ready" ? "FIRST: " : "NEXT: "), occurrenceText(view.next.section, view.next.occ));
    else footer = h("div", { class: "stage-next" }, view.status === "active" ? h("span", { class: "muted" }, "LAST SECTION") : "");

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
      if (view.current) chart.append(renderLines(view.current.section.lines, view.semitones));
    }

    mount(
      screen,
      h(
        "header",
        { class: "stage-top" },
        h("span", { class: "stage-title" }, (snap.content?.title ?? "SetFlow").toUpperCase()),
        view.key ? h("span", { class: "stage-key" }, view.key) : null,
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
  };
}
