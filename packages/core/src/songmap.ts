import type { ArrangementItem, ParsedSong, SongSection } from "./types.js";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function resolveSection(song: ParsedSong, name: string): SongSection {
  const key = norm(name);
  const hit =
    song.sections.find((s) => norm(s.token) === key) ??
    song.sections.find((s) => norm(s.sourceLabel) === key);
  if (hit) return hit;

  // Never guess between variants: "C" does not silently pick C1A over C1B.
  const near = song.sections.filter((s) => norm(s.token).startsWith(key)).map((s) => s.token);
  const hint = near.length > 0 ? ` Did you mean: ${near.join(", ")}?` : "";
  const all = song.sections.map((s) => s.token).join(", ");
  throw new Error(`Unknown section "${name.trim()}".${hint} Available: ${all}`);
}

/** Format an arrangement as a song map that `parseSongMap` reads back: "I → V1 → B×2". */
export function formatSongMap(song: ParsedSong, arrangement: readonly ArrangementItem[]): string {
  const tokenById = new Map(song.sections.map((s) => [s.id, s.token]));
  return arrangement
    .map((item) => {
      const token = tokenById.get(item.sectionId);
      if (token === undefined) throw new Error(`Unknown section: ${item.sectionId}`);
      return item.repetitions > 1 ? `${token}×${item.repetitions}` : token;
    })
    .join(" → ");
}

/**
 * Parse a compact song map such as "V1,C1A,B*3,C1C×2,E".
 * Separators: `,` `->` `→`. Repeats: `*N` or `×N`. Names match a section token
 * or its source label, case-insensitively.
 */
export function parseSongMap(spec: string, song: ParsedSong): ArrangementItem[] {
  const tokens = spec.split(/\s*(?:,|->|→)\s*/).filter((t) => t.trim() !== "");
  if (tokens.length === 0) throw new Error("Song map is empty");

  return tokens.map((token) => {
    const m = /^(.*?)\s*[*×]\s*(\d+)$/.exec(token.trim());
    const name = m ? m[1] : token;
    const repetitions = m ? Number(m[2]) : 1;
    if (repetitions < 1) throw new Error(`Repetition count must be at least 1: "${token.trim()}"`);
    return { sectionId: resolveSection(song, name).id, repetitions };
  });
}
