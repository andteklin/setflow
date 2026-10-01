# SetFlow — Project Specification

## 1. Project Overview

**SetFlow** is a local-first live worship arrangement system where the band’s arrangement and live Performance State are the source of truth. It converts reusable song sections and Song Maps into chronological charts, then follows the music director (MD) as the band changes course during performance.

The product promise is an **MD-controlled, track-independent, local-first arrangement engine**: one planned arrangement generates musician charts, while live band decisions update those charts and band-facing displays. The initial audience is a worship team that needs spontaneous arrangement changes without operating a playback system.

Shared song maps, arrangement-aware charts, and synchronized displays are not assumed to be unique features. SetFlow must earn its usefulness through their combination with direct MD control, offline LAN operation, and provider-independent local imports. Competitive differentiation is a hypothesis to validate in rehearsal, not a claim that no comparable product exists.

SetFlow separates three concepts that are commonly combined in static worship charts:

1. **Song content** — the reusable musical sections of a song.
2. **Song arrangement** — the planned order in which those sections are performed.
3. **Performance State** — what the band is performing now, what comes next, and any live deviations from the plan.

A source chart may contain:

```text
Intro
Verse 1
Chorus 1a
Instrumental
Verse 2
Chorus 1b
Bridge
Chorus 1c
Chorus 1d
Ending
```

SetFlow imports and identifies these sections, after which the user can construct an arrangement such as:

```text
Intro → Verse 1 → Chorus 1a → Instrumental →
Verse 2 → Chorus 1b → Bridge → Chorus 1c →
Chorus 1d → Ending
```

For songs whose repeated sections are identical, SetFlow should also support reuse:

```text
V1 → C → V2 → C → B → C×2 → Ending
```

SetFlow then renders the resulting arrangement for stage displays and individual musician devices.

All live-performance functionality must operate over a local network without Internet access.

---

## 2. Core Design Principles

### 2.1 Local First

Local-first/offline operation is a product requirement. Internet connectivity, cloud login, provider authentication, remote assets, and external APIs must never be required to start or run a performance using locally stored content. The host serves the application and charts entirely over LAN; a fresh client can join and a host can restart with WAN disconnected.

```text
                     LOCAL ROUTER
                     WAN OPTIONAL
                          |
             +------------+------------+
             |            |            |
          Host PC      Musician      Musician
                       Device        Device
             |
        Stage Output
             |
       HDMI Splitter
        /    |    \\
      TV 1  TV 2  TV 3
```

Optional cloud integrations may exist in the future, but loss of Internet connectivity must not interrupt an active SetFlow session.

### 2.2 Preserve the Original ChordPro

Imported ChordPro must be retained in its original form whenever practical.

SetFlow should not destructively rewrite a SongSelect chart simply because it creates an internal structured representation.

The application therefore maintains:

```text
Original ChordPro
       ↓
     Parser
       ↓
Normalized SetFlow Song Model
       ↓
Arrangement Engine → Planned Sequence
       ↓
Performance Engine + MD Commands
       ↓
Performance State → Renderers
```

The original source remains available for editing, export, debugging, and reparsing.

### 2.3 Separate Content from Arrangement

The source chart defines musical content.

A SetFlow Arrangement defines performance order.

Multiple arrangements may reference the same song.

### 2.4 One Application, Multiple Views

SetFlow is one application with a shared data model and at least three interfaces:

- **Control View**
- **Stage View**
- **Musician View**

---

### 2.5 Track Independence

The MD/band controls musical time. SetFlow follows explicit human commands; no click, backing track, audio timeline, tempo clock, or automatic bar detection is required. Tempo and time signature are descriptive metadata. Holding a section does not trigger audio playback or advance on a timer.

Users must be able to create and conduct a performance without creating, loading, or running any playback timeline, including a silent one. Section occurrences express musical order, not timestamps or required durations. Optional future playback integrations must preserve this operating mode.

### 2.6 Planned Arrangement and Live Authority

The Arrangement Engine expands a saved Song Map into a planned sequence. The Performance Engine owns a session copy and applies live commands to it. Live deviations never silently rewrite the saved arrangement or original song. Stage, Musician, and Control Views consume the same authoritative Performance State.

Three authorities must remain explicit:

| Concern | Authority | Meaning |
|---|---|---|
| Planned arrangement | Saved Song Map | The intended order and repetitions before performance. |
| Live band state | Local Performance Engine | The current occurrence, effective next occurrence, deviations, performance key, and cues. |
| Congregation presentation | Presentation application and its operator | The actual slide currently displayed, including progression within a musical section. |

SetFlow Stage View always represents live band state. A future presentation adapter may request a slide cue from an accepted band-state transition; it must not assume that the requested slide is actually displayed or feed slide navigation back into band state.

```text
Saved Song Map → Planned Sequence
                         ↓
MD commands → Local Performance Engine → Band State → Charts / Stage
                                             │
                                   optional future cue request
                                             ↓
                                Presentation app / slides operator
                                             ↓
                                  Actual congregation slide
```

### 2.7 Performance Interaction Priority

The MD must be able to issue common live actions with one deliberate press after setup. Keep Repeat, Next, and configured section jumps immediately available, with exact section variants visible. Do not require opening the Song Map editor or navigating a modal dialog for routine live deviations. Setup may configure song-specific jump mappings; unresolved mappings must be clearly marked before performance.

