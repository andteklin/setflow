import {
  formatSongMap,
  parseChordPro,
  parseSongMap,
  songMetadata,
  sourceOrderArrangement,
  type ArrangementItem,
  type ParsedSong,
  type SongMetadata,
} from "@setflow/core";
import type { ArrangementRecord, Provenance, SetlistItem, SetlistRecord, SongRecord, Store } from "./store.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const SOURCE_ORDER_NAME = "Source Order";

export interface SectionSummary {
  id: string;
  token: string;
  sourceLabel: string;
  displayLabel: string;
  type: string;
  lineCount: number;
}

export interface ImportPreview {
  metadata: SongMetadata;
  sections: SectionSummary[];
  sourceOrderMap: string;
  warnings: string[];
}

export interface ArrangementView extends ArrangementRecord {
  /** Resolved against the current song source; null when the map no longer matches it. */
  items: ArrangementItem[] | null;
  error: string | null;
}

export interface SongSummary {
  id: string;
  title: string;
  artist?: string;
  originalKey?: string;
  revision: number;
  sectionCount: number;
  provenance: Provenance;
  updatedAt: string;
}

export interface SongDetail {
  song: SongRecord;
  metadata: SongMetadata;
  sections: SectionSummary[];
  arrangements: ArrangementView[];
}

export function summarizeSections(song: ParsedSong): SectionSummary[] {
  return song.sections.map((s) => ({
    id: s.id,
    token: s.token,
    sourceLabel: s.sourceLabel,
    displayLabel: s.displayLabel,
    type: s.type,
    lineCount: s.rawLines.filter((l) => l.trim() !== "").length,
  }));
}

/** Resolve stored map text against a parsed song. An empty map is a valid, empty arrangement. */
export function resolveSongMap(song: ParsedSong, songMap: string): ArrangementItem[] {
  return songMap.trim() === "" ? [] : parseSongMap(songMap, song);
}

const required = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new HttpError(400, `${name} is required`);
  return value;
};

/** Song, arrangement and setlist operations. Licensed content never leaves this host (spec §16.2). */
export class Library {
  constructor(private readonly store: Store) {}

  preview(text: string): ImportPreview {
    const song = parseChordPro(required(text, "ChordPro text"));
    const metadata = songMetadata(song);
    const warnings: string[] = [];
    if (!metadata.title) warnings.push("No {title: ...} found; the file name or 'Untitled' will be used.");
    if (song.sections.length === 0) {
      warnings.push("No sections detected. Mark sections with {comment: Verse 1} style lines.");
    }
    return {
      metadata,
      sections: summarizeSections(song),
      sourceOrderMap: song.sections.length ? formatSongMap(song, sourceOrderArrangement(song)) : "",
      warnings,
    };
  }

  /** Import and save a song with an automatic Source Order arrangement (spec §10). */
  importSong(input: { text: string; providerId?: string; fileName?: string }): SongDetail {
    const text = required(input.text, "ChordPro text");
    const providerId = input.providerId ?? "paste";
    if (providerId !== "file" && providerId !== "paste" && providerId !== "manual") {
      throw new HttpError(400, `Unsupported song provider: ${providerId}`);
    }
    const preview = this.preview(text);
    const title = preview.metadata.title || input.fileName?.replace(/\.[^.]+$/, "") || "Untitled";
    const song = this.store.insertSong({
      title,
      sourceText: text,
      provenance: {
        providerId,
        ...(input.fileName && { fileName: input.fileName }),
        importedAt: new Date().toISOString(),
        storagePolicy: "organization-local",
      },
    });
    this.store.insertArrangement({
      songId: song.id,
      name: SOURCE_ORDER_NAME,
      songMap: preview.sourceOrderMap,
      performanceKey: null,
    });
    return this.songDetail(song.id);
  }

  listSongs(): SongSummary[] {
    return this.store.listSongs().map((song) => {
      const parsed = parseChordPro(song.sourceText);
      const metadata = songMetadata(parsed);
      return {
        id: song.id,
        title: song.title,
        ...(metadata.artist && { artist: metadata.artist }),
        ...(metadata.originalKey && { originalKey: metadata.originalKey }),
        revision: song.revision,
        sectionCount: parsed.sections.length,
        provenance: song.provenance,
        updatedAt: song.updatedAt,
      };
    });
  }

  getSong(id: string): SongRecord {
    const song = this.store.getSong(id);
    if (!song) throw new HttpError(404, `No song ${id}`);
    return song;
  }

  songDetail(id: string): SongDetail {
    const song = this.getSong(id);
    const parsed = parseChordPro(song.sourceText);
    return {
      song,
      metadata: songMetadata(parsed),
      sections: summarizeSections(parsed),
      arrangements: this.store.listArrangements(id).map((a) => this.view(parsed, a)),
    };
  }

