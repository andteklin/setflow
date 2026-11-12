import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ArrangementNote, PerformanceState } from "@setflow/core";
import type { ArrangementRecord, Provenance, SetlistItem, SetlistRecord, SongRecord } from "./protocol.js";

export type { ArrangementRecord, Provenance, SetlistItem, SetlistRecord, SongRecord };

/** What is pinned to a live session: the exact song text and arrangement it started from. */
export interface PinnedContent {
  songId: string;
  songRevision: number;
  title: string;
  sourceText: string;
  arrangementId: string;
  arrangementName: string;
  songMap: string;
  /** The arrangement's own comment lines (issue #9). Missing in snapshots from before they existed. */
  notes?: ArrangementNote[];
}

/** One setlist entry, frozen when the setlist starts: what will be played, whatever the library does meanwhile. */
export interface ServiceItemPin extends PinnedContent {
  itemId: string;
  arrangementRevision: number;
  performanceKey: string;
}

/** A setlist being performed (issue #7): its entries pinned at start, and which one is loaded. */
export interface ServiceSnapshot {
  setlistId: string;
  name: string;
  index: number;
  items: ServiceItemPin[];
}

export interface RecoverySnapshot {
  state: PerformanceState;
  pinned: PinnedContent;
  controllerId: string;
  savedAt: string;
  /** Present when the song was part of a running setlist. Older snapshots have none. */
  service?: ServiceSnapshot;
}

const now = () => new Date().toISOString();