Current section, repetition or vamp status, and the next section must remain legible on band displays. The rehearsal test in §30.4 determines whether these controls and displays support real musical use.

## 3. Real-World ChordPro Compatibility

SetFlow must prioritize compatibility with ChordPro files produced by common worship-music sources rather than requiring perfectly semantic ChordPro.

A typical SongSelect import may resemble:

```chordpro
{title: Because He Lives (Amen)}
{artist: Chris Tomlin, Daniel Carson, Ed Cash, ...}
{key: C}
{time: 4/4}
{tempo: 84}
{ccli_license: 11488782}
{ccli: 7027887}
{copyright: ...}
{footer: ...}

{comment: Intro}
[|] [Am]    [F]    [|] [C]    [|]

{comment: Verse 1}
I be - [Am]lieve in the [F]Son, [C] ...

{comment: Chorus 1a}
A - [F]men, [G]a [Am]- men
...

{comment: Instrumental}
[|] [Am]    [F]    [|] [C]    [|]

{comment: Verse 2}
...

{comment: Bridge}
...

{comment: Ending}
Because He [Am]lives [F] [C]
```

SetFlow must correctly interpret this style of file.

---

## 4. Metadata Parsing

SetFlow should recognize common metadata directives including:

```text
{title: ...}
{artist: ...}
{key: ...}
{time: ...}
{tempo: ...}
{ccli: ...}
{ccli_license: ...}
{copyright: ...}
{footer: ...}
```

Unknown metadata directives must not cause import failure.

Unknown directives should preferably be preserved so that importing and subsequently exporting a chart does not unnecessarily destroy information.

Internally, common metadata should map to structured fields:

```typescript
interface SongMetadata {
  title: string;
  artist?: string;
  originalKey?: string;
  timeSignature?: string;
  tempo?: number;
  ccliNumber?: string;
  ccliLicense?: string;
  copyright?: string;
  footer?: string;
}
```

---

## 5. Section Detection

### 5.1 Comment-Based Sections

SetFlow must support section boundaries expressed using `{comment: ...}`.

For SongSelect-style charts:

```chordpro
{comment: Verse 1}
...

{comment: Chorus 1a}
...

{comment: Bridge}
...
```

each recognized structural comment begins a new musical section.

The section continues until:

- another structural section marker occurs, or
- the song ends.

### 5.2 Semantic Section Directives

SetFlow should additionally support standard semantic ChordPro structures where available, such as verse, chorus, bridge, or custom environment directives.

Semantic directives should take precedence over heuristic comment detection where the source explicitly supplies them.

### 5.3 Section Recognition

Section names should be normalized when possible.

Examples:

| Source Label | Type | Normalized Label |
|---|---|---|
| `Intro` | intro | `I` |
| `Verse 1` | verse | `V1` |
| `Verse 2` | verse | `V2` |
| `Pre-Chorus` | prechorus | `PC` |
| `Chorus` | chorus | `C` |
| `Chorus 1a` | chorus | `C1A` |
| `Chorus 1b` | chorus | `C1B` |
| `Bridge` | bridge | `B` |
| `Bridge 2` | bridge | `B2` |
| `Instrumental` | instrumental | `INST` |
| `Interlude` | interlude | `INT` |
| `Tag` | tag | `T` |
| `Ending` | ending | `E` |
| `Outro` | outro | `O` |

The **original label must always be preserved**.

Normalization exists for SetFlow logic and compact UI presentation; it must not destroy the source label.

### 5.4 Unknown Section Names

SetFlow must not require sections to use a predefined vocabulary.

For example:

```chordpro
{comment: Breakdown}
```

or:

```chordpro
{comment: Big Chorus}
```

must remain valid.

SetFlow should classify these as `custom` if it cannot confidently infer another type.

The user should be able to correct the classification manually.

---

## 6. Comments vs. Section Markers

Not every `{comment: ...}` directive necessarily represents a musical section.

For example:

```chordpro
{comment: Verse 1}
```

clearly indicates structure.

But a chart could also contain:

```chordpro
{comment: Build here}
```

or:

```chordpro
{comment: Acoustic guitar only}
```

which may be performance notes rather than sections.

SetFlow should therefore classify comments rather than blindly treating every comment as a section.

Suggested detection strategy:

1. Match common section names.
2. Recognize numbered/lettered variants.
3. Use surrounding position/content as secondary context.
4. If uncertain, preserve the comment as an annotation.
5. Allow the user to manually convert an annotation into a section.

The importer should prioritize **not losing information** over aggressive normalization.

---

## 7. Section Model

A SetFlow section should contain:

```typescript
interface SongSection {
  id: string;

  // Source identity
  sourceLabel: string;

  // Normalized SetFlow representation
  label: string;
  type:
    | "intro"
    | "verse"
    | "prechorus"
    | "chorus"
    | "bridge"
    | "instrumental"
    | "interlude"
    | "tag"
    | "ending"
    | "outro"
    | "custom";

  lines: ChartLine[];

  sourceOrder: number;
}
```

For the supplied SongSelect example, parsing should produce approximately:

