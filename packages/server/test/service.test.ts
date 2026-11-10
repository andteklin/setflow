import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { CommandAck, PerformanceCommand } from "@setflow/core";
import { createApp } from "../src/app.js";
import type { LiveStatus, SessionContent, SetlistRecord, SongDetail } from "../src/protocol.js";

const MD = "md-laptop";
const SONG_A = "{title: First Light (Example)}\n{key: C}\n\n{comment: Verse 1}\n[C]Morning [F]comes\n\n{comment: Ending}\n[C]Amen\n";
const SONG_B = "{title: Second Wind (Example)}\n{key: G}\n\n{comment: Intro}\n[G] [D]\n\n{comment: Chorus}\n[G]Sing it [D]out\n";

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
  const ok = async <T = any>(method: string, route: string, body?: unknown): Promise<T> => {
    const r = await call<T>(method, route, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  /** Send a command the way a browser would, stamped with the current revision. */
  const command = async (command: PerformanceCommand, override: { commandId?: string; expectedRevision?: number } = {}) => {
    const { state } = await ok<LiveStatus>("GET", "/api/session");
    return ok<CommandAck>("POST", "/api/session/commands", {
      commandId: override.commandId ?? `cmd-${Math.random()}`,
      sessionId: state!.sessionId,
      expectedRevision: override.expectedRevision ?? state!.revision,
      controllerId: MD,
      command,
    });
  };
  return { app, call, ok, command };
}

describe("performing a setlist (issue #7)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setflow-service-"));
  const dataFile = path.join(dir, "setflow.db");
  let host: Awaited<ReturnType<typeof boot>>;
  let a: SongDetail;
  let b: SongDetail;
  let setlist: SetlistRecord;

  before(async () => {
    host = await boot(dataFile);
    a = await host.ok("POST", "/api/songs", { text: SONG_A });
    b = await host.ok("POST", "/api/songs", { text: SONG_B });
    setlist = await host.ok("POST", "/api/setlists", {
      name: "Sunday",
      items: [
        { songId: a.song.id, arrangementId: a.arrangements[0].id },
        { songId: b.song.id, arrangementId: b.arrangements[0].id, performanceKey: "A" },
      ],
    });
  });
  after(async () => {
    await host.app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to start a setlist with a broken entry, naming it", async () => {
    const broken = await host.ok<SongDetail>("POST", "/api/songs", { text: SONG_B });
    const custom = await host.ok("POST", `/api/songs/${broken.song.id}/arrangements`, { name: "Short", songMap: "I, C" });
    const bad = await host.ok<SetlistRecord>("POST", "/api/setlists", {
      name: "Broken",
      items: [
        { songId: a.song.id, arrangementId: a.arrangements[0].id },
        { songId: broken.song.id, arrangementId: custom.id },
      ],
    });
    // The source loses its Intro, so the saved map no longer resolves.
    await host.ok("PUT", `/api/songs/${broken.song.id}`, { text: SONG_B.replace("{comment: Intro}\n[G] [D]\n\n", "") });
    const r = await host.call("POST", "/api/service/start", { setlistId: bad.id, controllerId: MD });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not ready/);
    assert.match(r.body.error, /^2\. "Second Wind/m);
    const empty = await host.ok<SetlistRecord>("POST", "/api/setlists", { name: "Empty", items: [] });
    assert.equal((await host.call("POST", "/api/service/start", { setlistId: empty.id, controllerId: MD })).status, 400);
  });

  it("runs song to song with NEXT after a song ends, and PREVIOUS before one starts", async () => {
    const started = await host.ok<LiveStatus>("POST", "/api/service/start", { setlistId: setlist.id, controllerId: MD });
    assert.equal(started.state?.status, "ready");
    assert.equal(started.title, "First Light (Example)");
    assert.deepEqual(
      started.service && { name: started.service.name, index: started.service.index, titles: started.service.items.map((i) => i.title) },
      { name: "Sunday", index: 0, titles: ["First Light (Example)", "Second Wind (Example)"] },
    );
    const firstSession = started.state!.sessionId;

    await host.command({ type: "NEXT" }); // Verse 1
    await host.command({ type: "NEXT" }); // Ending
    const ended = await host.command({ type: "NEXT" });
    assert.equal(ended.state.status, "ended", "the last section still ends the song first");

    const nextSong = await host.command({ type: "NEXT" });
    assert.ok(nextSong.accepted);
    assert.equal(nextSong.state.status, "ready", "the next song waits at Ready; it does not start by itself");
    assert.notEqual(nextSong.state.sessionId, firstSession);
    assert.equal(nextSong.state.performanceKey, "A", "the entry's key applies");
    const status = await host.ok<LiveStatus>("GET", "/api/session");
    assert.equal(status.title, "Second Wind (Example)");
    assert.equal(status.service?.index, 1);

    const back = await host.command({ type: "PREVIOUS" });
    assert.ok(back.accepted);
    assert.equal((await host.ok<LiveStatus>("GET", "/api/session")).service?.index, 0);
    assert.equal(back.state.status, "ready", "going back loads the song fresh, at Ready");
  });

  it("jumps to any song from Control, conductor only", async () => {
    assert.equal((await host.call("POST", "/api/service/song", { controllerId: "someone-else", index: 1 })).status, 403);
    assert.equal((await host.call("POST", "/api/service/song", { controllerId: MD, index: 5 })).status, 400);
    const moved = await host.ok<LiveStatus>("POST", "/api/service/song", { controllerId: MD, index: 1 });
    assert.equal(moved.service?.index, 1);
    assert.equal(moved.state?.status, "ready");
  });

  it("answers a retried song change once, and rejects a stale one without moving", async () => {
    await host.ok("POST", "/api/service/song", { controllerId: MD, index: 0 });
    for (let i = 0; i < 3; i++) await host.command({ type: "NEXT" });
    const { state: ended } = await host.ok<LiveStatus>("GET", "/api/session");
    assert.equal(ended?.status, "ended");

    const stale = await host.command({ type: "NEXT" }, { expectedRevision: ended!.revision - 1 });
    assert.equal(stale.accepted, false);
    assert.equal((await host.ok<LiveStatus>("GET", "/api/session")).service?.index, 0);

    const first = await host.command({ type: "NEXT" }, { commandId: "advance-once" });
    assert.ok(first.accepted);
    const retry = await host.ok<CommandAck>("POST", "/api/session/commands", {
      commandId: "advance-once",
      sessionId: ended!.sessionId,
      expectedRevision: ended!.revision,
      controllerId: MD,
      command: { type: "NEXT" },
    });
    assert.ok(retry.accepted && retry.duplicate);
    assert.equal((await host.ok<LiveStatus>("GET", "/api/session")).service?.index, 1, "still song 2, not skipped further");
  });

  it("plays what was pinned at start, whatever the library does meanwhile", async () => {
    await host.ok("POST", "/api/service/start", { setlistId: setlist.id, controllerId: MD });
    const fresh = await host.ok<SongDetail>("GET", `/api/songs/${b.song.id}`);
    await host.ok("PUT", `/api/songs/${b.song.id}`, { text: SONG_B.replace("Sing it", "Changed"), expectedRevision: fresh.song.revision });
    await host.ok("PUT", `/api/setlists/${setlist.id}`, { name: "Sunday", items: [setlist.items[1]] });

    for (let i = 0; i < 4; i++) await host.command({ type: "NEXT" });
    const content = await host.ok<SessionContent>("GET", "/api/session/content");
    assert.equal(content.title, "Second Wind (Example)");
    const chorus = content.sections.find((s) => s.token === "C")!;
    assert.deepEqual(
      chorus.lines.map((l) => (l.kind === "music" ? l.lyrics : "")),
      ["Sing it out"],
      "the edit made mid-service waits for the next service",
    );
    await host.ok("PUT", `/api/setlists/${setlist.id}`, { name: "Sunday", items: setlist.items });
  });

  it("lets a host-attached input (MIDI) move to the next song too", async () => {
    await host.ok("POST", "/api/service/start", { setlistId: setlist.id, controllerId: MD });
    for (let i = 0; i < 3; i++) assert.equal(host.app.live.conduct({ type: "NEXT" }, "midi"), null);
    assert.equal(host.app.live.status().state?.status, "ended");
    assert.equal(host.app.live.conduct({ type: "NEXT" }, "midi"), null);
    assert.equal(host.app.live.status().service?.index, 1);
    for (let i = 0; i < 3; i++) host.app.live.conduct({ type: "NEXT" }, "midi");
    assert.equal(host.app.live.status().state?.status, "ended");
    assert.match(host.app.live.conduct({ type: "NEXT" }, "midi") ?? "", /ended/i, "after the last song, nothing follows");
  });

  it("recovers between songs after a host restart, resuming the setlist", async () => {
    await host.ok("POST", "/api/service/start", { setlistId: setlist.id, controllerId: MD });
    for (let i = 0; i < 3; i++) await host.command({ type: "NEXT" });
    await host.app.close();

    host = await boot(dataFile);
    const status = await host.ok<LiveStatus>("GET", "/api/session");
    assert.equal(status.state, null, "nothing resumes by itself");
    assert.equal(status.recovery?.setlist, "Sunday · song 1 of 2");
    assert.equal(status.recovery?.status, "ended");

    const resumed = await host.ok<LiveStatus>("POST", "/api/recovery/resume", { controllerId: MD });
    assert.equal(resumed.service?.index, 0);
    const next = await host.command({ type: "NEXT" });
    assert.ok(next.accepted);
    assert.equal((await host.ok<LiveStatus>("GET", "/api/session")).title, "Second Wind (Example)");
  });

  it("leaves setlist mode when a single song is started on its own", async () => {
    const solo = await host.ok<LiveStatus>("POST", "/api/session/start", { songId: a.song.id, arrangementId: a.arrangements[0].id, controllerId: MD });
    assert.equal(solo.service, null);
    for (let i = 0; i < 3; i++) await host.command({ type: "NEXT" });
    const after = await host.call<CommandAck>("POST", "/api/session/commands", {
      commandId: "solo-next",
      sessionId: (await host.ok<LiveStatus>("GET", "/api/session")).state!.sessionId,
      expectedRevision: (await host.ok<LiveStatus>("GET", "/api/session")).state!.revision,
      controllerId: MD,
      command: { type: "NEXT" },
    });
    assert.equal(after.body.accepted, false, "a lone song still just ends");
  });
});
