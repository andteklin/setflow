import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyArrangement,
  classifySectionLabel,
  formatSongMap,
  normalizeSectionLabel,
  parseChordPro,
  parseSongMap,
  SECTION_TYPES,
  serializeChordPro,
  sourceOrderArrangement,
  type ParsedSong,
} from "../src/arranger";

// Made-up chart in SongSelect style: every section is a {comment: ...} marker.
const CHART = `{title: Lantern Hymn (Example)}
{key: G}

{comment: Intro}
[G] [D] [Em] [C]

{comment: Verse 1}
First [G]line of the [D]verse

{comment: Pre Chorus}
Rising [Em]now, ris-[C]ing

{comment: Chorus 1a}
Sing it [G]out, sing it [D]loud

{comment: Verse 2}
Second [G]line of the [D]verse

{comment: Chorus 1b}
Sing it [G]out, sing it [Am]louder

{comment: Instrumental}
[G] [D] [Em] [C]

{comment: Interlude}
[C] [D]

{comment: Bridge}
Bridge [Em]words [C]here

{comment: Refrain}
Refrain [G]words

{comment: Ending}
[G]Final [D/F#]line [G]
`;

const section = (song: ParsedSong, token: string) => {
  const s = song.sections.find((x) => x.token === token);
  assert.ok(s, `no section ${token}`);
  return s;
};

const tokens = (song: ParsedSong) => song.sections.map((s) => s.token);

describe("section type vocabulary", () => {
  it("gives every type a unique id and token, and non-empty aliases", () => {
    assert.equal(new Set(SECTION_TYPES.map((t) => t.id)).size, SECTION_TYPES.length);
    assert.equal(new Set(SECTION_TYPES.map((t) => t.token)).size, SECTION_TYPES.length);
    for (const t of SECTION_TYPES) assert.ok(t.aliases.length > 0, t.id);
  });

  it("maps canonical names to their tokens", () => {
    const cases: Array<[string, string, string]> = [
      ["Intro", "intro", "I"],
      ["Introduction", "intro", "I"],
      ["Verse", "verse", "V"],
      ["Pre-Chorus", "prechorus", "PC"],
      ["Chorus", "chorus", "C"],
      ["Bridge", "bridge", "B"],
      ["Refrain", "refrain", "RF"],
      ["Instrumental", "instrumental", "INST"],
      ["Instrumental Break", "instrumental", "INST"],
      ["Interlude", "interlude", "INT"],
      ["Solo", "solo", "SOLO"],
      ["Tag", "tag", "T"],
      ["Vamp", "vamp", "VAMP"],
      ["Turnaround", "turnaround", "TA"],
      ["Turn", "turnaround", "TA"],
      ["Breakdown", "breakdown", "BD"],
      ["Outro", "outro", "O"],
      ["Ending", "ending", "E"],
      ["End", "ending", "E"],
      ["Count-In", "countin", "CI"],
      ["Count In", "countin", "CI"],
      ["Click", "click", "CLK"],
    ];
    for (const [raw, type, token] of cases) {
      const c = classifySectionLabel(raw);
      assert.equal(c?.type, type, raw);
      assert.equal(c?.token, token, raw);
    }
  });

  it("ignores capitalization, spacing, hyphens and underscores", () => {
    for (const raw of ["CHORUS", "chorus", "  Chorus  ", "Chorus:"]) {
      assert.equal(classifySectionLabel(raw)?.token, "C", raw);
    }
    for (const raw of ["Pre-Chorus", "Pre Chorus", "Prechorus", "PRE-CHORUS", "pre_chorus", "pre  chorus"]) {
      assert.equal(classifySectionLabel(raw)?.token, "PC", raw);
    }
    assert.equal(classifySectionLabel("CHORUS  1A")?.token, "C1A");
    assert.equal(classifySectionLabel("verse1")?.token, "V1");
    assert.equal(classifySectionLabel("Pre-Chorus 2")?.token, "PC2");
  });

  it("accepts the short tokens themselves as names", () => {
    for (const [raw, token] of [["V1", "V1"], ["c1a", "C1A"], ["PC", "PC"], ["inst", "INST"], ["RF", "RF"]]) {
      assert.equal(classifySectionLabel(raw)?.token, token, raw);
    }
  });

  it("supports numbered and lettered variants", () => {
    const cases: Array<[string, string]> = [
      ["Verse 1", "V1"],
      ["Verse 2", "V2"],
      ["Chorus 1", "C1"],
      ["Chorus 1a", "C1A"],
      ["Chorus 1b", "C1B"],
      ["Chorus 1 b", "C1B"],
      ["Chorus A", "CA"],
      ["Bridge 2", "B2"],
      ["Refrain 1", "RF1"],
      ["Instrumental 2", "INST2"],
    ];
    for (const [raw, token] of cases) assert.equal(classifySectionLabel(raw)?.token, token, raw);
  });

  it("builds a readable display label", () => {
    assert.equal(classifySectionLabel("pre chorus")?.displayLabel, "Pre-Chorus");
    assert.equal(classifySectionLabel("chorus 1a")?.displayLabel, "Chorus 1A");
    assert.equal(classifySectionLabel("verse 2")?.displayLabel, "Verse 2");
  });

  it("keeps instrumental and interlude distinct", () => {
    const inst = classifySectionLabel("Instrumental")!;
    const inter = classifySectionLabel("Interlude")!;
    assert.notEqual(inst.type, inter.type);
    assert.notEqual(inst.token, inter.token);
  });
});

