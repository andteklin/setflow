import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import { Library } from "../src/library.js";
import { SCHEMA_VERSION, Store } from "../src/store.js";

const FIXTURE = fs.readFileSync(path.join(import.meta.dirname, "../../core/test/fixtures/sample-variants.cho"), "utf8");

describe("schema migrations", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setflow-migrate-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("upgrades a database made before migrations existed, keeping its data", () => {
    const file = path.join(dir, "old.db");
    // Exactly what SetFlow 0.1 created: tables but no user_version, and setlist items without itemId.
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE songs (id TEXT PRIMARY KEY, title TEXT NOT NULL, source_text TEXT NOT NULL, revision INTEGER NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE arrangements (id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE, name TEXT NOT NULL, song_map TEXT NOT NULL, performance_key TEXT, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE setlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, items TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE recovery (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL);
      INSERT INTO songs VALUES ('s1', 'Song', 'text', 3, '{}', 'x', 'x');
      INSERT INTO arrangements VALUES ('a1', 's1', 'Source Order', 'V1', NULL, 1, 'x');
      INSERT INTO setlists VALUES ('l1', 'Sunday', '[{"songId":"s1","arrangementId":"a1"},{"songId":"s1","arrangementId":"a1"}]', 1, 'x');
    `);
    old.close();

    const store = new Store(file);
    assert.equal(store.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(store.getArrangement("a1")?.notes, [], "older arrangements start with no notes");
    assert.equal(store.getSong("s1")?.revision, 3);
    const items = store.getSetlist("l1")!.items;
    assert.equal(items.length, 2);
    assert.ok(items.every((i) => typeof i.itemId === "string" && i.itemId.length > 0));
    assert.notEqual(items[0].itemId, items[1].itemId, "the same song twice gets two identities");
    store.close();

    // Running again changes nothing: the ids stay put.
    const again = new Store(file);
    assert.deepEqual(again.getSetlist("l1")!.items, items);
    again.close();
  });

  it("refuses a database from a newer SetFlow instead of guessing", () => {
    const file = path.join(dir, "future.db");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA user_version = 99");
    db.close();
    assert.throws(() => new Store(file), /newer than this SetFlow/);
  });
});

describe("setlist items (issue #6)", () => {
  const store = new Store(":memory:");
  const library = new Library(store);
  after(() => store.close());

  it("keeps an entry's identity when its arrangement or key is changed after adding it", () => {
    const song = library.importSong({ text: FIXTURE });
    const sourceOrder = song.arrangements[0];
    const sunday = library.createArrangement(song.song.id, { name: "Sunday", songMap: "V1, C1A, E" });

    const created = library.saveSetlist(null, {
      name: "Sunday",
      items: [
        { songId: song.song.id, arrangementId: sourceOrder.id },
        { songId: song.song.id, arrangementId: sourceOrder.id },
      ],
    });
    const [first, second] = created.items;
    assert.notEqual(first.itemId, second.itemId);

    const edited = library.saveSetlist(created.id, {
      name: "Sunday",
      items: [{ ...first, arrangementId: sunday.id, performanceKey: "D" }, second],
    });
    assert.deepEqual(edited.items[0], { itemId: first.itemId, songId: song.song.id, arrangementId: sunday.id, performanceKey: "D" });
    assert.equal(edited.items[1].itemId, second.itemId);
  });

  it("gives a pasted duplicate entry its own id", () => {
    const song = library.importSong({ text: FIXTURE });
    const a = song.arrangements[0];
    const saved = library.saveSetlist(null, {
      name: "Copy",
      items: [
        { itemId: "same", songId: song.song.id, arrangementId: a.id },
        { itemId: "same", songId: song.song.id, arrangementId: a.id },
      ],
    });
    assert.equal(saved.items[0].itemId, "same");
    assert.notEqual(saved.items[1].itemId, "same");
  });

  it("still rejects an arrangement from a different song", () => {
    const one = library.importSong({ text: FIXTURE });
    const two = library.importSong({ text: FIXTURE });
    assert.throws(
      () => library.saveSetlist(null, { name: "Bad", items: [{ songId: one.song.id, arrangementId: two.arrangements[0].id }] }),
      /does not belong/,
    );
  });
});
