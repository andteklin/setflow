import { api, clientId } from "../api";
import { h, mount } from "../dom";
import type { LiveClient, LiveSnapshot } from "../live";

/**
 * Clicker devices (issue #4): the MD approves a Stage display, or any other
 * device, to send NEXT/PREVIOUS from a presentation clicker. Approved devices
 * press on the MD's behalf; the MD stays the only conductor and can remove a
 * device at any time.
 */
export function inputsPanel(live: LiveClient) {
  const el = h("div", { class: "card inputs" });
  let error = "";

  const act = (route: string, deviceId: string) =>
    api("POST", route, { controllerId: clientId, clientId: deviceId }).then(
      () => (error = ""),
      (err: Error) => ((error = err.message), render(live.current)),
    );

  const render = (snap: LiveSnapshot) => {
    const inputs = snap.inputs;
    const pending = inputs?.pending ?? [];
    const approved = inputs?.approved ?? [];
    mount(
      el,
      h("h3", null, "Clicker devices"),
      error ? h("div", { class: "banner error" }, error) : null,
      pending.map((r) =>
        h(
          "div",
          { class: "banner warn" },
          h("strong", null, r.label), ` (${short(r.clientId)}) wants to send NEXT/PREVIOUS from a clicker.`,
          h(
            "div",
            { class: "row" },
            h("button", { class: "primary", onclick: () => void act("/api/inputs/approve", r.clientId) }, "Allow"),
            h("button", { onclick: () => void act("/api/inputs/deny", r.clientId) }, "Deny"),
          ),
        ),
      ),
      approved.length
        ? h(
            "ul",
            { class: "inputs-list" },
            approved.map((d) =>
              h(
                "li",
                { class: "row spread" },
                h("span", null, d.label, " ", h("span", { class: "muted small" }, short(d.clientId)), connectedMark(snap, d.clientId)),
                h("button", { class: "small", onclick: () => confirm(`Stop accepting clicker presses from ${d.label}?`) && void act("/api/inputs/revoke", d.clientId) }, "Remove"),
              ),
            ),
          )
        : pending.length
          ? null
          : h("p", { class: "muted small" }, "A clicker on this computer already works. For one on the Stage computer, open Stage there, move the mouse and choose “Use a clicker here”, then allow it here."),
    );
  };

  const unsubscribe = live.subscribe(render);
  return { el, dispose: unsubscribe };
}

function short(id: string): string {
  return id.replace(/^client-/, "").slice(0, 6);
}

function connectedMark(snap: LiveSnapshot, id: string) {
  const online = snap.clients.some((c) => c.clientId === id);
  return h("span", { class: online ? "dot ok" : "dot bad", title: online ? "Connected" : "Not connected" }, online ? " online" : " offline");
}