```text
Song: Because He Lives (Amen)

Sections
──────────────────────
I       Intro
V1      Verse 1
C1A     Chorus 1a
INST    Instrumental
V2      Verse 2
C1B     Chorus 1b
B       Bridge
C1C     Chorus 1c
C1D     Chorus 1d
E       Ending
```

---

## 8. Important: Similar Sections Are Not Necessarily Identical

SetFlow must **not automatically merge sections simply because their names are similar**.

For example, the supplied chart contains:

```text
Chorus 1a
Chorus 1b
Chorus 1c
Chorus 1d
```

These sections contain subtle differences in chords and lyrics.

Therefore:

```text
C1A ≠ C1B ≠ C1C ≠ C1D
```

unless the user explicitly chooses to link or consolidate them.

This is critical.

SetFlow must never assume:

```text
"Chorus 1a"
"Chorus 1b"
"Chorus 1c"
```

are merely repeated instances of one Chorus.

---

## 9. Optional Section Linking

SetFlow may allow the user to identify sections that should share content.

For example:

```text
Chorus A
Chorus B
```

could optionally be consolidated if the user determines they are musically identical.

This should be an explicit operation such as:

**Link Sections**

or:

**Use Same Content As...**

SetFlow should show differences before allowing consolidation.

This feature is not required for the initial MVP.

---

## 10. Default Imported Arrangement

Upon importing a ChordPro file, SetFlow should automatically create an arrangement corresponding to **source order**.

For the supplied example:

```text
Intro
→ Verse 1
→ Chorus 1a
→ Instrumental
→ Verse 2
→ Chorus 1b
→ Bridge
→ Chorus 1c
→ Chorus 1d
→ Ending
```

This means a newly imported SongSelect chart is immediately usable even before the user creates a custom SetFlow arrangement.

Suggested default arrangement name:

```text
Imported Arrangement
```

or:

```text
Source Order
```

---

## 11. Song Maps

A Song Map defines performance order independently from source order.

For example:

```text
V1 → C1A → V2 → C1B → B → C1C → C1D → E
```

or for another song:

```text
V1 → C → V2 → C → B×4 → C×2 → T
```

The arrangement model should reference section IDs rather than duplicate their content.

```typescript
interface ArrangementItem {
  sectionId: string;
  repetitions: number;
}
```

Therefore:

```text
B × 4
```

means:

```text
Reference Bridge
Repeat 4 times
```

rather than storing four independent copies of the Bridge.

---

## 12. Song Map Editor

The operator must be able to:

- add sections
- remove sections
- reorder sections
- duplicate references
- specify repetitions
- save arrangements
- duplicate arrangements
- rename arrangements
- restore source order

Preferred interface:

```text
AVAILABLE SECTIONS

[I] [V1] [V2] [C1A] [C1B] [B] [INST] [E]


ARRANGEMENT

┌──────────────┐
│ Intro        │
├──────────────┤
│ Verse 1      │
├──────────────┤
│ Chorus 1a    │
├──────────────┤
│ Instrumental │
├──────────────┤
│ Verse 2      │
├──────────────┤
│ Chorus 1b    │
├──────────────┤
│ Bridge       │ × 1
├──────────────┤
│ Chorus 1c    │
├──────────────┤
│ Chorus 1d    │
├──────────────┤
│ Ending       │
└──────────────┘
```

Drag-and-drop is preferred.

---

## 13. Chord Parsing

Inline ChordPro chords must be represented independently from lyrics.

For example:

```chordpro
Because He [C]lives, [F]I can face to - [G]morrow
```

should conceptually become:

```text
Because He lives, I can face tomorrow
           C      F             G
```

while preserving exact chord positions.

SetFlow must support at minimum:

- major chords
- minor chords
- sharps/flats
- slash chords
- common extensions
- chord-only lines

Examples from real imported charts include:

```text
Am
F
C
G
G/B
C/E
```

---

## 14. Bar / Chord-Only Lines

SetFlow must correctly render instrumental notation such as:

```chordpro
[|] [Am]    [F]    [|] [C]         [|] [Am]    [F]    [|] [C]         [|]
```

The renderer must not assume every line contains lyrics.

Chord-only sections such as Intro and Instrumental are first-class chart content.

Stage View should preserve enough spacing and bar information for these sections to remain musically useful.

---

## 15. Transposition

SetFlow must transpose parsed chords without modifying lyrics or structural markers.

Example:

```text
C    → D
Am   → Bm
F    → G
G    → A
G/B  → A/C#
C/E  → D/F#
```

The original key and original ChordPro should remain preserved.

The performance key belongs to the arrangement/setlist context where possible.

This allows the same song to be performed in different keys without creating duplicate song records.

---

## 16. Import Workflow

The primary MVP acquisition workflow should assume that direct SongSelect API integration is unavailable.

Supported workflows:

### File Import

```text
SongSelect
    ↓
Download ChordPro
    ↓
Drag file into SetFlow
```

### Paste Import

```text
SongSelect / other source
    ↓
Copy ChordPro
    ↓
Paste into SetFlow
```

### Manual Creation

The user may create a song directly in SetFlow.

---

### 16.1 SongProvider Boundary

