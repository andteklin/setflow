# SetFlow

Local-first live worship arrangement system. One planned arrangement generates
musician charts, and the music director (MD) conducts the band live — repeat,
jump, vamp, end — with every display following over the local network. No
Internet, click, or track is needed. See [PROJECT_SPEC.md](PROJECT_SPEC.md), and
[docs/cloud-local-architecture.md](docs/cloud-local-architecture.md) for the
proposed cloud + local architecture and migration plan.

## Run it

Requires [Node.js](https://nodejs.org) 22.13 or newer.

```bash
npm install
npm start
```

The host prints its addresses, for example:

```text
Control:  http://localhost:5280/#/control
On the LAN: http://192.168.0.126:5280  (Stage: /#/stage, Musician: /#/musician)
```

- **Control** — open on the MD's computer. Import a ChordPro chart, build a
  Song Map, then start the song and conduct.
- **Stage** — open full-screen on the portrait band display.
- **Musician** — open on each musician's phone or tablet using the LAN address.

The library is stored in `~/.setflow/setflow.db` (SQLite). Set `SETFLOW_DATA`
to use another folder and `SETFLOW_PORT` for another port. If the host
restarts mid-song, Control View offers to resume where the band was.

### Conducting keys (Control View)

| Key | Action |
| --- | --- |
| → , Space, Page Down | NEXT (starts the song from Ready) |
| ← , Page Up | PREVIOUS |
| R | REPEAT the current section |
| V | VAMP — hold until cue |
| 1 … 0 | JUMP to that section (numbers shown on the jump buttons) |
| End | END the performance |

Most USB page-turner foot pedals send arrow or Page keys and work as-is.
Fast presses are applied in order; holding a key down does not repeat it.
Shortcuts are ignored while typing in a field.

### Running a setlist

Choose a setlist in Control View and press **Start setlist**. Every song is
checked and frozen at that moment, so a broken map is reported before the
service, and library edits made during it wait for the next one. NEXT on the
last section ends the song as usual; **one more NEXT loads the next song** at
Ready (Stage shows "NEXT SONG: …"). PREVIOUS before a song starts goes back
one. The live panel lists every song for jumping directly. Clicking a setlist
entry in the sidebar lets you change its arrangement or key in place.

### Presentation clicker on the Stage computer

A clicker plugged into the MD's computer already works (it sends arrow or
Page keys), including into a Stage window on a second monitor. For a clicker
on a separate Stage computer: open Stage there, move the mouse, choose **Use
a clicker here**, then press **Allow** under *Clicker devices* in Control
View. That device can then send NEXT and PREVIOUS only; the MD stays the one
conductor and can remove it at any time.

### Comments in charts

- `{comment: Build here}` or `{ci: …}` inside a section is shown to the band.
- A line starting with `#` is hidden from Stage and Musician views; Control
  View shows it dimmed. Remove the `#` to show it again.
- The **Arranged ChordPro** tab shows the arrangement as one chart in
  performance order, ready to copy or download. Comments added there belong to
  that arrangement only (the song and its other arrangements are unchanged)
  and move with their section when the Song Map is reordered.

### MIDI controller

Plug the controller into the host computer (musician devices need no MIDI
access). In Control View, open **MIDI controller**, choose the device and
channel, tick **Use for conducting**, then press **Learn** next to an action
and press the button you want for it. Jump buttons name an exact section
(`C1A`, `C1C`, …). The **Test** line shows each press and what it did.
Note-off and release messages never trigger; unplugging the controller leaves
web and keyboard control working, and it reconnects when plugged back in.

## Packages

| Package | What it is |
| --- | --- |
| [`packages/core`](packages/core) | ChordPro parsing, section vocabulary, song maps, arrangement, transposition, and the performance engine and command gateway. No I/O. |
| [`packages/server`](packages/server) | The host: JSON API, LAN WebSocket sync, SQLite library, recovery. Plain Node + `ws`. |
| [`packages/web`](packages/web) | Control, Stage and Musician views (Vite, no framework). Built into `packages/web/dist` and served by the host. |
| [`setflow-parser-test`](setflow-parser-test) | The earlier arranger prototype that writes rearranged ChordPro for WorshipTools. |

## Development

```bash
npm test            # all package tests
npm run typecheck
npm run dev:server  # host on :5280, restarts on change
npm run dev:web     # Vite on :5173, proxying /api and /ws to the host
```

## Not in this prototype yet

- MIDI input is tested with a simulated device only; a real controller/host
  combination still needs validating (spec §19.3, §30.5).
- Per-song custom jump keys; number keys follow the song's source order
  (MIDI jump buttons already map to exact section tokens).
- Manual section-type correction other than by renaming the comment in the
  ChordPro source; converting an annotation into a section the same way.
- Explicit "apply edits to the running song" — edits apply when the song is next started.
- A separate "Prepare for service" step with a stored service package for
  cloud sync (docs M1/M6); a setlist is frozen when it starts instead.
- `setflow.local` / QR join.
