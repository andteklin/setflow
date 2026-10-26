import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";
import type { CommandAck, CommandEnvelope, PerformanceCommand } from "@setflow/core";
import { createApp, type ServerMessage } from "../src/app.js";
import type { LiveStatus, SessionContent } from "../src/protocol.js";
import type { ArrangementView, SongDetail } from "../src/protocol.js";

const FIXTURE = fs.readFileSync(path.join(import.meta.dirname, "../../core/test/fixtures/sample-variants.cho"), "utf8");
const MD = "md-laptop";

type App = ReturnType<typeof createApp>;

async function boot(dataFile: string) {
  const app = createApp({ dataFile });
  const port = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;
  const api = async <T = any>(method: string, route: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(base + route, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const ok = async <T = any>(method: string, route: string, body?: unknown): Promise<T> => {
    const r = await api<T>(method, route, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  return { app, port, base, api, ok };
}

/** A LAN client that records every message and can wait for one matching a predicate. */
function connect(port: number, clientId: string, role: "control" | "stage" | "musician") {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = [];
  const waiters: Array<{ match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  ws.on("message", (data) => {
    const message = JSON.parse(String(data)) as ServerMessage;
    messages.push(message);
    for (const w of [...waiters]) {
      if (w.match(message)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(message);
      }
    }
  });
  const opened = new Promise<void>((resolve) => ws.on("open", () => {
    ws.send(JSON.stringify({ type: "hello", clientId, role }));
    resolve();
  }));
  const next = <T extends ServerMessage>(match: (m: ServerMessage) => boolean, timeoutMs = 2000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for message")), timeoutMs);
      waiters.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m as T)) });
    });
  const statusWhere = (pred: (s: LiveStatus) => boolean) =>
    next<{ type: "status"; status: LiveStatus }>((m) => m.type === "status" && pred(m.status)).then((m) => m.status);
  return { ws, messages, opened, next, statusWhere, close: () => ws.close() };
}