File import, paste import, and manual creation are the MVP providers. A provider acquires content and provenance; the shared importer performs parsing, normalization, preview, and local persistence. Providers do not own arrangement or performance behavior.

```typescript
interface SongProvider {
  id: string;
  capabilities: { search: boolean; requiresAccount: boolean };
  acquire(input: ProviderInput): Promise<ImportedSong>;
  search?(query: string): Promise<SongSearchResult[]>;
}

type ProviderInput =
  | { kind: "file"; name: string; text: string }
  | { kind: "paste"; text: string }
  | { kind: "manual"; song: SetFlowSong }
  | { kind: "remote"; providerSongId: string }; // future only

interface ImportedSong {
  source: { format: "chordpro"; originalText: string }
        | { format: "manual"; song: SetFlowSong };
  provenance: {
    providerId: string;
    providerSongId?: string;
    importedAt: string;
    storagePolicy: "organization-local" | "cloud-permitted";
    permissionReference?: string;
  };
}
```

These are conceptual interfaces; `SetFlowSong` is the normalized song model and `SongSearchResult` is a future provider search result. Unsupported acquisition kinds return a clear error. Local providers require no account or API. Official PraiseCharts, SongSelect, or other adapters may be added later only when access and provider terms permit; no provider API is an MVP dependency.

### 16.2 Content Storage Policy

Licensed chart content, original source, and derived charts remain organization-local unless applicable provider terms explicitly permit cloud storage. Preserve provenance, copyright, footer, CCLI identifiers, and any supplied usage restrictions. Importing a file does not grant redistribution rights. Future cloud features must honor this policy for backups, synchronization, and derived content; do not upload chart content by default or pool organizations’ libraries into a shared catalog. This is a product storage constraint, not a claim that any particular provider grants permission.

## 17. Import Preview

Before committing an imported chart, SetFlow should display what it detected.

Example:

```text
┌────────────────────────────────────────────┐
│ IMPORT SONG                               │
│                                            │
│ Because He Lives (Amen)                   │
│ Chris Tomlin, Daniel Carson, ...          │
│                                            │
│ Key: C        Tempo: 84        Time: 4/4  │
│ CCLI: 7027887                              │
│                                            │
│ DETECTED SECTIONS                          │
│                                            │
│ ✓ Intro                                   │
│ ✓ Verse 1                                 │
│ ✓ Chorus 1a                               │
│ ✓ Instrumental                            │
│ ✓ Verse 2                                 │
│ ✓ Chorus 1b                               │
│ ✓ Bridge                                  │
│ ✓ Chorus 1c                               │
│ ✓ Chorus 1d                               │
│ ✓ Ending                                  │
│                                            │
│        [Edit Source]   [Import Song]       │
└────────────────────────────────────────────┘
```

This preview is important because section detection may occasionally require human correction.

---

## 18. Rendering and Performance Architecture

SetFlow should not rely on an external library's final HTML output as its primary renderer. An external library may handle tokenization, ChordPro parsing, chord recognition, transposition, and metadata parsing. A SetFlow adapter converts its output into the internal model, preventing coupling to one parser.

```text
File / Paste / Manual       Official providers (future)
          └──────────────────────┘
                    SongProvider
                         ↓
          Preserved Source + Provenance
                         ↓
          Parser → SetFlow Adapter → SetFlowSong
                         ↓
                 Section Definitions
                         ↓
                      Song Map
                         ↓
         Arrangement Engine → Planned Sequence
                                      ↓
Web UI ──┐                      Performance Engine
Keyboard ├→ Input adapters → Commands →│
MIDI ────┘                            ↓
GPIO (future) ─→ same path      Performance State
                                      ↓
                    ┌─────────────────┼────────────────┐
                 Control            Stage           Musician
                                      ↓
                       Optional integrations (future)
```

Rendering uses song content plus the effective session sequence, performance key, and current state. No renderer independently advances musical time. Optional future outputs subscribe to accepted state changes; they cannot become a dependency of local performance.

---

## 19. Generated Performance Sequence

The Arrangement Engine converts an arrangement into an ordered sequence of section occurrences.

Example:

```text
Arrangement:

V1 → C → V2 → C → B×3 → C
```

becomes:

```text
1   Verse 1
2   Chorus
3   Verse 2
4   Chorus
5   Bridge 1/3
6   Bridge 2/3
7   Bridge 3/3
8   Chorus
```

A **section definition** and a **section occurrence** are different objects.

Conceptually:

```typescript
interface SectionOccurrence {
  id: string; // stable occurrence identity within the session
  origin: "planned" | "live";
  sectionId: string;
  occurrenceIndex: number;
  repetitionIndex: number;
  repetitionCount: number;
}
```

This distinction is essential for displaying:

```text
BRIDGE 2/4
```

without creating four copies of the Bridge content.

---

### 19.1 Performance Engine and Performance State

The host runs one authoritative Performance Engine per active session. It validates commands, applies deterministic transitions, assigns revisions, and broadcasts complete state snapshots. It is separate from the Arrangement Engine: expanding a plan and conducting a live performance are different responsibilities.

