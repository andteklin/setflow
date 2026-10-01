import fs from "node:fs";
import path from "node:path";
import {
  applyArrangement,
  formatSongMap,
  parseChordPro,
  parseSongMap,
  serializeChordPro,
  sourceOrderArrangement,
} from "./arranger";

const USAGE = `Usage: tsx src/arrange.ts <song.cho> [song-map] [-o out.cho] [--list]

  song-map      e.g. "V1,C1A,V2,C1B,B*2,C1C*2,E" (omit for source order)
  --list        show detected sections and exit
  -o, --output  output path (default: <song>.arranged.cho)`;

function main(argv: string[]): void {
  const positional: string[] = [];
  let output: string | undefined;
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return console.log(USAGE);
    if (arg === "--list") list = true;
    else if (arg === "-o" || arg === "--output") {
      output = argv[++i];
      if (!output) throw new Error(`${arg} needs a path`);
    } else positional.push(arg);
  }
  const [file, mapSpec] = positional;
  if (!file || positional.length > 2) {
    console.error(USAGE);
    process.exit(2);
  }

  const song = parseChordPro(fs.readFileSync(file, "utf8"));

  if (song.songMap !== undefined && !list) {
    throw new Error(
      `This chart was already arranged by SetFlow (${song.songMap}). ` +
        "Press Reset in WorshipTools to restore the original chart, then copy it again.",
    );
  }

  if (list) {
    for (const s of song.sections) {
      console.log(`${s.id.padEnd(6)} ${s.type.padEnd(13)} ${s.sourceLabel}`);
    }
    return;
  }

  const arrangement = mapSpec ? parseSongMap(mapSpec, song) : sourceOrderArrangement(song);
  const occurrences = applyArrangement(song, arrangement);
  const outPath =
    output ?? path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.arranged.cho`);
  const songMap = formatSongMap(arrangement);
  fs.writeFileSync(outPath, serializeChordPro(song, occurrences, { songMap }));

  console.log(songMap);
  console.log(`Wrote ${occurrences.length} sections to ${outPath}`);
}

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
}
