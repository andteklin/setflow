
import { type DisplayMode } from "../chart";
import { api, clientId } from "../api";
import { h, load, mount, save } from "../dom";
import type { LiveClient, LiveSnapshot } from "../live";
import { stageRenderer } from "./stageRenderer";

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

interface StagePrefs {
  display: DisplayMode;
}

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

  // Each Stage screen chooses what it shows (issue #18).
  const prefs = load<StagePrefs>("setflow.stage", { display: "chords" });

  const fromUrl = new URLSearchParams(location.hash.split("?")[1] ?? "").get("display");

  if (fromUrl === "chords" || fromUrl === "lyrics") {
    prefs.display = fromUrl;
    save("setflow.stage", prefs);
  }

  // Shared Stage renderer.
  const renderer = stageRenderer(prefs.display);

  const corner = h("div", { class: "stage-input" });

  mount(root, renderer.el, corner);

  let note = "";
  let noteTimer = 0;

  const renderCorner = (snap: LiveSnapshot) => {
    const pending = snap.inputs?.pending.some(
      (r) => r.clientId === clientId,
    ) ?? false;

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
            ? h("span", null, "Clicker on — approved by the MD")
            : pending
              ? h("span", null, "Waiting for the MD to allow this clicker…")
              : h(
                  "button",
                  {
                    disabled: !snap.connected,
                    onclick: () =>
                      void api(
                        "POST",
                        "/api/inputs/request",
                        { clientId, label: "Stage display" },
                      ).catch((err: Error) => flash(err.message)),
                  },
                  "Use a clicker here",
                ),
    );
  };

  const flash = (text: string) => {
    note = text;

    clearTimeout(noteTimer);

    noteTimer = window.setTimeout(() => {
      note = "";
      renderCorner(live.current);
    }, 2500);

    renderCorner(live.current);
  };

  // Changing display mode updates the shared renderer.
  const setDisplay = (display: DisplayMode) => {
    prefs.display = display;
    save("setflow.stage", prefs);

    // Recreate the renderer so the selected display mode is applied.
    renderer.dispose();

    const replacement = stageRenderer(display);
    replacement.render(live.current);

    mount(root, replacement.el, corner);

    // Keep the active renderer reference updated.
    activeRenderer = replacement;
  };

  let activeRenderer = renderer;

  // Clicker keyboard handling.
  const onKey = (e: KeyboardEvent) => {
    const type = CLICKER_KEYS[e.key];

    if (!type || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;

    if (live.isConductor) {
      e.preventDefault();

      live.command({ type }).then(
        (ack) => !ack.accepted && flash(ack.message),
        (err: Error) => flash(err.message),
      );
    } else if (live.isPairedInput) {
      e.preventDefault();

      void live.input(type).then((why) => why && flash(why));
    }
  };

  window.addEventListener("keydown", onKey);

  // The pairing control stays out of the band's way:
  // it shows only while the mouse moves.
  let revealTimer = 0;

  const onMouse = () => {
    corner.classList.add("reveal");

    clearTimeout(revealTimer);

    revealTimer = window.setTimeout(
      () => corner.classList.remove("reveal"),
      4000,
    );
  };

  // Touch screens have no hover: a tap reveals it too.
  window.addEventListener("mousemove", onMouse);
  window.addEventListener("pointerdown", onMouse);

  // Both the Stage renderer and clicker controls receive the same snapshot.
  const render = (snap: LiveSnapshot) => {
    renderCorner(snap);
    activeRenderer.render(snap);
  };

  const unsubscribe = live.subscribe(render);

  return () => {
    unsubscribe();

    activeRenderer.dispose();

    window.removeEventListener("keydown", onKey);
    window.removeEventListener("mousemove", onMouse);
    window.removeEventListener("pointerdown", onMouse);

    clearTimeout(noteTimer);
    clearTimeout(revealTimer);
  };
}
