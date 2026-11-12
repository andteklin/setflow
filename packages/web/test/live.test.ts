import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { CommandAck } from "@setflow/core";
import { createApp } from "@setflow/server/app";
import type { SongDetail } from "@setflow/server/protocol";

const FIXTURE = fs.readFileSync(path.join(import.meta.dirname, "../../core/test/fixtures/sample-variants.cho"), "utf8");

/**
 * Runs the browser LiveClient in Node against a real host. Node provides
 * WebSocket and fetch; the few page globals it reads are stubbed here.
 */
describe("LiveClient against a real host", () => {
  const app = createApp({ dataFile: ":memory:", midiDriver: new Error("no MIDI in tests") });
  let base = "";
  let live: import("../src/live.js").LiveClient;
  let clientId = "";

  before(async () => {
    const port = await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${port}`;
    const realFetch = globalThis.fetch;
    Object.assign(globalThis, {
      window: globalThis,
      location: { protocol: "http:", host: `127.0.0.1:${port}` },
      fetch: (route: string, init?: RequestInit) => realFetch(new URL(route, base), init),
    });
    ({ clientId } = await import("../src/api.js"));
    const { LiveClient } = await import("../src/live.js");

    const song = (await (await fetch("/api/songs", post({ text: FIXTURE }))).json()) as SongDetail;
    const start = await fetch("/api/session/start", post({ songId: song.song.id, arrangementId: song.arrangements[0].id, controllerId: clientId }));
    assert.equal(start.status, 200);

    live = new LiveClient("control");
    await until(() => live.current.connected && live.current.content !== null);
  });

  after(async () => {
    live?.close();
    await app.close();
  });

  it("applies rapid presses in order instead of rejecting them as stale", async () => {
    // A clicker or foot pedal pressed three times before the first answer arrives.
    const acks: CommandAck[] = await Promise.all([
      live.command({ type: "NEXT" }),
      live.command({ type: "NEXT" }),
      live.command({ type: "NEXT" }),
    ]);
    assert.deepEqual(
      acks.map((a) => a.accepted || a.reason),
      [true, true, true],
    );
    const state = acks[2].state;
    assert.equal(state.currentOccurrenceId, state.sequence[2].id);
    await until(() => live.current.status?.state?.revision === state.revision);
  });

  it("still rejects a press when disconnected, without queueing it for later", async () => {
    live.close();
    await until(() => !live.current.connected);
    await assert.rejects(live.command({ type: "NEXT" }), /Disconnected/);
  });
});

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error("Timed out waiting for the client");
    await new Promise((r) => setTimeout(r, 10));
  }
}
