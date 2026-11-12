import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import type { ArrangementView, SessionContent, SongDetail } from "../src/protocol.js";

const MD = "md-laptop";
const SONG = "{title: Notes Test (Example)}\n{key: D}\n\n{comment: Verse 1}\n[D]First\n[G]Second\n\n{comment: Bridge}\n[Bm]Up\n[G]Higher\n";

describe("arranged ChordPro and arrangement notes (issue #9)", () => {
  const app = createApp({ dataFile: ":memory:", midiDriver: new Error("no MIDI in tests") });
  let base = "";
  let song: SongDetail;
  let arrangement: ArrangementView;
  const call = async <T = any>(method: string, route: string, body?: unknown) => {
    const res = await fetch(base + route, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };

  before(async () => {
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    song = (await call<SongDetail>("POST", "/api/songs", { text: SONG })).body;
    arrangement = (await call<ArrangementView>("POST", `/api/songs/${song.song.id}/arrangements`, { name: "Sunday", songMap: "V1, B*2" })).body;
  });
  after(() => app.close());

  it("serves the arranged chart and saves comments added to it, leaving the song alone", async () => {
    const { body } = await call<{ text: string; revision: number }>("GET", `/api/arrangements/${arrangement.id}/chordpro`);
    assert.match(body.text, /\{x_setflow_map: V1 → B×2\}/);
    assert.match(body.text, /\{comment: Bridge 2\/2\}\n\[Bm\]Up\n\[G\]Higher/);

    const edited = body.text.replace("{comment: Bridge 2/2}\n[Bm]Up\n", "{comment: Bridge 2/2}\n[Bm]Up\n{ci: Drums out}\n# Watch the leader\n");
    const saved = await call<ArrangementView>("PUT", `/api/arrangements/${arrangement.id}/chordpro`, { text: edited, expectedRevision: body.revision });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.notes.map((n) => [n.item, n.repetition, n.afterLine, n.text]), [
      [1, 1, 1, "{ci: Drums out}"],
      [1, 1, 1, "# Watch the leader"],
    ]);
    arrangement = saved.body;

    const after = (await call<{ text: string }>("GET", `/api/arrangements/${arrangement.id}/chordpro`)).body.text;
    assert.equal(after, edited, "reads back exactly as written");
    assert.equal((await call<SongDetail>("GET", `/api/songs/${song.song.id}`)).body.song.sourceText, SONG, "the song source is unchanged");
  });

  it("refuses a chord change in the arranged chart, naming the line", async () => {
    const { body } = await call<{ text: string; revision: number }>("GET", `/api/arrangements/${arrangement.id}/chordpro`);
    const r = await call("PUT", `/api/arrangements/${arrangement.id}/chordpro`, { text: body.text.replace("[G]Second", "[A]Second"), expectedRevision: body.revision });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /^Line \d+: .*ChordPro source/);
    const stale = await call("PUT", `/api/arrangements/${arrangement.id}/chordpro`, { text: body.text, expectedRevision: body.revision - 1 });
    assert.equal(stale.status, 409);
  });

  it("shows the notes live on that exact occurrence only", async () => {
    await call("POST", "/api/session/start", { songId: song.song.id, arrangementId: arrangement.id, controllerId: MD });
    const content = (await call<SessionContent>("GET", "/api/session/content")).body;
    const state = app.live.status().state!;
    const secondBridge = state.sequence[2];
    assert.deepEqual(Object.keys(content.notes), [secondBridge.id]);
    assert.deepEqual(content.notes[secondBridge.id], [
      { afterLine: 1, line: { kind: "comment", text: "Drums out" } },
      { afterLine: 1, line: { kind: "hidden", text: "Watch the leader" } },
    ]);
  });

  it("keeps notes the map editor carries along, and drops ones the map no longer has", async () => {
    // The editor moved the Bridge first and sent the note re-indexed with it.
    const moved = await call<ArrangementView>("PUT", `/api/arrangements/${arrangement.id}`, {
      songMap: "B*2, V1",
      notes: arrangement.notes.map((n) => ({ ...n, item: 0 })),
      expectedRevision: arrangement.revision,
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.notes.length, 2);

    // A map change without notes keeps only those still matching their item: none here (item 0 is now V1).
    const plain = await call<ArrangementView>("PUT", `/api/arrangements/${arrangement.id}`, { songMap: "V1, B*2" });
    assert.equal(plain.body.notes.length, 0);

    const bad = await call("PUT", `/api/arrangements/${arrangement.id}`, { notes: [{ item: 0, repetition: 0, afterLine: 0, sectionId: "x", text: "[C]chords" }] });
    assert.equal(bad.status, 400);
  });
});
