import type { PerformanceState, SectionOccurrence } from "@setflow/core";
import type { SessionContent } from "@setflow/server/protocol";
import type { ContentSection } from "./chart";
import { h, mount } from "./dom";

/**
 * The song map as a strip of section bubbles (V1 · C1A · B · B · E), like a
 * MultiTracks map. It follows the effective live sequence, so a live REPEAT
 * or JUMP adds its bubble. The current section is highlighted, played ones
 * dim, the next one is outlined, and the strip scrolls left to right with
 * the song, keeping the current bubble in view.
 */

/** Bubble colour family for a section type, so verses, choruses and bridges read at a glance. */
export function bubbleFamily(type: string): string {
  switch (type) {
    case "verse":
      return "verse";
    case "chorus":
    case "refrain":
    case "hook":
      return "chorus";
    case "prechorus":
    case "postchorus":
      return "pre";
    case "bridge":
    case "breakdown":
      return "bridge";
    case "custom":
      return "custom";
    default:
      return "inst"; // intro, instrumental, interlude, solo, tag, turnaround, vamp, ending, outro…
  }
}

export type BubbleState = "played" | "current" | "next" | "upcoming";

/** How each occurrence of the sequence should look right now. */
export function bubbleStates(state: PerformanceState): BubbleState[] {
  const pos = state.sequence.findIndex((o) => o.id === state.currentOccurrenceId);
  // Once ended, everything up to where it ended counts as played.
  const reached = state.status === "ended" ? state.sequence.findIndex((o) => o.id === state.endedFromOccurrenceId) : pos;
  return state.sequence.map((o, i) => {
    if (i === pos) return "current";
    if (o.id === state.nextOccurrenceId) return "next";
    if (state.status === "ended" ? reached < 0 || i <= reached : pos >= 0 && i < pos) return "played";
    return "upcoming";
  });
}

/** Where to scroll so the bubble starting at `offset` sits a third of the way across. */
export function scrollTarget(offset: number, viewWidth: number, contentWidth: number): number {
  const max = Math.max(0, contentWidth - viewWidth);
  return Math.max(0, Math.min(max, Math.round(offset - viewWidth / 3)));
}

export function sectionMap() {
  const el = h("nav", { class: "section-map", "aria-label": "Song map" });
  const track = h("ol", { class: "section-map-track" });
  el.append(track);
  el.hidden = true;
  let signature = "";
  let focusId: string | null = null;

  const bubble = (occ: SectionOccurrence, section: ContentSection | undefined) =>
    h(
      "li",
      {
        class: `map-bubble family-${bubbleFamily(section?.type ?? "custom")}${occ.origin === "live" ? " live" : ""}`,
        "data-id": occ.id,
        title: section ? `${section.sourceLabel}${occ.repetitionCount > 1 ? ` ${occ.repetitionIndex + 1}/${occ.repetitionCount}` : ""}${occ.origin === "live" ? " (live)" : ""}` : "",
      },
      h("span", { class: "token" }, section?.token ?? "?"),
      occ.repetitionCount > 1 ? h("span", { class: "pass" }, String(occ.repetitionIndex + 1)) : null,
    );

  // Fade an edge only while more bubbles lie beyond it (issue #17); at the start and end the strip is crisp.
  const updateFades = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle("fade-start", el.scrollLeft > 2);
    el.classList.toggle("fade-end", el.scrollLeft < max - 2);
  };
  el.addEventListener("scroll", updateFades, { passive: true });

  const scrollTo = (id: string | null, smooth: boolean) => {
    const target = id ? track.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) : null;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      left: target ? scrollTarget(target.offsetLeft, el.clientWidth, el.scrollWidth) : 0,
      behavior: smooth && !reduce ? "smooth" : "auto",
    });
    updateFades();
  };

  /** Show `state`. Bubbles are rebuilt only when the sequence changes, so scrolling stays smooth. */
  const update = (state: PerformanceState | null, content: SessionContent | null) => {
    if (!state || !content || content.sessionId !== state.sessionId || state.sequence.length === 0) {
      el.hidden = true;
      signature = "";
      mount(track);
      return;
    }
    el.hidden = false;
    const sig = `${state.sessionId}|${state.sequence.map((o) => `${o.id}:${o.sectionId}:${o.repetitionIndex}/${o.repetitionCount}`).join(",")}`;
    const rebuilt = sig !== signature;
    if (rebuilt) {
      signature = sig;
      const sections = new Map(content.sections.map((s) => [s.id, s]));
      mount(track, state.sequence.map((o) => bubble(o, sections.get(o.sectionId))));
    }
    const states = bubbleStates(state);
    [...track.children].forEach((li, i) => {
      for (const s of ["played", "current", "next"] as const) li.classList.toggle(s, states[i] === s);
      li.classList.toggle("vamping", states[i] === "current" && state.vamping);
    });
    // Follow the band: the current section, or the next one while not yet started.
    const focus = state.currentOccurrenceId ?? (state.status === "ended" ? state.endedFromOccurrenceId ?? null : state.nextOccurrenceId);
    if (focus !== focusId || rebuilt) {
      const first = focusId === null && !rebuilt;
      focusId = focus;
      requestAnimationFrame(() => scrollTo(focus, !first));
    }
  };

  /** Re-place the strip after the window is resized, without animating. */
  const reflow = () => requestAnimationFrame(() => scrollTo(focusId, false));

  return { el, update, reflow };
}