```typescript
type PerformanceCommand =
  | { type: "NEXT" }
  | { type: "PREVIOUS" }
  | { type: "REPEAT" }
  | { type: "JUMP"; sectionId: string; targetOccurrenceId?: string }
  | { type: "VAMP" }
  | { type: "END" };

interface CommandEnvelope {
  commandId: string;
  sessionId: string;
  expectedRevision: number;
  source: "web" | "keyboard" | "midi" | "gpio";
  controllerId: string;
  command: PerformanceCommand;
}

interface PerformanceState {
  sessionId: string;
  revision: number;
  songId: string;
  arrangementId: string;
  arrangementRevision: number;
  status: "ready" | "active" | "ended";
  performanceKey: string;
  sequence: SectionOccurrence[]; // effective session sequence
  currentOccurrenceId: string | null;
  nextOccurrenceId: string | null;
  vamping: boolean;
  repetition: { index: number; total: number | null }; // null total = open vamp
  cues: string[];
  liveDeviations: Array<{
    revision: number;
    commandId: string;
    command: PerformanceCommand;
    fromOccurrenceId: string | null;
    toOccurrenceId: string | null;
  }>;
}
```

IDs distinguish repeated visits to the same section; array positions are never persistent identities. Counters describe the current contiguous repetition group, not all visits to that section throughout the song. Keep the saved plan available alongside the effective live sequence.

### 19.2 MVP Command Semantics

The MD issues transitions at the intended musical boundary. MVP commands act immediately when accepted; there is no beat quantization or scheduled audio transition.

| Command | Accepted behavior |
|---|---|
| `NEXT` | Enter the next effective occurrence. From ready, enter the first occurrence. While vamping, exit the vamp and enter its saved successor. At the final occurrence, end the performance. |
| `PREVIOUS` | Return to the previous occurrence in the effective sequence, clearing vamp mode. At the beginning, do nothing. This is navigation, not an undo of earlier deviations. |
| `REPEAT` | Insert a new occurrence of the current section immediately after it and enter that occurrence now. Preserve the previous successor after the inserted repeat. Update the contiguous repetition count on every view; while vamping, count another iteration and remain in vamp mode. |
| `JUMP` | Immediately select a specific section of the active song, clear vamp mode, and show its chart. If an occurrence ID is supplied, use that matching occurrence and continue from it. Otherwise choose the first matching occurrence after the current position, falling back to the first matching occurrence in the sequence. If absent from the sequence, insert a live occurrence after the current one and resume the prior successor afterward. |
| `VAMP` | Hold the current section indefinitely until `NEXT`, `JUMP`, `PREVIOUS`, or `END`. Repeated `VAMP` is idempotent; `REPEAT` explicitly counts another iteration. Show `VAMP — UNTIL CUE`, with the exit successor separately labeled. |
| `END` | Mark ended, clear current/next and vamp state, and show `ENDED` on all views. It does not jump to a section named Ending; use `JUMP` for that. |

`REPEAT`, `VAMP`, and `PREVIOUS` require an active current occurrence. A valid `JUMP` from ready starts performance at its target. After ending, transport commands do not restart the song; the operator explicitly starts a new session. Invalid targets are rejected without changing state. `NEXT` while vamping always exits, even if prior repeat commands extended the repetition group.

Live commands change only the session sequence and deviation history. Editing a saved song/map during performance stages changes for the next session; explicit application to the active session must validate occurrence references and broadcast one coherent revision. MVP may require ending and restarting before applying structural edits. Performance key and cues are host-controlled state changes and use the same validation/revision authority.

### 19.3 Shared Input Path and MIDI Scope

Web buttons, keyboard shortcuts, and MIDI controller input are MVP input adapters. Future GPIO uses the same abstraction. Every adapter maps an input to a `PerformanceCommand` and sends it through the host's command gateway; none manipulates a view or sequence directly.

The gateway validates the authorized local controller, session, expected revision, and target. It serializes accepted commands, deduplicates retries by `commandId`, and returns an acknowledgement with the authoritative revision. Stale commands are rejected with a fresh snapshot rather than blindly replayed. The active MD controller sends commands in order. View-only musician clients cannot conduct the band.

MVP MIDI is deliberately small: one selected controller connected to the host, configurable note-on or control-change button mappings, channel selection, a mapping test, and saved local mappings. Map named jump buttons to section IDs, including exact chorus variants. Ignore note-off/zero-velocity release events, trigger control-change buttons only on the configured press edge, and suppress duplicate transport retries without suppressing deliberate repeated presses. Keyboard shortcuts are disabled while typing into editors.

Use a host-side MIDI adapter in the supported desktop host environment, so musician browsers do not need MIDI access or browser MIDI permissions. Validate one documented controller/host combination for MVP. Device hot-unplug reports status and leaves Web/keyboard control working. MIDI clock, MIDI output, track control, and external application cue mapping are future features.

## 20. Control View

Control View runs on the host laptop.

It provides:

- song library
- setlist selection
- arrangement selection
- ChordPro editor
- section editor
- Song Map editor
- transposition
- current section
- next section
- NEXT, PREVIOUS, REPEAT, JUMP, VAMP, and END controls with keyboard equivalents
- MIDI device selection, mappings, and connection status
- active repetition, vamp status, live deviations, and MD cues
- direct section navigation
- Stage View status

Example:

