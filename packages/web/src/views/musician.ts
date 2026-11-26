import { liveView, occurrenceLines, occurrenceText, renderLines, serviceView } from "../chart";
import { h, load, mount, save } from "../dom";
import type { LiveClient, LiveSnapshot } from "../live";

interface Prefs {
  zoom: number;
  theme: "dark" | "light";
}

/**
 * The whole chronological chart on a musician's own device (spec §22).
 * Follows the band until the musician scrolls; Return to Live resumes
 * following. Personal zoom, theme and scroll never reach the host.
 */
export function musicianView(root: HTMLElement, live: LiveClient): () => void {
  document.body.dataset.view = "musician";
  const prefs = load<Prefs>("setflow.musician", { zoom: 1, theme: "dark" });
  let following = true;
  let renderedFor = "";
  let lastCurrentOccurrenceId: string | null = null;

  const toolbar = h("header", { class: "musician-bar" });
  const list = h("main", { class: "musician-chart" });
  mount(root, toolbar, list);

  const applyPrefs = () => {
    document.documentElement.dataset.theme = prefs.theme;
    list.style.fontSize = `${prefs.zoom}rem`;
    save("setflow.musician", prefs);
  };

  const followCurrent = (smooth: boolean) => {
    const el =
      list.querySelector<HTMLElement>(".occurrence.current") ??
      list.querySelector<HTMLElement>(".occurrence.next");

    if (!el) {
      return;
    }

    const scrollRoot = document.scrollingElement as HTMLElement;
    const barHeight = toolbar.getBoundingClientRect().height;

    document.documentElement.style.setProperty(
      "--bar-height",
      `${barHeight}px`,
    );

    const before = {
      scrollTop: scrollRoot.scrollTop,
      targetTop: el.getBoundingClientRect().top,
      barHeight,
    };

    el.scrollIntoView({
      behavior: "instant",
      block: "start",
      inline: "nearest",
    });
  };

  const stopFollowing = () => {
    if (!following) return;
    following = false;
    render(live.current);
  };
  window.addEventListener("wheel", stopFollowing, { passive: true });
  window.addEventListener("touchmove", stopFollowing, { passive: true });
  const onKey = (e: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) stopFollowing();
  };
  window.addEventListener("keydown", onKey);

  const render = (snap: LiveSnapshot) => {
    const state = snap.status?.state ?? null;
    const view = liveView(state, snap.content);

    const signature = state && snap.content ? `${state.sessionId}|${state.performanceKey}|${state.sequence.map((o) => o.id).join(",")}` : "";
    if (signature !== renderedFor) {
      renderedFor = signature;
      const sections = new Map(snap.content?.sections.map((s) => [s.id, s]) ?? []);
      mount(
        list,
        state && snap.content
          ? state.sequence.map((occ) => {
              const section = sections.get(occ.sectionId)!;
              return h(
                "section",
                { class: "occurrence", "data-id": occ.id },
                h(
                  "h2",
                  null,
                  occurrenceText(section, occ),
                  occ.origin === "live" ? h("span", { class: "tag" }, "live") : null,
                  h("span", { class: "occ-badge" }),
                ),
                renderLines(occurrenceLines(snap.content, occ, section), view.semitones, { key: view.key }),
              );
            })
          : h("p", { class: "empty" }, snap.status?.recovery ? "Waiting for the MD to resume the performance…" : "Waiting for the MD to start a song…"),
      );
    }
    for (const el of list.querySelectorAll<HTMLElement>(".occurrence")) {
      const id = el.dataset.id;
      const isCurrent = id === state?.currentOccurrenceId;
      el.classList.toggle("current", isCurrent);
      el.classList.toggle("next", id === state?.nextOccurrenceId);
      el.querySelector(".occ-badge")!.textContent = isCurrent ? (view.vamping ? "VAMP — UNTIL CUE" : "NOW") : id === state?.nextOccurrenceId ? (view.vamping ? "EXIT TO" : "NEXT") : "";
    }

    const service = serviceView(snap.status);
    const liveText =
      view.status === "active"
        ? `${occurrenceText(view.current?.section, view.current?.occ)}${view.vamping ? " · VAMP" : ""} → ${occurrenceText(view.next?.section, view.next?.occ) || (service.nextSong ? `next song: ${service.nextSong}` : "end")}`
        : view.status === "ready"
          ? "Ready"
          : view.status === "ended"
            ? service.nextSong
              ? `Ended · next song: ${service.nextSong}`
              : "Ended"
            : "No song";
      mount(
        toolbar,
        h(
          "div",
          { class: "musician-bar-main" },
          h(
            "div",
            { class: "bar-title" },
            h("strong", null, snap.content?.title ?? "SetFlow"),
            view.key ? h("span", { class: "key-pill" }, view.key) : null,
            service.position ? h("span", { class: "muted small" }, service.position) : null,
          ),
          h(
            "div",
            { class: snap.connected ? "live-pill" : "live-pill stale" },
            snap.connected ? "● LIVE " : "○ Disconnected — last known: ", liveText,
          ),
          following
            ? null
            : h("button", {
                class: "primary",
                onclick: () => {
                  following = true;
                  render(live.current);
                  followCurrent(true);
                },
              }, "Return to Current Verse"),
          h(
            "div",
            { class: "bar-tools" },
            h("button", {
              title: "Smaller",
              onclick: () => {
                prefs.zoom = Math.max(0.6, +(prefs.zoom - 0.1).toFixed(2));
                applyPrefs();
              },
            }, "A-"),
            h("button", {
              title: "Larger",
              onclick: () => {
                prefs.zoom = Math.min(2.5, +(prefs.zoom + 0.1).toFixed(2));
                applyPrefs();
              },
            }, "A+"),
            h("button", {
              title: "Light/dark",
              onclick: () => {
                prefs.theme = prefs.theme === "dark" ? "light" : "dark";
                applyPrefs();
              },
            }, "☀"),
          ),
        ),
        state?.cues.length
          ? h(
              "div",
              { class: "musician-cues" },
              state.cues.join(" · "),
            )
          : null,
      );
    const currentOccurrenceId = state?.currentOccurrenceId ?? null;

    const occurrenceChanged =
      currentOccurrenceId !== lastCurrentOccurrenceId;

    lastCurrentOccurrenceId = currentOccurrenceId;

    if (following && occurrenceChanged) {
      followCurrent(true);
    }
  };

  applyPrefs();
  const unsubscribe = live.subscribe(render);
  return () => {
    unsubscribe();
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("wheel", stopFollowing);
    window.removeEventListener("touchmove", stopFollowing);
    delete document.documentElement.dataset.theme;
  };
}
