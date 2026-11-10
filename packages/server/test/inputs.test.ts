import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import type { InputDevicesStatus, LiveStatus, ServerMessage, SongDetail } from "../src/protocol.js";

const MD = "md-laptop";
const STAGE = "stage-pc";
const SONG = "{title: Clicker Test (Example)}\n\n{comment: Verse 1}\n[C]One\n\n{comment: Chorus}\n[F]Two\n";

async function boot(dataFile: string) {
  const app = createApp({ dataFile, midiDriver: new Error("no MIDI in tests") });
  const port = await app.listen(0, "127.0.0.1");
  const call = async <T = any>(method: string, route: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  return { app, port, call };
}

/** A LAN client that says hello and can wait for a message. */
async function client(port: number, clientId: string, role: "control" | "stage") {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const waiters: Array<(m: ServerMessage) => boolean> = [];
  ws.on("message", (data) => {
    const m = JSON.parse(String(data)) as ServerMessage;
    for (const w of [...waiters]) if (w(m)) waiters.splice(waiters.indexOf(w), 1);
  });
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  ws.send(JSON.stringify({ type: "hello", clientId, role }));
  const next = <T extends ServerMessage["type"]>(type: T) =>
    new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2000);
      waiters.push((m) => m.type === type && (clearTimeout(timer), resolve(m as Extract<ServerMessage, { type: T }>), true));
    });
  /** Press the clicker once and return the host's answer. */
  const press = (type: "NEXT" | "PREVIOUS" | "END") => {
    const answer = next("inputResult");
    ws.send(JSON.stringify({ type: "input", command: { type } }));
    return answer;
  };
  return { ws, next, press, close: () => ws.close() };
}

describe("paired clicker inputs (issue #4)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setflow-inputs-"));
  const dataFile = path.join(dir, "setflow.db");
  let host: Awaited<ReturnType<typeof boot>>;
  let song: SongDetail;

  before(async () => {
    host = await boot(dataFile);
    song = (await host.call<SongDetail>("POST", "/api/songs", { text: SONG })).body;
  });
  after(async () => {
    await host.app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ignores presses from a device the MD has not approved", async () => {
    const control = await client(host.port, MD, "control");
    const stage = await client(host.port, STAGE, "stage");
    await host.call("POST", "/api/session/start", { songId: song.song.id, arrangementId: song.arrangements[0].id, controllerId: MD });

    const refused = await stage.press("NEXT");
    assert.equal(refused.accepted, false);
    assert.match(refused.message ?? "", /not an approved input/);
    assert.equal(host.app.live.status().state?.status, "ready", "the band did not move");
    control.close();
    stage.close();
  });

  it("lets only the MD approve, then conducts on the MD's behalf", async () => {
    const control = await client(host.port, MD, "control");
    const stage = await client(host.port, STAGE, "stage");

    const asked = await host.call<InputDevicesStatus>("POST", "/api/inputs/request", { clientId: STAGE, label: "Stage display" });
    assert.deepEqual(asked.body.pending.map((r) => r.label), ["Stage display"]);

    const stranger = await host.call("POST", "/api/inputs/approve", { controllerId: "bass-phone", clientId: STAGE });
    assert.equal(stranger.status, 403);
    const broadcast = control.next("inputs");
    const approved = await host.call<InputDevicesStatus>("POST", "/api/inputs/approve", { controllerId: MD, clientId: STAGE });
    assert.equal(approved.status, 200);
    assert.deepEqual(approved.body.approved.map((d) => d.clientId), [STAGE]);
    assert.deepEqual((await broadcast).inputs.pending, [], "Control sees the request handled");

    // Two quick clicks both land: the host stamps each with the current revision.
    const [one, two] = await Promise.all([stage.press("NEXT"), stage.press("NEXT")]);
    assert.ok(one.accepted && two.accepted);
    const status = (await host.call<LiveStatus>("GET", "/api/session")).body;
    assert.equal(status.state?.currentOccurrenceId, status.state?.sequence[1].id);
    assert.equal(status.controllerId, MD, "the MD is still the one conductor");

    const back = await stage.press("PREVIOUS");
    assert.ok(back.accepted);
    const end = await stage.press("END");
    assert.equal(end.accepted, false, "a clicker cannot end the song");
    assert.equal((await host.call<LiveStatus>("GET", "/api/session")).body.state?.status, "active");
    control.close();
    stage.close();
  });

  it("remembers approvals across a restart, and stops after the MD revokes one", async () => {
    await host.app.close();
    host = await boot(dataFile);
    assert.deepEqual(host.app.inputs.status().approved.map((d) => d.clientId), [STAGE]);

    const control = await client(host.port, MD, "control");
    const stage = await client(host.port, STAGE, "stage");
    await host.call("POST", "/api/session/start", { songId: song.song.id, arrangementId: song.arrangements[0].id, controllerId: MD });
    assert.ok((await stage.press("NEXT")).accepted);

    await host.call("POST", "/api/inputs/revoke", { controllerId: MD, clientId: STAGE });
    assert.equal((await stage.press("NEXT")).accepted, false);
    control.close();
    stage.close();
  });
});