  /** Replace a song's source. Arrangements keep their map text and are re-resolved against it. */
  updateSource(id: string, text: string, expectedRevision?: number): SongDetail {
    const current = this.getSong(id);
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new HttpError(409, `Song changed since you opened it (revision ${current.revision}); reload and retry.`);
    }
    const metadata = songMetadata(parseChordPro(required(text, "ChordPro text")));
    this.store.updateSong(id, { title: metadata.title || current.title, sourceText: text });
    return this.songDetail(id);
  }

  deleteSong(id: string): void {
    if (!this.store.deleteSong(id)) throw new HttpError(404, `No song ${id}`);
    for (const setlist of this.store.listSetlists()) {
      const items = setlist.items.filter((i) => i.songId !== id);
      if (items.length !== setlist.items.length) this.store.updateSetlist(setlist.id, { name: setlist.name, items });
    }
  }

  getArrangement(id: string): ArrangementRecord {
    const arrangement = this.store.getArrangement(id);
    if (!arrangement) throw new HttpError(404, `No arrangement ${id}`);
    return arrangement;
  }

  createArrangement(songId: string, input: { name?: string; songMap?: string; performanceKey?: string | null }): ArrangementView {
    const parsed = parseChordPro(this.getSong(songId).sourceText);
    const name = required(input.name, "Arrangement name").trim();
    const songMap = this.canonicalMap(parsed, input.songMap ?? "");
    const record = this.store.insertArrangement({ songId, name, songMap, performanceKey: input.performanceKey || null });
    return this.view(parsed, record);
  }

  updateArrangement(
    id: string,
    input: { name?: string; songMap?: string; performanceKey?: string | null; expectedRevision?: number },
  ): ArrangementView {
    const current = this.getArrangement(id);
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      throw new HttpError(409, `Arrangement changed since you opened it (revision ${current.revision}); reload and retry.`);
    }
    const parsed = parseChordPro(this.getSong(current.songId).sourceText);
    const record = this.store.updateArrangement(id, {
      name: input.name !== undefined ? required(input.name, "Arrangement name").trim() : current.name,
      songMap: input.songMap !== undefined ? this.canonicalMap(parsed, input.songMap) : current.songMap,
      performanceKey: input.performanceKey !== undefined ? input.performanceKey || null : current.performanceKey,
    });
    return this.view(parsed, record);
  }

  duplicateArrangement(id: string, name?: string): ArrangementView {
    const source = this.getArrangement(id);
    const parsed = parseChordPro(this.getSong(source.songId).sourceText);
    const record = this.store.insertArrangement({
      songId: source.songId,
      name: name?.trim() || `${source.name} (copy)`,
      songMap: source.songMap,
      performanceKey: source.performanceKey,
    });
    return this.view(parsed, record);
  }

  /** Set a saved arrangement back to source order (spec §12). */
  restoreSourceOrder(id: string): ArrangementView {
    const current = this.getArrangement(id);
    const parsed = parseChordPro(this.getSong(current.songId).sourceText);
    const songMap = parsed.sections.length ? formatSongMap(parsed, sourceOrderArrangement(parsed)) : "";
    return this.view(parsed, this.store.updateArrangement(id, { ...current, songMap }));
  }

  deleteArrangement(id: string): void {
    if (!this.store.deleteArrangement(id)) throw new HttpError(404, `No arrangement ${id}`);
  }

  listSetlists(): SetlistRecord[] {
    return this.store.listSetlists();
  }

  getSetlist(id: string): SetlistRecord {
    const setlist = this.store.getSetlist(id);
    if (!setlist) throw new HttpError(404, `No setlist ${id}`);
    return setlist;
  }

  saveSetlist(id: string | null, input: { name?: string; items?: unknown }): SetlistRecord {
    const name = required(input.name, "Setlist name").trim();
    const items = this.validateSetlistItems(input.items ?? []);
    if (id === null) return this.store.insertSetlist({ name, items });
    this.getSetlist(id);
    return this.store.updateSetlist(id, { name, items });
  }

  deleteSetlist(id: string): void {
    if (!this.store.deleteSetlist(id)) throw new HttpError(404, `No setlist ${id}`);
  }

  private validateSetlistItems(items: unknown): SetlistItem[] {
    if (!Array.isArray(items)) throw new HttpError(400, "Setlist items must be a list");
    return items.map((raw) => {
      const item = raw as Partial<SetlistItem>;
      const arrangement = this.getArrangement(required(item.arrangementId, "Setlist item arrangementId"));
      if (arrangement.songId !== item.songId) {
        throw new HttpError(400, `Arrangement ${arrangement.id} does not belong to song ${item.songId}`);
      }
      return {
        songId: arrangement.songId,
        arrangementId: arrangement.id,
        ...(item.performanceKey && { performanceKey: item.performanceKey }),
      };
    });
  }

  /** Validate a map against the song and store it in its canonical "I → V1 → B×2" form. */
  private canonicalMap(parsed: ParsedSong, songMap: string): string {
    try {
      const items = resolveSongMap(parsed, songMap);
      return items.length ? formatSongMap(parsed, items) : "";
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  }

  private view(parsed: ParsedSong, record: ArrangementRecord): ArrangementView {
    try {
      return { ...record, items: resolveSongMap(parsed, record.songMap), error: null };
    } catch (err) {
      return { ...record, items: null, error: (err as Error).message };
    }
  }
}
