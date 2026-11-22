
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
import { api, clientId } from "../api";
import { h, load, mount, save } from "../dom";
import type { LiveClient, LiveSnapshot } from "../live";
import { sectionMap } from "../sectionMap";

/** The next section's opening lines to preview. */
const PREVIEW_LINES = 2;

/** Keys a presentation clicker sends: forward and back. */
const CLICKER_KEYS: Record<string, "NEXT" | "PREVIOUS"> = {
  ArrowRight: "NEXT",
  ArrowDown: "NEXT",
  PageDown: "NEXT",
  " ": "NEXT",
  ArrowLeft: "PREVIOUS",
  ArrowUp: "PREVIOUS",
  PageUp: "PREVIOUS",
};

interface StagePrefs {
  display: DisplayMode;
}

export function stageView(root: HTMLElement, live: LiveClient): () => void {
  document.body.dataset.view = "stage";

  const prefs = load<StagePrefs>("setflow.stage", { display: "chords" });

  const fromUrl = new URLSearchParams(
    location.hash.split("?")[1] ?? "",
  ).get("display");

  if (fromUrl === "chords" || fromUrl === "lyrics") {
    prefs.display = fromUrl;
    save("setflow.stage", prefs);
  }

  const setDisplay = (display: DisplayMode) => {
    prefs.display = display;
    save("setflow.stage", prefs);
    render(live.current);
  };


  let note = "";
  let noteTimer = 0;

  // Musician-local navigation state.
  let localOccurrenceId: string | null = null;
  let controllerOccurrenceId: string | null = null;
  let currentSessionId: string | null = null;

  const flash = (text: string) => {
    note = text;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      note = "";
      renderCorner(live.current);
    }, 2500);
    renderCorner(live.current);
  };

  /**
   * Navigate locally through the current song's occurrences.
   * This deliberately does not send a command to the controller.
   */
  const navigateOccurrence = (direction: -1 | 1) => {
    const snap = live.current;
    const state = snap.status?.state;
    const content = snap.content;

    if (!state || !content) return;

    const sequence = state.sequence;
    const controllerId = state.currentOccurrenceId;

    if (!controllerId) return;

    const controllerIndex = sequence.findIndex(
      (occ) => occ.id === controllerId,
    );

    if (controllerIndex < 0) return;

    // Find the bounds of the current song.
    // Occurrences are bounded by the current song's content.
    const songOccurrences = sequence.filter((occ) =>
      content.sections.some((section) => section.id === occ.sectionId),
    );

    const currentIndex = songOccurrences.findIndex(
      (occ) => occ.id === (localOccurrenceId ?? controllerId),
    );

    if (currentIndex < 0) return;

    const nextIndex = Math.max(
      0,
      Math.min(songOccurrences.length - 1, currentIndex + direction),
    );

    localOccurrenceId = songOccurrences[nextIndex].id;

    render(snap);
  };

  

  const previousVerse = () => navigateOccurrence(-1);
  const nextVerse = () => navigateOccurrence(1);


  const top = h("header", { class: "stage-top" });
  const map = sectionMap();
  const body = h("div", { class: "stage-body" });
  const corner = h("div", { class: "stage-input" });
  const screen = h(
    "div",
    { class: "stage" },
    top,
    map.el,
    body
  );

  mount(root, screen, corner);


  const onKey = (e: KeyboardEvent) => {
    const type = CLICKER_KEYS[e.key];

    if (!type || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;

    // Keyboard navigation is local to this musician's display.
    if (live.isConductor || live.isPairedInput) {
      e.preventDefault();

      if (type === "NEXT") nextVerse();
      else previousVerse();
    }
  };

  window.addEventListener("keydown", onKey);

  let revealTimer = 0;

  const onMouse = () => {
    corner.classList.add("reveal");
    clearTimeout(revealTimer);
    revealTimer = window.setTimeout(
      () => corner.classList.remove("reveal"),
      4000,
    );
  };

  window.addEventListener("mousemove", onMouse);
  window.addEventListener("pointerdown", onMouse);

  const renderCorner = (snap: LiveSnapshot) => {
    const pending =
      snap.inputs?.pending.some((r) => r.clientId === clientId) ?? false;

    corner.classList.toggle("pinned", pending || note !== "");

    const option = (display: DisplayMode, label: string) =>
      h(
        "button",
        {
          class: prefs.display === display ? "active" : "",
          "aria-pressed": String(prefs.display === display),
          onclick: () => setDisplay(display),
        },
        label,
      );

    mount(
      corner,
      h(
        "div",
        {
          class: "stage-display-mode",
          role: "group",
          "aria-label": "Show",
        },
        option("chords", "Lyrics + chords"),
        option("lyrics", "Lyrics only"),
      ),
      note
        ? h("span", null, note)
        : live.isConductor
          ? h("span", null, "Clicker: this browser is conducting")
          : live.isPairedInput
            ? h("span", null, "Clicker on - approved by the MD")
            : pending
              ? h("span", null, "Waiting for the MD to allow this clicker…")
              : h(
                  "button",
                  {
                    disabled: !snap.connected,
                    onclick: () =>
                      void api("POST", "/api/inputs/request", {
                        clientId,
                        label: "Stage display",
                      }).catch((err: Error) => flash(err.message)),
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

    map.update(state, snap.content);

    // Synchronize local navigation whenever the controller changes
    // occurrence or the session changes.
    const sessionId = snap.content?.sessionId ?? null;
    const controllerId = state?.currentOccurrenceId ?? null;

    if (
      sessionId !== currentSessionId ||
      controllerId !== controllerOccurrenceId
    ) {
      currentSessionId = sessionId;
      controllerOccurrenceId = controllerId;
      localOccurrenceId = controllerId;
    }

    // Resolve the locally selected occurrence.
    const sections = new Map(
      snap.content?.sections.map((section) => [
        section.id,
        section,
      ]) ?? [],
    );

    const localOccurrence = state?.sequence.find(
      (occ) => occ.id === localOccurrenceId,
    );

    const localSection = localOccurrence
      ? sections.get(localOccurrence.sectionId)
      : undefined;

    // Find the next occurrence relative to the musician's local position.
    const songOccurrences = state?.sequence.filter((occ) =>
      snap.content?.sections.some(
        (section) => section.id === occ.sectionId,
      ),
    ) ?? [];

    const localIndex = songOccurrences.findIndex(
      (occ) => occ.id === localOccurrenceId,
    );

    const localNextOccurrence =
      localIndex >= 0
        ? songOccurrences[localIndex + 1]
        : undefined;

    const localNextSection = localNextOccurrence
      ? sections.get(localNextOccurrence.sectionId)
      : undefined;

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

    // Preview remains based on the controller's next occurrence.
    const preview = localNextOccurrence && localNextSection
      ? h(
          "div",
          { class: "stage-next-preview" },
          renderLines(
            previewLines(
              occurrenceLines(
                snap.content,
                localNextOccurrence,
                localNextSection,
              ),
              PREVIEW_LINES,
            ),
            view.semitones,
            { mode: prefs.display },
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
    } else if (localNextOccurrence && localNextSection) {
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
          occurrenceText(localNextSection, localNextOccurrence),
        ),
        preview,
      );
    } else {
      side = h(
        "aside",
        { class: "stage-next" },
        view.status === "active"
          ? [h("div", { class: "muted" }, "LAST SECTION"), nextSong]
          : "",
      );
    }

    const chart = h("div", { class: "stage-chart" });

    let heading: HTMLElement;

    if (view.status === "idle") {
      heading = h(
        "div",
        { class: "stage-current idle" },
        snap.status?.recovery ? "WAITING TO RESUME" : "WAITING FOR MD",
      );
    } else if (view.status === "ready") {
      heading = h("div", { class: "stage-current idle" }, "READY");
    } else if (view.status === "ended") {
      heading = h("div", { class: "stage-current idle" }, "ENDED");
    } else {
      const localRepetition = localOccurrence
  ? occurrenceText(localSection, localOccurrence)
  : "";

  const repetitionLabel =
    localOccurrence && localOccurrence.repetitionCount > 1
      ? `${localOccurrence.repetitionIndex + 1}/${localOccurrence.repetitionCount}`
      : null;
    heading = h(
      "div",
      { class: "stage-current" },
      h("span", null, localSection?.sourceLabel.toUpperCase() ?? ""),
      repetitionLabel && !view.vamping
        ? h("span", { class: "stage-rep" }, repetitionLabel)
        : null,
    );

  heading = h(
    "div",
    { class: "stage-current" },
    h("span", null, localSection?.sourceLabel.toUpperCase() ?? ""),
    repetitionLabel && !view.vamping
      ? h("span", { class: "stage-rep" }, repetitionLabel)
      : null,
  );

      if (localOccurrence && localSection) {
        chart.append(
          renderLines(
            occurrenceLines(snap.content, localOccurrence, localSection),
            view.semitones,
            { mode: prefs.display },
          ),
        );
      }
    }

    // Local navigation buttons.
    const navigation = h(
      "div",
      { class: "stage-navigation" },
      h(
        "button",
        {
          class: "stage-previous",
          disabled:
            !state ||
            !localOccurrence ||
            state.sequence.findIndex((o) => o.id === localOccurrence.id) <= 0,
          onclick: previousVerse,
        },
        "PREVIOUS",
      ),
      h(
        "button",
        {
          class: "stage-next-button",
          disabled:
            !state ||
            !localOccurrence ||
            state.sequence.findIndex((o) => o.id === localOccurrence.id) >=
              state.sequence.length - 1,
          onclick: nextVerse,
        },
        "NEXT",
      ),
    );

    mount(
      body,
      h(
        "main",
        { class: "stage-main" },
        snap.connected
          ? null
          : h("div", { class: "banner warn" }, "Disconnected — last known state"),
        heading,
        view.vamping
          ? h("div", { class: "vamp-badge" }, "VAMP — UNTIL CUE")
          : null,
        state?.cues.length
          ? h("div", { class: "stage-cues" }, state.cues.join(" · "))
          : null,
        chart,
        navigation,
      ),
      side,
    );

    requestAnimationFrame(() =>
      fitText(chart, Math.round(window.innerHeight / 7), 14),
    );
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
    window.removeEventListener("pointerdown", onMouse);
    clearTimeout(noteTimer);
    clearTimeout(revealTimer);
  };
}
