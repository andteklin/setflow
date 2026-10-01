import fs from "node:fs";
import ChordSheetJS from "chordsheetjs";

const source = fs.readFileSync(
  "src/sample-variants.cho",
  "utf8"
);

const parser = new ChordSheetJS.ChordProParser();

const song = parser.parse(source);

console.dir(song, {
  depth: null,
  colors: true,
});