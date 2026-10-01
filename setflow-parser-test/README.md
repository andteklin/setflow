# SetFlow Arranger (prototype)

Turns a ChordPro chart plus a song map such as `V1, C, V2, C, B*2, C*2, E`
into a new chart with the sections in performance order, ready to paste
back into WorshipTools.

## Setup (once)

1. Install [Node.js](https://nodejs.org) 20.19 or newer (the LTS download).
2. In a terminal, from this folder:

   ```bash
   npm install
   ```

## Arrange a chart

```bash
npm run ui
```

This opens the arranger in your browser at <http://localhost:5173>. It runs
only on your machine; nothing is uploaded. Leave the terminal open while you
use it and press `Ctrl+C` there when you are done.

1. In WorshipTools, open the song, press **Reset** so the chart is the
   original, then open the ChordPro editor and copy all of it.
2. In the arranger, click **Paste** (or click in the left box and press Ctrl+V).
3. Click the section buttons in the order the band will play them. Clicking a
   section twice in a row, or typing `B*2`, plays it twice and labels it
   "Bridge 1/2", "Bridge 2/2".
4. Click **Copy**, then paste over the chart in the WorshipTools ChordPro editor.

The map you used is remembered for that song title on this browser. The
arranged chart also records it as `{x_setflow_map: ...}`, so the arranger
refuses to re-arrange a chart that was already arranged: press Reset in
WorshipTools first.

### Song map syntax

- Separate sections with `,`, `->` or `→`.
- Repeat with `*N` or `×N`, e.g. `B*3`.
- Use the short names shown on the section buttons (`V1`, `C1A`, `INST`) or
  the full labels (`Verse 1`). Variants such as `C1A` and `C1B` are never
  merged; a bare `C` is rejected when only variants exist.

## Command line

```bash
npm run arrange -- song.cho "V1, C, V2, C, B*2, C*2, E"   # writes song.arranged.cho
npm run arrange -- song.cho --list                        # show detected sections
```

## Development

```bash
npm test
npm run typecheck
```