describe("custom (unknown) section names", () => {
  const NAMES = ["Spontaneous", "Prayer", "Breakdown Chorus", "Down Chorus", "Big Chorus"];

  it("never classifies uncertain names as a canonical type", () => {
    for (const name of NAMES) {
      assert.equal(classifySectionLabel(name), null, name);
      const c = normalizeSectionLabel(name);
      assert.equal(c.type, "custom", name);
      assert.equal(c.known, false, name);
      assert.equal(c.displayLabel, name);
    }
  });

  it("parses without failing, preserving each source label", () => {
    const body = NAMES.map((n) => `\n{comment: ${n}}\n[C]${n} words`).join("\n");
    const song = parseChordPro(`{title: Custom Example}\n${body}\n`);
    assert.deepEqual(
      song.sections.map((s) => s.sourceLabel),
      NAMES,
    );
    assert.ok(song.sections.every((s) => s.type === "custom"));
    assert.deepEqual(song.sections[2].rawLines, ["[C]Breakdown Chorus words"]);
  });

  it("generates unique tokens that never collide with the vocabulary", () => {
    const body = [...NAMES, "Prayer", "Big Chorus"].map((n) => `\n{comment: ${n}}\n[C]line`).join("\n");
    const song = parseChordPro(body);
    const toks = tokens(song);
    assert.equal(new Set(toks).size, toks.length, toks.join(","));
    for (const t of toks) assert.equal(classifySectionLabel(t.replace(/#\d+$/, "")), null, t);
    // "Breakdown Chorus" and "Big Chorus" both abbreviate to BC; the later one must not reuse it.
    assert.equal(section(song, "BC").sourceLabel, "Breakdown Chorus");
    assert.equal(song.sections.find((s) => s.sourceLabel === "Big Chorus")!.token, "BIGC");
  });

  it("does not let a custom token shadow a canonical type", () => {
    // Initials of "Tag Along" would be TA, the Turnaround token.
    const song = parseChordPro("{comment: Tag Along}\n[C]words\n");
    assert.equal(song.sections[0].type, "custom");
    assert.notEqual(song.sections[0].token, "TA");
  });

  it("can be used in a song map by token or label", () => {
    const song = parseChordPro(`{comment: Verse 1}\n[C]v\n\n{comment: Spontaneous}\n[F]free\n`);
    const spon = song.sections[1];
    assert.deepEqual(parseSongMap(`V1, ${spon.token}*2, spontaneous`, song).map((i) => i.sectionId), [
      song.sections[0].id,
      spon.id,
      spon.id,
    ]);
    const out = serializeChordPro(song, applyArrangement(song, parseSongMap("V1,SPON", song)));
    assert.match(out, /\{comment: Spontaneous\}\n\[F\]free/);
  });

  it("keeps performance notes as annotations", () => {
    const src = `{comment: Verse 1}\n[C]line\n{comment: Build here}\n[F]more\n\n{comment: Chorus}\n[G]line\n`;
    assert.deepEqual(tokens(parseChordPro(src)), ["V1", "C"]);
    // Directly under a blank line, a sentence-like or long comment is still not a heading.
    const sentence = `{comment: Chorus}\n[G]line\n\n{comment: Everyone sings here, softly}\n[G]line\n`;
    assert.deepEqual(tokens(parseChordPro(sentence)), ["C"]);
  });

  it("can be switched off so unknown comments stay annotations", () => {
    const src = `{comment: Verse 1}\n[C]line\n\n{comment: Spontaneous}\n[F]free\n`;
    assert.deepEqual(tokens(parseChordPro(src)), ["V1", "SPON"]);
    const off = parseChordPro(src, { customSections: false });
    assert.deepEqual(tokens(off), ["V1"]);
    assert.ok(off.sections[0].rawLines.includes("{comment: Spontaneous}"));
  });
});

describe("section normalization in the import workflow", () => {
  const song = parseChordPro(CHART);

  it("produces the expected song map for source order", () => {
    assert.equal(
      formatSongMap(song, sourceOrderArrangement(song)).replaceAll(" → ", " | "),
      "I | V1 | PC | C1A | V2 | C1B | INST | INT | B | RF | E",
    );
  });

  it("retains the original source label alongside the normalized one", () => {
    const pc = section(song, "PC");
    assert.equal(pc.sourceLabel, "Pre Chorus");
    assert.equal(pc.displayLabel, "Pre-Chorus");
    assert.equal(pc.type, "prechorus");
    assert.equal(section(song, "C1A").sourceLabel, "Chorus 1a");
  });

  it("keeps sections of the same canonical type separate", () => {
    const choruses = song.sections.filter((s) => s.type === "chorus");
    assert.deepEqual(choruses.map((s) => s.token), ["C1A", "C1B"]);
    assert.notEqual(choruses[0].id, choruses[1].id);
    assert.notEqual(choruses[0].rawLines.join("\n"), choruses[1].rawLines.join("\n"));
  });

  it("keeps duplicate labels as separate sections with distinct tokens", () => {
    const dup = parseChordPro(`{comment: Chorus}\n[C]first\n\n{comment: Chorus}\n[F]second\n`);
    assert.deepEqual(tokens(dup), ["C", "C#2"]);
    assert.notEqual(dup.sections[0].id, dup.sections[1].id);
    assert.deepEqual(dup.sections.map((s) => s.rawLines[0]), ["[C]first", "[F]second"]);
  });

  it("keeps identity independent of the token", () => {
    assert.ok(song.sections.every((s) => s.id !== s.token));
    assert.equal(new Set(song.sections.map((s) => s.id)).size, song.sections.length);
    // Reading the same chart again yields the same ids; renaming a label does not shift them.
    const renamed = parseChordPro(CHART.replace("{comment: Pre Chorus}", "{comment: Prechorus}"));
    assert.deepEqual(renamed.sections.map((s) => s.id), song.sections.map((s) => s.id));
    assert.equal(renamed.sections[2].sourceLabel, "Prechorus");
    assert.equal(renamed.sections[2].token, "PC");
  });

  it("does not alter chord or lyric content", () => {
    const lines = CHART.split("\n");
    const byLabel = (label: string) => {
      const i = lines.indexOf(`{comment: ${label}}`);
      const rest = lines.slice(i + 1);
      const end = rest.findIndex((l) => l.trim() === "");
      return end < 0 ? rest.filter((l) => l !== "") : rest.slice(0, end);
    };
    for (const s of song.sections) assert.deepEqual(s.rawLines, byLabel(s.sourceLabel), s.sourceLabel);
    assert.equal(
      serializeChordPro(song, applyArrangement(song, sourceOrderArrangement(song))),
      CHART,
    );
  });
});

describe("arranged output with normalized sections", () => {
  const song = parseChordPro(CHART);
  const arrange = (map: string) => serializeChordPro(song, applyArrangement(song, parseSongMap(map, song)));
  const count = (text: string, needle: string) => text.split(needle).length - 1;

  it("duplicates and reorders section contents chronologically", () => {
    const out = arrange("V1 → C1A → V2 → C1A → B×3 → C1B×2 → E");
    const reparsed = parseChordPro(out);
    assert.deepEqual(
      reparsed.sections.map((s) => s.sourceLabel),
      [
        "Verse 1",
        "Chorus 1a",
        "Verse 2",
        "Chorus 1a",
        "Bridge 1/3",
        "Bridge 2/3",
        "Bridge 3/3",
        "Chorus 1b 1/2",
        "Chorus 1b 2/2",
        "Ending",
      ],
    );
    assert.equal(count(out, "Sing it [G]out, sing it [D]loud"), 2);
    assert.equal(count(out, "Bridge [Em]words [C]here"), 3);
    assert.equal(count(out, "Sing it [G]out, sing it [Am]louder"), 2);
    assert.equal(count(out, "Rising"), 0);
    assert.ok(out.startsWith("{title: Lantern Hymn (Example)}\n{key: G}\n"));
  });

  it("round-trips: the arranged chart reparses to the same tokens and content", () => {
    const out = arrange("V1,PC,C1A,C1A,E");
    const reparsed = parseChordPro(out);
    assert.deepEqual(tokens(reparsed), ["V1", "PC", "C1A", "C1A#2", "E"]);
    assert.deepEqual(reparsed.sections[2].rawLines, section(song, "C1A").rawLines);
    assert.deepEqual(reparsed.sections[3].rawLines, section(song, "C1A").rawLines);
  });

  it("refuses to guess between chorus variants for a bare C", () => {
    assert.throws(() => parseSongMap("V1,C", song), /Did you mean: C1A, C1B\?/);
  });
});