describe("SetFlow host", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setflow-test-"));
  const dataFile = path.join(dir, "setflow.db");
  let host: Awaited<ReturnType<typeof boot>>;
  let song: SongDetail;
  let custom: ArrangementView;

  before(async () => {
    host = await boot(dataFile);
  });
  after(async () => {
    await host.app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("previews an import without saving it", async () => {
    const preview = await host.ok("POST", "/api/import/preview", { text: FIXTURE });
    assert.equal(preview.metadata.title, "Morning Lantern (Example)");
    assert.equal(preview.sourceOrderMap, "I → V1 → C1A → INST → V2 → C1B → B → C1C → C1D → E");
    assert.deepEqual(await host.ok("GET", "/api/songs"), []);
  });

  it("imports a song with provenance and an automatic Source Order arrangement", async () => {
    song = await host.ok("POST", "/api/songs", { text: FIXTURE, providerId: "file", fileName: "lantern.cho" });
    assert.equal(song.song.title, "Morning Lantern (Example)");
    assert.equal(song.song.sourceText, FIXTURE);
    assert.equal(song.song.provenance.providerId, "file");
    assert.equal(song.song.provenance.storagePolicy, "organization-local");
    assert.equal(song.sections.length, 10);
    assert.deepEqual(song.arrangements.map((a) => [a.name, a.items?.length]), [["Source Order", 10]]);
  });

  it("saves custom song maps in canonical form and rejects ambiguous ones", async () => {
    custom = await host.ok("POST", `/api/songs/${song.song.id}/arrangements`, {
      name: "Sunday",
      songMap: "i, v1, c1a, v2, c1b, b*2, c1c*2, e",
      performanceKey: "D",
    });
    assert.equal(custom.songMap, "I → V1 → C1A → V2 → C1B → B×2 → C1C×2 → E");
    assert.equal(custom.items?.length, 8);

    const bad = await host.api("POST", `/api/songs/${song.song.id}/arrangements`, { name: "Bad", songMap: "V1, C" });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /Did you mean: C1A, C1B, C1C, C1D/);

    const copy = await host.ok("POST", `/api/arrangements/${custom.id}/duplicate`, {});
    assert.equal(copy.name, "Sunday (copy)");
    const restored = await host.ok("POST", `/api/arrangements/${copy.id}/restore-source-order`);
    assert.equal(restored.items.length, 10);
    await host.ok("DELETE", `/api/arrangements/${copy.id}`);
  });

  it("validates setlist items against saved arrangements", async () => {
    const setlist = await host.ok("POST", "/api/setlists", {
      name: "Fall Getaway",
      items: [{ songId: song.song.id, arrangementId: custom.id, performanceKey: "D" }],
    });
    assert.equal(setlist.items.length, 1);
    const bad = await host.api("POST", "/api/setlists", { name: "x", items: [{ songId: "nope", arrangementId: custom.id }] });
    assert.equal(bad.status, 400);
  });

  it("conducts a live session over the LAN with acknowledgements and rejections", async () => {
    const control = connect(host.port, MD, "control");
    const musician = connect(host.port, "bass-phone", "musician");
    await Promise.all([control.opened, musician.opened]);

    const started = musician.statusWhere((s) => s.state?.status === "ready");
    const status: LiveStatus = await host.ok("POST", "/api/session/start", {
      songId: song.song.id,
      arrangementId: custom.id,
      controllerId: MD,
    });
    assert.equal(status.state?.performanceKey, "D");
    const sessionId = status.state!.sessionId;
    await started;

    const content: SessionContent = await host.ok("GET", "/api/session/content");
    assert.equal(content.sessionId, sessionId);
    assert.equal(content.sections.find((s) => s.token === "I")?.lines[0].kind, "music");

    let n = 0;
    const envelope = (command: PerformanceCommand, revision: number, extra: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
      commandId: `c-${++n}`,
      sessionId,
      expectedRevision: revision,
      source: "web",
      controllerId: MD,
      command,
      ...extra,
    });
    const sendCommand = async (client: ReturnType<typeof connect>, env: CommandEnvelope) => {
      const ack = client.next<{ type: "ack"; ack: CommandAck }>((m) => m.type === "ack" && m.ack.commandId === env.commandId);
      client.ws.send(JSON.stringify({ type: "command", envelope: env }));
      return (await ack).ack;
    };

    // NEXT from the controller reaches every view as the same snapshot.
    const seen = musician.statusWhere((s) => s.state?.revision === 1);
    const first = envelope({ type: "NEXT" }, 0, { commandId: "press-1" });
    const ack = await sendCommand(control, first);
    assert.equal(ack.accepted, true);
    const musicianView = await seen;
    assert.equal(musicianView.state?.currentOccurrenceId, ack.state.currentOccurrenceId);

    // A retried press is answered without running twice.
    const retry = await sendCommand(control, first);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.state.revision, 1);

    // Stale revisions and view-only devices are rejected with the current snapshot.
    const stale = await sendCommand(control, envelope({ type: "NEXT" }, 0));
    assert.equal(stale.accepted === false && stale.reason, "stale-revision");
    const viewer = await sendCommand(musician, envelope({ type: "NEXT" }, 1, { controllerId: "bass-phone" }));
    assert.equal(viewer.accepted === false && viewer.reason, "unauthorized");

    // The HTTP command endpoint goes through the same gateway.
    const repeat = await host.ok<CommandAck>("POST", "/api/session/commands", envelope({ type: "REPEAT" }, 1));
    assert.equal(repeat.accepted, true);

    // Key changes are host-controlled and revisioned; only the conductor may change them.
    assert.equal((await host.api("POST", "/api/session/key", { controllerId: "bass-phone", performanceKey: "E" })).status, 403);
    const keyed: LiveStatus = await host.ok("POST", "/api/session/key", { controllerId: MD, performanceKey: "E" });
    assert.equal(keyed.state?.performanceKey, "E");

    control.close();
    musician.close();
  });

  it("keeps the active session pinned while the library is edited", async () => {
    const before = await host.ok<SessionContent>("GET", "/api/session/content");
    const edited = FIXTURE.replace("{comment: Bridge}", "{comment: Bridge}\n{comment: Build here}");
    const updated: SongDetail = await host.ok("PUT", `/api/songs/${song.song.id}`, { text: edited, expectedRevision: 1 });
    assert.equal(updated.song.revision, 2);
    const conflict = await host.api("PUT", `/api/songs/${song.song.id}`, { text: edited, expectedRevision: 1 });
    assert.equal(conflict.status, 409);

    const after = await host.ok<SessionContent>("GET", "/api/session/content");
    assert.deepEqual(after, before);
    assert.equal(after.songRevision, 1);
  });

  it("survives a host restart and resumes only after confirmation, under a new session id", async () => {
    const beforeRestart = await host.ok<LiveStatus>("GET", "/api/session");
    await host.app.close();
    host = await boot(dataFile);

    const songs = await host.ok("GET", "/api/songs");
    assert.equal(songs.length, 1);
    const detail: SongDetail = await host.ok("GET", `/api/songs/${song.song.id}`);
    assert.equal(detail.arrangements.find((a) => a.name === "Sunday")?.performanceKey, "D");

    const pending = await host.ok<LiveStatus>("GET", "/api/session");
    assert.equal(pending.state, null);
    assert.equal(pending.recovery?.title, "Morning Lantern (Example)");
    assert.equal(pending.recovery?.current, "Intro 2/2");

    const resumed = await host.ok<LiveStatus>("POST", "/api/recovery/resume", { controllerId: MD });
    assert.notEqual(resumed.state?.sessionId, beforeRestart.state?.sessionId);
    assert.equal(resumed.state?.currentOccurrenceId, beforeRestart.state?.currentOccurrenceId);
    assert.equal(resumed.state?.performanceKey, "E");

    const old = await host.ok<CommandAck>("POST", "/api/session/commands", {
      commandId: "late",
      sessionId: beforeRestart.state!.sessionId,
      expectedRevision: resumed.state!.revision,
      controllerId: MD,
      command: { type: "NEXT" },
    });
    assert.equal(old.accepted === false && old.reason, "wrong-session");
  });

  it("forgets the recovery snapshot once the performance ends", async () => {
    const status = await host.ok<LiveStatus>("GET", "/api/session");
    await host.ok("POST", "/api/session/commands", {
      commandId: "end",
      sessionId: status.state!.sessionId,
      expectedRevision: status.state!.revision,
      controllerId: MD,
      command: { type: "END" },
    });
    await host.app.close();
    host = await boot(dataFile);
    assert.equal((await host.ok<LiveStatus>("GET", "/api/session")).recovery, null);
  });

  it("explains when the web app has not been built", async () => {
    const res = await fetch(`${host.base}/`);
    assert.equal(res.status, 503);
  });
});
