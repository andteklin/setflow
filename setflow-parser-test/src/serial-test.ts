import fs from "node:fs";
import ChordSheetJS from "chordsheetjs";

const source = fs.readFileSync(
  "src/sample-variants.cho",
  "utf8"
);

const parser = new ChordSheetJS.ChordProParser();
const song = parser.parse(source);

const serializer = new ChordSheetJS.ChordSheetSerializer();
const serialized = serializer.serialize(song);

console.dir(serialized, {
  depth: null,
  colors: true,
});