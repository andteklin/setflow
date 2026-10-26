import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createApp, type LiveStatus, type MidiSettings, type SongDetail } from "../src/app.js";
import { decodeMidi, PressDetector, type MidiDriver } from "../src/midi.js";

const FIXTURE = fs.readFileSync(path.join(import.meta.dirname, "../../core/test/fixtures/sample-variants.cho"), "utf8");

const noteOn = (n: number, velocity = 100, channel = 1) => [0x90 + channel - 1, n, velocity];
const noteOff = (n: number, channel = 1) => [0x80 + channel - 1, n, 0];
const cc = (n: number, value: number, channel = 1) => [0xb0 + channel - 1, n, value];

/** A pretend USB controller that can be plugged and unplugged. */
function fakeDriver() {
  const ports = ["Pedalboard"];
  let handler: ((bytes: number[]) => void) | null = null;
  const driver: MidiDriver = {
    listPorts: () => [...ports],
    open(name, onMessage) {
      if (!ports.includes(name)) throw new Error("not connected");
      handler = onMessage;
      return () => (handler = null);
    },
  };
  return {
    driver,
    press: (bytes: number[]) => handler?.(bytes),
    unplug: () => ports.splice(0),
    plug: () => ports.push("Pedalboard"),
    isOpen: () => handler !== null,
  };
}

describe("MIDI press detection (spec §19.3)", () => {
  it("decodes notes and control changes with 1-based channels", () => {
    assert.deepEqual(decodeMidi(noteOn(60, 90, 2)), { kind: "note", channel: 2, number: 60, value: 90 });
    assert.deepEqual(decodeMidi(noteOff(60)), { kind: "note", channel: 1, number: 60, value: 0 });
    assert.deepEqual(decodeMidi(cc(64, 127)), { kind: "cc", channel: 1, number: 64, value: 127 });
    assert.equal(decodeMidi([0xf8]), null);
  });

  it("triggers on note-on only, never on note-off or zero velocity", () => {
    const d = new PressDetector();
    assert.equal(d.isPress(decodeMidi(noteOn(60))!, 0), true);
    assert.equal(d.isPress(decodeMidi(noteOff(60))!, 100), false);
    assert.equal(d.isPress(decodeMidi(noteOn(60, 0))!, 200), false);
  });

  it("triggers a control change only on the press edge", () => {
    const d = new PressDetector();
    assert.equal(d.isPress(decodeMidi(cc(64, 127))!, 0), true);
    assert.equal(d.isPress(decodeMidi(cc(64, 127))!, 100), false);
    assert.equal(d.isPress(decodeMidi(cc(64, 0))!, 200), false);
    assert.equal(d.isPress(decodeMidi(cc(64, 127))!, 300), true);
  });

  it("absorbs switch bounce but not deliberate repeated presses", () => {
    const d = new PressDetector();
    assert.equal(d.isPress(decodeMidi(noteOn(60))!, 0), true);
    assert.equal(d.isPress(decodeMidi(noteOn(60))!, 20), false);
    assert.equal(d.isPress(decodeMidi(noteOn(60))!, 250), true);
  });
});

describe("MIDI controller on the host", () => {
  it("conducts through the same gateway, survives unplugging, and keeps web control working", async () => {
    const fake = fakeDriver();
    const app = createApp({ dataFile: ":memory:", midiDriver: fake.driver });
    try {
      const song: SongDetail = app.library.importSong({ text: FIXTURE });
      const arrangement = app.library.createArrangement(song.song.id, { name: "Sunday", songMap: "I,V1,C1A,B*2,C1C,E" });
      app.live.start({ songId: song.song.id, arrangementId: arrangement.id, controllerId: "md" });

      const settings: MidiSettings = {
        enabled: true,
        deviceName: "Pedalboard",
        channel: 1,
        bindings: [
          { kind: "note", number: 60, action: { type: "NEXT" } },
          { kind: "cc", number: 64, action: { type: "REPEAT" } },
          { kind: "note", number: 62, action: { type: "JUMP", token: "C1C" } },
          { kind: "note", number: 63, action: { type: "JUMP", token: "PC" } },
        ],
      };
      let status = app.midi.configure(settings);
      assert.equal(status.connected, true);
      assert.deepEqual(status.devices, ["Pedalboard"]);

      const current = () => {
        const s = app.live.status().state!;
        return app.live.sections().find((x) => x.id === s.sequence.find((o) => o.id === s.currentOccurrenceId)?.sectionId)?.token;
      };

      fake.press(noteOn(60));
      fake.press(noteOff(60));
      assert.equal(current(), "I");
      assert.equal(app.live.status().state!.revision, 1, "note-off must not trigger a second NEXT");

      fake.press(noteOn(62));
      assert.equal(current(), "C1C");
      assert.equal(app.midi.status().lastResult, "JUMP C1C");

      fake.press(cc(64, 127));
      fake.press(cc(64, 0));
      assert.deepEqual(app.live.status().state!.repetition, { index: 2, total: 2 });

      // A wrong channel, an unmapped key and a token this song lacks change nothing.
      const revision = app.live.status().state!.revision;
      fake.press(noteOn(60, 100, 5));
      fake.press(noteOn(70));
      fake.press(noteOn(63));
      assert.equal(app.live.status().state!.revision, revision);
      assert.equal(app.midi.status().lastResult, "This song has no section PC");

      // Turned off: presses are shown for testing but do not conduct.
      app.midi.configure({ ...settings, enabled: false });
      await new Promise((r) => setTimeout(r, 80)); // a real second press, not switch bounce
      fake.press(noteOn(60));
      assert.equal(app.live.status().state!.revision, revision);
      assert.match(app.midi.status().lastResult!, /MIDI control is off/);
      app.midi.configure(settings);

      // Unplug: the adapter reports it; web control is unaffected; replugging reconnects.
      fake.unplug();
      app.midi.refreshDevices();
      status = app.midi.status();
      assert.equal(status.connected, false);
      assert.match(status.error!, /disconnected/);
      const s = app.live.status().state!;
      const ack = app.live.submit({
        commandId: "web-1",
        sessionId: s.sessionId,
        expectedRevision: s.revision,
        source: "web",
        controllerId: "md",
        command: { type: "NEXT" },
      });
      assert.equal(ack.accepted, true);

      fake.plug();
      app.midi.refreshDevices();
      assert.equal(app.midi.status().connected, true);
      assert.ok(fake.isOpen());
    } finally {
      await app.close();
    }
  });

  it("saves mappings, validates them, and reports MIDI as unavailable without a driver", async () => {
    const app = createApp({ dataFile: ":memory:", midiDriver: new Error("no native module") });
    const port = await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${port}`;
    try {
      const status = (await (await fetch(`${base}/api/midi`)).json()) as { available: boolean };
      assert.equal(status.available, false);

      const bad = await fetch(`${base}/api/midi`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, channel: 17, bindings: [] }),
      });
      assert.equal(bad.status, 400);

      const good = await fetch(`${base}/api/midi`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, deviceName: "Pedalboard", channel: null, bindings: [{ kind: "cc", number: 64, action: { type: "VAMP" } }] }),
      });
      assert.equal(good.status, 200);
      assert.equal(app.store.getSetting<MidiSettings>("midi")?.bindings[0].action.type, "VAMP");

      const live = (await (await fetch(`${base}/api/session`)).json()) as LiveStatus;
      assert.equal(live.state, null);
    } finally {
      await app.close();
    }
  });
});
