import "./styles.css";
import type { ClientRole } from "@setflow/server/protocol";
import { h, mount } from "./dom";
import { LiveClient } from "./live";
import { controlView } from "./views/control";
import { musicianView } from "./views/musician";
import { stageView } from "./views/stage";

const root = document.getElementById("app")!;
const views: Record<ClientRole, (root: HTMLElement, live: LiveClient) => () => void> = {
  control: controlView,
  stage: stageView,
  musician: musicianView,
};

let live: LiveClient | null = null;
let dispose: (() => void) | null = null;

function route() {
  dispose?.();
  live?.close();
  dispose = null;
  live = null;

  // Options may follow the view, e.g. #/stage?display=lyrics.
  const role = location.hash.replace(/^#\/?/, "").split("?")[0] as ClientRole;
  if (role in views) {
    document.title = `SetFlow — ${role[0].toUpperCase()}${role.slice(1)}`;
    live = new LiveClient(role);
    dispose = views[role](root, live);
    return;
  }
  document.title = "SetFlow";
  document.body.dataset.view = "home";
  mount(
    root,
    h(
      "main",
      { class: "home" },
      h("h1", null, "SetFlow"),
      h("p", { class: "muted" }, "Choose what this device shows. Everything runs on the local network."),
      h(
        "div",
        { class: "home-grid" },
        h("a", { class: "home-card", href: "#/control" }, h("strong", null, "Control"), h("span", null, "Library, Song Maps and live conducting for the MD.")),
        h("a", { class: "home-card", href: "#/stage" }, h("strong", null, "Stage"), h("span", null, "Portrait band display: current section, next and cues.")),
        h("a", { class: "home-card", href: "#/musician" }, h("strong", null, "Musician"), h("span", null, "The whole chart on your own device, following the band.")),
      ),
    ),
  );
}

window.addEventListener("hashchange", route);
route();