/** Local SQLite persistence (spec §25). Synchronous on purpose: every write is committed before it is acknowledged. */
export class Store {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      migrate(this.db);
    } catch (err) {
      this.db.close(); // Don't leave the file locked when it can't be opened.
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  /** Schema version of the open database: the number of migrations applied. */
  get schemaVersion(): number {
    return userVersion(this.db);
  }

  // Songs

  listSongs(): SongRecord[] {
    return this.db.prepare("SELECT * FROM songs ORDER BY title COLLATE NOCASE").all().map(toSong);
  }

  getSong(id: string): SongRecord | undefined {
    const row = this.db.prepare("SELECT * FROM songs WHERE id = ?").get(id);
    return row ? toSong(row) : undefined;
  }

  insertSong(song: { title: string; sourceText: string; provenance: Provenance }): SongRecord {
    const id = randomUUID();
    const at = now();
    this.db
      .prepare("INSERT INTO songs VALUES (?, ?, ?, 1, ?, ?, ?)")
      .run(id, song.title, song.sourceText, JSON.stringify(song.provenance), at, at);
    return this.getSong(id)!;
  }

  updateSong(id: string, fields: { title: string; sourceText: string }): SongRecord {
    this.db
      .prepare("UPDATE songs SET title = ?, source_text = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
      .run(fields.title, fields.sourceText, now(), id);
    return this.getSong(id)!;
  }

  deleteSong(id: string): boolean {
    return this.db.prepare("DELETE FROM songs WHERE id = ?").run(id).changes > 0;
  }

  // Arrangements

  listArrangements(songId: string): ArrangementRecord[] {
    return this.db
      .prepare("SELECT * FROM arrangements WHERE song_id = ? ORDER BY rowid")
      .all(songId)
      .map(toArrangement);
  }

  getArrangement(id: string): ArrangementRecord | undefined {
    const row = this.db.prepare("SELECT * FROM arrangements WHERE id = ?").get(id);
    return row ? toArrangement(row) : undefined;
  }

  insertArrangement(a: { songId: string; name: string; songMap: string; performanceKey: string | null; notes?: ArrangementNote[] }): ArrangementRecord {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO arrangements (id, song_id, name, song_map, performance_key, revision, updated_at, notes) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
      .run(id, a.songId, a.name, a.songMap, a.performanceKey, now(), JSON.stringify(a.notes ?? []));
    return this.getArrangement(id)!;
  }

  updateArrangement(id: string, a: { name: string; songMap: string; performanceKey: string | null; notes: ArrangementNote[] }): ArrangementRecord {
    this.db
      .prepare(
        "UPDATE arrangements SET name = ?, song_map = ?, performance_key = ?, notes = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
      )
      .run(a.name, a.songMap, a.performanceKey, JSON.stringify(a.notes), now(), id);
    return this.getArrangement(id)!;
  }

  deleteArrangement(id: string): boolean {
    return this.db.prepare("DELETE FROM arrangements WHERE id = ?").run(id).changes > 0;
  }

  // Setlists

  listSetlists(): SetlistRecord[] {
    return this.db.prepare("SELECT * FROM setlists ORDER BY name COLLATE NOCASE").all().map(toSetlist);
  }

  getSetlist(id: string): SetlistRecord | undefined {
    const row = this.db.prepare("SELECT * FROM setlists WHERE id = ?").get(id);
    return row ? toSetlist(row) : undefined;
  }

  insertSetlist(s: { name: string; items: SetlistItem[] }): SetlistRecord {
    const id = randomUUID();
    this.db.prepare("INSERT INTO setlists VALUES (?, ?, ?, 1, ?)").run(id, s.name, JSON.stringify(s.items), now());
    return this.getSetlist(id)!;
  }

  updateSetlist(id: string, s: { name: string; items: SetlistItem[] }): SetlistRecord {
    this.db
      .prepare("UPDATE setlists SET name = ?, items = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
      .run(s.name, JSON.stringify(s.items), now(), id);
    return this.getSetlist(id)!;
  }

  deleteSetlist(id: string): boolean {
    return this.db.prepare("DELETE FROM setlists WHERE id = ?").run(id).changes > 0;
  }

  // Settings (keyboard/MIDI mappings and other host preferences)

  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  // Recovery: the last committed live snapshot (spec §25)

  saveRecovery(snapshot: RecoverySnapshot): void {
    this.db
      .prepare("INSERT INTO recovery VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot")
      .run(JSON.stringify(snapshot));
  }

  loadRecovery(): RecoverySnapshot | undefined {
    const row = this.db.prepare("SELECT snapshot FROM recovery WHERE id = 1").get() as { snapshot: string } | undefined;
    return row ? (JSON.parse(row.snapshot) as RecoverySnapshot) : undefined;
  }

  clearRecovery(): void {
    this.db.prepare("DELETE FROM recovery").run();
  }
}

type Row = Record<string, unknown>;

function toSong(row: Row): SongRecord {
  return {
    id: row.id as string,
    title: row.title as string,
    sourceText: row.source_text as string,
    revision: Number(row.revision),
    provenance: JSON.parse(row.provenance as string) as Provenance,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toArrangement(row: Row): ArrangementRecord {
  return {
    id: row.id as string,
    songId: row.song_id as string,
    name: row.name as string,
    songMap: row.song_map as string,
    performanceKey: (row.performance_key as string | null) ?? null,
    notes: JSON.parse((row.notes as string | undefined) ?? "[]") as ArrangementNote[],
    revision: Number(row.revision),
    updatedAt: row.updated_at as string,
  };
}

function toSetlist(row: Row): SetlistRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    items: JSON.parse(row.items as string) as SetlistItem[],
    revision: Number(row.revision),
    updatedAt: row.updated_at as string,
  };
}

/**
 * Schema migrations, applied in order and recorded in `PRAGMA user_version`.
 * Append only: never edit or reorder a released step, because hosts in the
 * field have already run it. Each step runs in its own transaction.
 */
const MIGRATIONS: ReadonlyArray<(db: DatabaseSync) => void> = [
  // 1. The original schema. IF NOT EXISTS lets databases made before migrations existed adopt it.
  (db) =>
    db.exec(`
      CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_text TEXT NOT NULL,
        revision INTEGER NOT NULL,
        provenance TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS arrangements (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        song_map TEXT NOT NULL,
        performance_key TEXT,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS setlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        items TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL);
    `),
  // 2. Give every setlist item a stable itemId, so the same song can appear twice and be addressed exactly.
  (db) => {
    const rows = db.prepare("SELECT id, items FROM setlists").all() as Array<{ id: string; items: string }>;
    const update = db.prepare("UPDATE setlists SET items = ? WHERE id = ?");
    for (const row of rows) {
      const items = JSON.parse(row.items) as Array<Partial<SetlistItem>>;
      update.run(JSON.stringify(items.map((item) => ({ ...item, itemId: item.itemId ?? randomUUID() }))), row.id);
    }
  },
  // 3. Arrangement-only comment lines (issue #9), as JSON ArrangementNote[].
  (db) => db.exec("ALTER TABLE arrangements ADD COLUMN notes TEXT NOT NULL DEFAULT '[]'"),
];

function userVersion(db: DatabaseSync): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
}

function migrate(db: DatabaseSync): void {
  const from = userVersion(db);
  if (from > MIGRATIONS.length) {
    // Opening a newer database with older software could silently drop data; refuse instead.
    throw new Error(
      `This SetFlow database is schema version ${from}, newer than this SetFlow (${MIGRATIONS.length}). Update SetFlow to open it.`,
    );
  }
  for (let version = from; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      MIGRATIONS[version](db);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/** The schema version this SetFlow writes: one per migration. */
export const SCHEMA_VERSION = MIGRATIONS.length;
