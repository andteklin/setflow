# SetFlow

Local-first live worship arrangement system. One planned arrangement generates
musician charts, and the music director (MD) conducts the band live — repeat,
jump, vamp, end — with every display following over the local network. No
Internet, click, or track is needed. See [PROJECT_SPEC.md](PROJECT_SPEC.md).

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
Shortcuts are ignored while typing in a field.

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
- `setflow.local` / QR join.
