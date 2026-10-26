# SetFlow Arranger (prototype)

Turns a ChordPro chart plus a song map such as `V1, C, V2, C, B*2, C*2, E`
into a new chart with the sections in performance order, ready to paste
back into WorshipTools.

## Setup (once)

1. Install [Node.js](https://nodejs.org) 20.19 or newer (the LTS download).
2. In a terminal, from the repository root (the folder above this one):

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

### Section names

Section names are normalized by the vocabulary in
`packages/core/src/sectionTypes.ts` (Intro, Verse, Pre-Chorus, Chorus, Refrain,
Bridge, Instrumental, Interlude, Solo, Tag, Vamp, Turnaround, Breakdown,
Outro, Ending, Count-In, Click, ...). Case, spaces and hyphens don't matter,
and numbers/letters are kept (`Chorus 1a` → `C1A`). The original label is
always preserved in the output chart.

A name outside the vocabulary (`Spontaneous`, `Big Chorus`) is a custom
section with its own generated short name (`SPON`, `BIGC`) when it stands
alone after a blank line, is short, and is followed directly by chart lines.
Comments inside a section such as `{comment: Build here}` stay annotations.

## Command line

```bash
npm run arrange -- song.cho "V1, C, V2, C, B*2, C*2, E"   # writes song.arranged.cho
npm run arrange -- song.cho --list                        # show detected sections
```

## Development

The parser, song maps and arrangement logic live in `packages/core`
(`@setflow/core`); this folder is only the UI and command line on top of it.
From the repository root:

```bash
npm test
npm run typecheck
```
