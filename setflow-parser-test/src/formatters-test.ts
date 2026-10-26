import fs from "node:fs";
import ChordSheetJS from "chordsheetjs";

const source = fs.readFileSync("src/sample-variants.cho", "utf8");
const parser = new ChordSheetJS.ChordProParser();
const song = parser.parse(source);

const textFormatter = new ChordSheetJS.TextFormatter();
console.log("===== TEXT =====");
console.log(textFormatter.format(song));

const chordProFormatter = new ChordSheetJS.ChordProFormatter();
console.log("===== CHORDPRO ROUND TRIP =====");
console.log(chordProFormatter.format(song));

console.log("===== CHORD.PARSE (G/B) =====");
console.dir(ChordSheetJS.Chord.parse("G/B"), { depth: null });

console.log("===== CHORD.PARSE (C/E) =====");
console.dir(ChordSheetJS.Chord.parse("C/E"), { depth: null });
