import { randomUUID } from "node:crypto";
import {
  ArrangedEditError,
  arrangedChordPro,
  fitNotes,
  formatSongMap,
  isNoteLine,
  parseArrangedNotes,
  parseChordPro,
  parseSongMap,
  songMetadata,
  sourceOrderArrangement,
  type ArrangementItem,
  type ArrangementNote,
  type ParsedSong,
} from "@setflow/core";
import type {
  ArrangementRecord,
  ArrangementView,
  ImportPreview,
  SectionSummary,
  SetlistItem,
  SetlistRecord,
  SongDetail,
  SongRecord,
  SongSummary,
} from "./protocol.js";
import type { Store } from "./store.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const SOURCE_ORDER_NAME = "Source Order";

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
    input: { name?: string; songMap?: string; performanceKey?: string | null; notes?: unknown; expectedRevision?: number },
  ): ArrangementView {
    const current = this.getArrangement(id);
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      throw new HttpError(409, `Arrangement changed since you opened it (revision ${current.revision}); reload and retry.`);
    }
    const parsed = parseChordPro(this.getSong(current.songId).sourceText);
    const songMap = input.songMap !== undefined ? this.canonicalMap(parsed, input.songMap) : current.songMap;
    // Notes travel with the map: the editor re-indexes them when it reorders items. Any that no longer fit are dropped.
    const notes = input.notes !== undefined ? validateNotes(input.notes) : current.notes;
    const record = this.store.updateArrangement(id, {
      name: input.name !== undefined ? required(input.name, "Arrangement name").trim() : current.name,
      songMap,
      performanceKey: input.performanceKey !== undefined ? input.performanceKey || null : current.performanceKey,
      notes: fitNotes(parsed, resolveSongMap(parsed, songMap), notes),
    });
    return this.view(parsed, record);
  }

  /** The arrangement as one chronological ChordPro chart, with its own notes woven in (issue #9). */
  arrangedChordPro(id: string): { text: string; revision: number } {
    const a = this.getArrangement(id);
    const parsed = parseChordPro(this.getSong(a.songId).sourceText);
    const items = this.resolveOrFail(parsed, a);
    return { text: arrangedChordPro(parsed, items, a.notes, { songMap: a.songMap }), revision: a.revision };
  }

  /**
   * Save an edited arranged chart. Only comment lines may change: they become
   * the arrangement's notes. The song's own lines are refused, with the line
   * number, because they belong to the shared source (spec §2.3).
   */
  saveArrangedChordPro(id: string, text: unknown, expectedRevision?: number): ArrangementView {
    const a = this.getArrangement(id);
    if (expectedRevision !== undefined && expectedRevision !== a.revision) {
      throw new HttpError(409, `Arrangement changed since you opened it (revision ${a.revision}); reload and retry.`);
    }
    const parsed = parseChordPro(this.getSong(a.songId).sourceText);
    const items = this.resolveOrFail(parsed, a);
    let notes: ArrangementNote[];
    try {
      notes = parseArrangedNotes(parsed, items, required(text, "Arranged ChordPro"), { songMap: a.songMap });
    } catch (err) {
      if (err instanceof ArrangedEditError) throw new HttpError(400, err.message);
      throw err;
    }
    return this.view(parsed, this.store.updateArrangement(id, { ...a, notes }));
  }

  duplicateArrangement(id: string, name?: string): ArrangementView {
    const source = this.getArrangement(id);
    const parsed = parseChordPro(this.getSong(source.songId).sourceText);
    const record = this.store.insertArrangement({
      songId: source.songId,
      name: name?.trim() || `${source.name} (copy)`,
      songMap: source.songMap,
      performanceKey: source.performanceKey,
      notes: source.notes,
    });
    return this.view(parsed, record);
  }

  /** Set a saved arrangement back to source order (spec §12). */
  restoreSourceOrder(id: string): ArrangementView {
    const current = this.getArrangement(id);
    const parsed = parseChordPro(this.getSong(current.songId).sourceText);
    const songMap = parsed.sections.length ? formatSongMap(parsed, sourceOrderArrangement(parsed)) : "";
    // A rebuilt map has new items, so notes anchored to the old ones are cleared.
    return this.view(parsed, this.store.updateArrangement(id, { ...current, songMap, notes: [] }));
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
    const seen = new Set<string>();
    return items.map((raw) => {
      const item = raw as Partial<SetlistItem>;
      const arrangement = this.getArrangement(required(item.arrangementId, "Setlist item arrangementId"));
      if (arrangement.songId !== item.songId) {
        throw new HttpError(400, `Arrangement ${arrangement.id} does not belong to song ${item.songId}`);
      }
      // Keep the client's id so an entry stays the same entry across edits; mint one for new or duplicated entries.
      const itemId = typeof item.itemId === "string" && item.itemId && !seen.has(item.itemId) ? item.itemId : randomUUID();
      seen.add(itemId);
      return {
        itemId,
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

  private resolveOrFail(parsed: ParsedSong, a: ArrangementRecord): ArrangementItem[] {
    try {
      return resolveSongMap(parsed, a.songMap);
    } catch (err) {
      throw new HttpError(409, `Arrangement "${a.name}" no longer matches the song: ${(err as Error).message}`);
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

/** Check notes sent by a client: whole numbers for positions, and comment lines only. */
function validateNotes(raw: unknown): ArrangementNote[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "notes must be a list");
  return raw.map((n: Partial<ArrangementNote>) => {
    const whole = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
    if (!n || !whole(n.item) || !whole(n.repetition) || !whole(n.afterLine) || typeof n.sectionId !== "string" || typeof n.text !== "string") {
      throw new HttpError(400, "Each note needs item, repetition, afterLine, sectionId and text");
    }
    if (!isNoteLine(n.text)) throw new HttpError(400, `Only comment lines can be arrangement notes: "${n.text}"`);
    return { item: n.item!, repetition: n.repetition!, sectionId: n.sectionId, afterLine: n.afterLine!, text: n.text };
  });
}