```text
+-------------------------------------------------------+
| SETFLOW                    Fall Getaway — Session 2   |
+----------------+--------------------------------------+
| SETLIST        | BECAUSE HE LIVES (AMEN)             |
|                | Key: C      BPM: 84      4/4        |
| Song 1         |                                      |
| Because He...  | ARRANGEMENT                          |
| Song 3         |                                      |
| Song 4         | I → V1 → C1A → INST → V2 → C1B     |
|                | → B → C1C → C1D → E                 |
|                |                                      |
|                | CURRENT: Bridge                      |
|                | NEXT: Chorus 1c                     |
|                |                                      |
|                | [PREV] [NEXT] [REPEAT] [JUMP TO...] [VAMP] [END]          |
+----------------+--------------------------------------+
```

---

## 21. Stage View

SetFlow Stage View displays band state from the Performance Engine: current occurrence, exact section variant, repetition, next section (or vamp exit), performance key, and MD cues. It remains independent from Presenter, congregation slides, and the slides operator; a slide change never changes SetFlow state in MVP.

Stage View should be optimized for portrait displays such as 24", 27", 32", and 43" monitors.

Typical resolution:

```text
1080 × 1920
```

Example:

```text
┌──────────────────────────────┐
│ BECAUSE HE LIVES       C     │
│                              │
│            BRIDGE            │
│                              │
│ C                            │
│ Because He lives,            │
│                              │
│ F                  G         │
│ I can face tomorrow          │
│                              │
│ C                            │
│ Because He lives             │
│                              │
│ F                 G          │
│ Every fear is gone           │
│                              │
│                              │
│ NEXT: CHORUS 1C              │
└──────────────────────────────┘
```

Stage View prioritizes readability rather than reproducing the exact source-file layout.

---

## 22. Musician View

Musician View provides the chronological chart through any modern browser on the local network.

Musicians may independently control:

- scroll position
- zoom/font size
- light/dark mode

Authoritative content and Performance State remain controlled by the host. Synchronize current song, occurrence, next section, repetitions, deviations, key, and cues—not personal scroll position. A persistent live indicator remains visible while browsing, and **Return to Live** restores following the current occurrence. Personal display preferences never issue performance commands.

A musician should be able to view the entire generated arrangement while Stage View may show only the current section.

---

## 23. Real-Time Synchronization

The host is authoritative for Performance State and content revisions. Local WebSockets publish revisioned state snapshots referencing locally available song data. Views render the same session sequence and current/next occurrence IDs; they never infer state by counting button events.

A joining or reconnecting client retrieves the current snapshot and matching content before displaying itself as live. Ignore older revisions. A new session ID invalidates stale commands and snapshots from an earlier performance. Commands have acknowledgements and deduplication as defined in §19.3.

A disconnected client may retain its last chart with a visible **Disconnected / last known state** indicator. It must not claim to be current or queue offline navigation for automatic replay. Reconnection restores current band state while preserving personal zoom and browsing preferences.

---

## 24. Local Networking

SetFlow must work entirely over LAN.

Typical deployment:

```text
Router
   |
   +-- Host Laptop
   |
   +-- Drummer iPad
   |
   +-- Bassist Phone
   |
   +-- Keyboard Tablet
```

Internet connectivity is optional.

A future convenience feature may expose the application at:

```text
http://setflow.local
```

and display a QR code for musicians to join.

---

## 25. Local Persistence

SetFlow must locally store:

- original ChordPro
- parsed song data
- section definitions
- arrangements
- setlists
- performance keys
- settings
- revision information
- provider provenance and content storage policy
- MIDI/keyboard mappings
- last committed performance snapshot and live deviations for explicit recovery

Restarting SetFlow must not require Internet connectivity. Recovery presents the last committed snapshot for operator confirmation before resuming; it does not automatically advance the band. A recovered session receives a new session ID so old queued commands cannot apply.

---

## 26. Reliability Requirements

SetFlow is live-performance software.

The following must not interrupt the overall session:

- WAN failure
- Internet failure
- individual musician disconnect
- browser refresh
- one musician device crashing

The host remains authoritative.

Clients automatically reconnect and retrieve current state. WAN loss must have no effect on LAN commands or chart delivery. LAN failure or host failure can interrupt live synchronization; clients show the disconnect clearly. MVP does not promise host failover. A MIDI disconnect affects only that input adapter.

---

## 27. MVP

SetFlow 0.1 should include:

1. File, paste, and manual acquisition through `SongProvider`, with no external API dependency.
2. SongSelect-style metadata, semantic/comment section detection, manual correction, and original-label preservation.
3. Chord parsing, chord-only/bar lines, slash chords, transposition, and original-source/unknown-directive preservation.
4. Distinct chorus variants and automatic Source Order arrangements.
5. Song Map editor, repeated section references, saved arrangements, setlists, and performance keys.
6. Arrangement Engine and stable chronological section occurrences.
7. Authoritative Performance Engine and first-class Performance State with current/next occurrences, repetitions, cues, and live deviations.
8. Live `NEXT`, `PREVIOUS`, `REPEAT`, `JUMP`, `VAMP`, and `END` with the semantics in §19.
9. Shared command gateway with Web UI, keyboard, and basic host-connected MIDI controller input.
10. Control View, portrait Stage View, and browser Musician View with independent browsing and Return to Live.
11. Local WebSocket snapshots, acknowledgements, revision checks, reconnect behavior, and visible stale-state indicators.
12. Local persistence, organization-local content handling, and explicit host recovery.
13. Fully offline startup, fresh client join, editing, transposition, and performance on a working LAN.

