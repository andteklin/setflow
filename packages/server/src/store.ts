import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PerformanceState } from "@setflow/core";

/** Where a song came from (spec §16.1–16.2). Content stays on this host. */
export interface Provenance {
  providerId: "file" | "paste" | "manual";
  fileName?: string;
  importedAt: string;
  storagePolicy: "organization-local";
}

export interface SongRecord {
  id: string;
  title: string;
  /** The ChordPro exactly as imported or last edited. Reparsed on every read. */
  sourceText: string;
  revision: number;
  provenance: Provenance;
  createdAt: string;
  updatedAt: string;
}

/** A saved Song Map. Stored as map text ("I → V1 → B×2") so it survives source edits that renumber sections. */
export interface ArrangementRecord {
  id: string;
  songId: string;
  name: string;
  songMap: string;
  performanceKey: string | null;
  revision: number;
  updatedAt: string;
}

export interface SetlistItem {
  songId: string;
  arrangementId: string;
  performanceKey?: string;
}

export interface SetlistRecord {
  id: string;
  name: string;
  items: SetlistItem[];
  revision: number;
  updatedAt: string;
}

/** What is pinned to a live session: the exact song text and arrangement it started from. */
export interface PinnedContent {
  songId: string;
  songRevision: number;
  title: string;
  sourceText: string;
  arrangementId: string;
  arrangementName: string;
  songMap: string;
}

export interface RecoverySnapshot {
  state: PerformanceState;
  pinned: PinnedContent;
  controllerId: string;
  savedAt: string;
}

const now = () => new Date().toISOString();

/** Local SQLite persistence (spec §25). Synchronous on purpose: every write is committed before it is acknowledged. */
export class Store {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
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
    `);
  }

  close(): void {
    this.db.close();
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

  insertArrangement(a: { songId: string; name: string; songMap: string; performanceKey: string | null }): ArrangementRecord {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO arrangements VALUES (?, ?, ?, ?, ?, 1, ?)")
      .run(id, a.songId, a.name, a.songMap, a.performanceKey, now());
    return this.getArrangement(id)!;
  }

  updateArrangement(id: string, a: { name: string; songMap: string; performanceKey: string | null }): ArrangementRecord {
    this.db
      .prepare(
        "UPDATE arrangements SET name = ?, song_map = ?, performance_key = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
      )
      .run(a.name, a.songMap, a.performanceKey, now(), id);
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