MIDI controller input is MVP. External MIDI outputs and integrations remain outside MVP. No click or track is needed to exercise any live feature.

---

## 28. Explicit MVP Non-Goals

SetFlow 0.1 will not provide:

- SongSelect, PraiseCharts, or other provider APIs; CCLI account authentication or automatic reporting.
- Cloud accounts, cloud synchronization, hosted content libraries, or cloud backups.
- Raspberry Pi appliance packaging or custom GPIO controller hardware.
- ProPresenter, QLC+, PRIME, WorshipTools/Presenter, Planning Center, or other external application integrations.
- Lighting/DMX control, outgoing MIDI cues, MIDI clock, or automated congregation lyrics.
- Audio/click/multitrack playback, track synchronization, DAW functionality, or automatic musical-time tracking.
- Volunteer scheduling, a WorshipTools/Planning Center replacement, or host failover.
- Automatic merging/linking of similar sections or personal annotation systems.

Basic MIDI controller **input** is included in MVP; this does not include controlling PRIME, Presenter, lights, or tracks.

---

## 29. Future Integrations and Extensions

Possible future work, independent of the MVP:

- Official PraiseCharts, SongSelect, and other `SongProvider` adapters, subject to access, authorization, and provider terms. Their absence must never prevent local imports or performance.
- ProPresenter as a named future presentation target, with the section-cue boundary defined below; WorshipTools/Presenter, Planning Center, and PRIME interoperability through separate adapters.
- Outgoing MIDI section cues, including optional mapping from SetFlow sections to presentation lyrics. External presentation state must not silently override band state.
- QLC+ and other lighting outputs; optional tracks/click integrations that preserve a track-independent operating mode.
- Raspberry Pi appliance packaging and GPIO input adapters using the existing command path.
- Optional cloud accounts, configuration, and synchronization outside the live command loop, with licensed content kept local unless provider terms permit storage.
- CCLI reporting where supported by applicable permissions and technical access.
- Explicit section linking with a differences preview; shared and personal musician notes.

Future adapters consume accepted state changes or submit authorized commands through the same gateway. They must avoid feedback loops and fail independently; the local Performance Engine remains authoritative. Core operation does not depend on any integration.

### 29.1 ProPresenter Section-Cue Integration — Future Only

Investigate supported integration mechanisms before selecting a transport or promising compatibility. The initial target is optional section-level cueing, not complete lyric automation or a replacement presentation application.

- Explicitly map a SetFlow song and section ID to a presentation and its section-entry cue. Preserve distinct variants such as C1A and C1C; never infer a safe mapping from the word “Chorus” alone.
- When following is enabled, an accepted transition to a new occurrence may request its mapped entry cue. This includes a repeated occurrence of the same section. Key changes, cue-text changes, and snapshot refreshes must not retrigger slide navigation.
- Entering vamp mode alone does not advance slides. An explicit repeated occurrence may request section entry; within-section lyric advancement remains with the presentation operator.
- Provide a mapping preview/test and an explicit follow enable/disable control. The slides operator must have an accessible way to disengage following. While disabled, navigation is independent; resuming requires an explicit current-section synchronization action.
- Track requested cues separately from confirmed presentation state. Missing mappings, failed delivery, or unavailable acknowledgement must remain visible without blocking band commands. A successful send is not proof of the displayed slide.
- Deduplicate outgoing requests by session and accepted transition revision. After reconnecting, do not replay missed cues or automatically jump the presentation to a stale section. Require explicit resynchronization.
- Do not send an implicit blackout or clear-screen command on `END`; leave the presentation under operator control unless a separate, explicit end-cue mapping is configured.

**Section identity does not determine the current lyric line or slide within that section.** Automatic within-section progression would require a separately specified cue model and operator workflow; it must not be inferred from tempo or elapsed time. ProPresenter and WorshipTools Presenter are separate integration targets.

Future integration acceptance must verify exact variant mappings, repeat behavior, independent slide navigation while following is disabled, explicit resynchronization, and uninterrupted SetFlow operation when the presentation application disconnects. None of these integrations is an MVP dependency.

---

## 30. MVP Acceptance Test

### 30.1 Preserve Real-World Import Behavior

Use the original SongSelect-style "Because He Lives (Amen)" fixture with metadata and these ten sections:

```text
I → V1 → C1A → INST → V2 → C1B → B → C1C → C1D → E
```

1. Read title, artist, key, tempo, time, CCLI/license, copyright, and footer when supplied.
2. Detect all ten sections, preserving source labels, order, content, and musical classification.
3. Keep C1A, C1B, C1C, and C1D distinct; never replace them with one generic chorus.
4. Preserve chord-only Intro/Instrumental content, bar notation, unknown directives, and original ChordPro.
5. Preserve uncertain comments as annotations; allow manual conversion/correction and honor explicit semantic boundaries.
6. Automatically create Source Order. Reorder sections, repeat references, and generate separate stable occurrences without duplicating section definitions.
7. Transpose chords, including slash bass notes, without altering lyrics, bars, labels, or original source.

### 30.2 Conduct a Live Band Without Tracks

1. Create `I → V1 → C1A → V2 → C1B → B×2 → C1C×2 → E`. This uses the actual fixture's distinct variants. For a separate song with one verified common chorus, the equivalent compact map may be `I V1 C V2 C B×2 C×2 E`.
2. Connect Control, Stage, and a second musician device on LAN. Start ready and use `NEXT` to enter Intro. All views show the same current/next occurrences and key.
3. Advance to Bridge 2/2. Press `REPEAT` at the intended boundary: all views immediately show Bridge 3/3, with C1C next. The saved map still contains B×2.
4. Press a configured Chorus button: `JUMP` targets C1C by section ID, and all views immediately show that exact chorus variant. `NEXT` follows its selected occurrence's successor.
5. Exercise `PREVIOUS`; verify position changes agree across views. Jump to a section absent from the custom map (INST), verify a live occurrence is inserted, and verify its prior successor is retained.
6. Enter Bridge and press `VAMP`. All views show the indefinite hold and exit target. Waiting does not advance; `REPEAT` counts another iteration; `NEXT` exits to the saved successor.
7. Issue `END`; all views show ended with no current/next target. Distinguish this from jumping to Ending.
8. Exercise each command through Web UI and keyboard, then through a mapped host-connected MIDI controller. Verify release events do not double-trigger and unplugging MIDI leaves other inputs usable.
9. Browse backward on the musician device while band state advances. Confirm the live indicator remains accurate and Return to Live restores following without affecting Stage View.
10. Verify all actions work without a click, track, ProPresenter, WorshipTools Presenter, provider account, or any other external application. Do not create, load, or run a playback timeline, even a silent one; leave tempo unset in a separate manual-song fixture and confirm the same command behavior.

### 30.3 Offline Operation and Recovery

1. Disconnect WAN while preserving LAN. Continue commands, chart rendering, key changes, and synchronization. Join a fresh browser client and obtain the application, content, and current snapshot locally.
2. Refresh/disconnect one musician client while the MD advances. Reconnect to the current snapshot, without replaying missed presses or disrupting other clients.
3. Retry an acknowledged command with the same ID; it must not execute twice. Reject stale-revision commands and invalid section targets without corrupting state.
4. Edit and save a chart/map locally; connected editors receive the revision. An active session retains its pinned content until the defined explicit apply/restart step.
5. Restart the host with WAN still disconnected. Verify local library, original sources, maps, keys, provenance, and MIDI mappings survive; offer explicit performance recovery and reconnect clients to its new session.
6. Confirm licensed source and derived chart content remain organization-local and that no remote asset, login, API, or cloud request is required for the acceptance flow.

### 30.4 Actual Rehearsal Usability Gate

Run this test with an MD and musicians using the intended stage display and at least one personal device. Configure the controller and section mappings beforehand, then perform without WAN access or a playback timeline.

1. While playing, have the worship leader call “bridge again,” “chorus now,” and “hold here” at unplanned points. The MD must execute each configured action with one deliberate button or key press, without editing the map or opening a dialog.
2. Confirm musicians can identify the resulting current section, repetition/vamp status, and next section from their displays without asking the MD to explain the screen. Use the exact chorus variant mapped for this rehearsal.
3. Have one musician browse ahead, then Return to Live. Verify their browsing never changes the band's state and that they can rejoin the current occurrence confidently.
4. Record command-to-display delay on the actual LAN and note missed, duplicate, or visibly inconsistent transitions. As an initial MVP target, at least 95% of 30 representative commands should appear on every connected test display within 250 ms of host acceptance; no command may be lost or applied twice. Report the device/network setup with the result. This target measures software propagation, separately from the MD's reaction time.
5. Ask the MD whether control interfered with playing and each musician whether the live display reduced uncertainty. Record specific failures and repeat affected scenarios after correction. Passing transport tests alone does not validate the product if routine controls distract the MD or section changes confuse the band.

### 30.5 Final Pipeline

```text
File / Paste / Manual (MVP) ──┐
Official providers (future) ──┴→ SongProvider
                                    ↓
                      Preserved Source + Provenance
                                    ↓
                     Parser / Normalized SetFlowSong
                                    ↓
                         Reusable Section Definitions
                                    ↓
                         Song Map / Saved Arrangement
                                    ↓
                    Arrangement Engine / Planned Sequence
                                    ↓
MD / Band → Web / Keyboard / MIDI → PerformanceCommand
                                    ↓
                        Local Performance Engine
                                    ↓
                    Authoritative Performance State
                                    ↓
                  Control + Stage + Musician Views (LAN)
                                    ↓
                Optional future adapters (e.g. ProPresenter)
                                    ↓
                 Section-entry cue requests, when enabled
                                    ↓
                Presentation app / operator controls slides
```

**The band's arrangement provides the plan; the MD-directed Performance State provides live band truth. Local charts and band displays follow that state without Internet access or any playback timeline. Optional presentation integrations request section cues while the presentation application and its operator retain authority over the actual slides.**

---
