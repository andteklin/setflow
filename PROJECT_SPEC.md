# SetFlow — Project Specification

## 1. Project Overview

**SetFlow** is a local-first worship chart and music-director application that converts ChordPro songs into programmable, chronological performance charts.

SetFlow separates two concepts that are commonly combined in static worship charts:

1. **Song content** — the reusable musical sections of a song.
2. **Song arrangement** — the order in which those sections are performed.

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

# 2. Core Design Principles

## 2.1 Local First

Internet connectivity must never be required during a live performance.

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
        /    |    \
      TV 1  TV 2  TV 3
```

Optional cloud integrations may exist in the future, but loss of Internet connectivity must not interrupt an active SetFlow session.

## 2.2 Preserve the Original ChordPro

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
Section / Arrangement Engine
       ↓
Renderer
```

The original source remains available for editing, export, debugging, and reparsing.

## 2.3 Separate Content from Arrangement

The source chart defines musical content.

A SetFlow Arrangement defines performance order.

Multiple arrangements may reference the same song.

## 2.4 One Application, Multiple Views

SetFlow is one application with a shared data model and at least three interfaces:

- **Control View**
- **Stage View**
- **Musician View**

---

# 3. Real-World ChordPro Compatibility

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

# 4. Metadata Parsing

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

# 5. Section Detection

## 5.1 Comment-Based Sections

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

## 5.2 Semantic Section Directives

SetFlow should additionally support standard semantic ChordPro structures where available, such as verse, chorus, bridge, or custom environment directives.

Semantic directives should take precedence over heuristic comment detection where the source explicitly supplies them.

## 5.3 Section Recognition

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

## 5.4 Unknown Section Names

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

# 6. Comments vs. Section Markers

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

# 7. Section Model

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

# 8. Important: Similar Sections Are Not Necessarily Identical

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

# 9. Optional Section Linking

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

# 10. Default Imported Arrangement

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

# 11. Song Maps

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

# 12. Song Map Editor

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

# 13. Chord Parsing

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

# 14. Bar / Chord-Only Lines

SetFlow must correctly render instrumental notation such as:

```chordpro
[|] [Am]    [F]    [|] [C]         [|] [Am]    [F]    [|] [C]         [|]
```

The renderer must not assume every line contains lyrics.

Chord-only sections such as Intro and Instrumental are first-class chart content.

Stage View should preserve enough spacing and bar information for these sections to remain musically useful.

---

# 15. Transposition

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

# 16. Import Workflow

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

# 17. Import Preview

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

# 18. Rendering Architecture

SetFlow should not rely on an external library's final HTML output as its primary renderer.

An external ChordPro library may be used for:

- tokenization
- ChordPro parsing
- chord recognition
- transposition
- metadata parsing

SetFlow should convert parser output into its own internal model.

```text
ChordPro Source
      ↓
ChordPro Parser
      ↓
Parser-Specific Model
      ↓
SetFlow Adapter
      ↓
SetFlowSong
      ↓
Arrangement Engine
      ↓
Performance Sequence
      ↓
┌───────────────┬────────────────┐
│               │                │
Control View  Stage View    Musician View
```

This prevents SetFlow from becoming tightly coupled to one ChordPro library.

---

# 19. Generated Performance Sequence

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

# 20. Control View

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
- previous/next controls
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
|                | [PREV] [NEXT] [JUMP TO...]          |
+----------------+--------------------------------------+
```

---

# 21. Stage View

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

# 22. Musician View

Musician View provides the chronological chart through any modern browser on the local network.

Musicians may independently control:

- scroll position
- zoom/font size
- light/dark mode

Authoritative content remains controlled by the host.

A musician should be able to view the entire generated arrangement while Stage View may show only the current section.

---

# 23. Real-Time Synchronization

The host is authoritative.

Clients should synchronize state such as:

```json
{
  "songId": "because-he-lives-amen",
  "revision": 17,
  "arrangementId": "default",
  "performanceKey": "C",
  "currentOccurrence": 6
}
```

State synchronization is preferred over event-only synchronization.

A reconnecting client must immediately obtain the current state rather than replay missed button presses.

---

# 24. Local Networking

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

# 25. Local Persistence

SetFlow must locally store:

- original ChordPro
- parsed song data
- section definitions
- arrangements
- setlists
- performance keys
- settings
- revision information

Restarting SetFlow must not require Internet connectivity.

---

# 26. Reliability Requirements

SetFlow is live-performance software.

The following must not interrupt the overall session:

- WAN failure
- Internet failure
- individual musician disconnect
- browser refresh
- one musician device crashing

The host remains authoritative.

Clients automatically reconnect and retrieve current state.

---

# 27. MVP

SetFlow 0.1 should include:

1. ChordPro file import
2. ChordPro paste import
3. SongSelect-style metadata parsing
4. `{comment: ...}` section detection
5. Section normalization
6. Chord parsing
7. Chord-only/instrumental line support
8. Original-source preservation
9. Automatic Source Order arrangement
10. Song Map editor
11. Repeated section references
12. Chronological performance-sequence generation
13. Transposition
14. Setlists
15. Control View
16. Portrait Stage View
17. Browser Musician View
18. Local WebSocket synchronization
19. Local persistence
20. Client reconnection

---

# 28. Explicit MVP Non-Goals

SetFlow 0.1 will not attempt to provide:

- direct SongSelect API integration
- CCLI account authentication
- automatic CCLI reporting
- congregation lyric presentation
- volunteer scheduling
- cloud accounts
- cloud synchronization
- multitrack playback
- lighting control
- DAW functionality
- WorshipTools replacement
- Planning Center replacement

---

# 29. Future Integrations

Possible future integrations include:

- official SongSelect integration if API/partnership access becomes available
- WorshipTools interoperability
- Planning Center interoperability
- PRIME/MIDI integration
- MIDI integration with WorshipTools (map midi cues to sections). On section change, a MIDI command is cued and jumps to the first lyric of the section that was cued. 
- CCLI reporting where legally and technically supported

SetFlow's core architecture must not depend on any of these integrations.

---

# 30. MVP Acceptance Test

Given a SongSelect ChordPro chart structured like:

```chordpro
{title: Because He Lives (Amen)}
{key: C}
{tempo: 84}

{comment: Intro}
...

{comment: Verse 1}
...

{comment: Chorus 1a}
...

{comment: Instrumental}
...

{comment: Verse 2}
...

{comment: Chorus 1b}
...

{comment: Bridge}
...

{comment: Chorus 1c}
...

{comment: Chorus 1d}
...

{comment: Ending}
...
```

SetFlow must:

1. Read the metadata.
2. Detect all ten sections.
3. Preserve their original names.
4. Classify their musical types.
5. Preserve chord-only Intro/Instrumental content.
6. Create a Source Order arrangement automatically.
7. Allow the user to reorder the sections.
8. Allow repeated references to sections.
9. Generate a chronological performance sequence.
10. Render that sequence correctly.
11. Transpose chords including slash chords.
12. Display the current section on Stage View.
13. Display the full arrangement in Musician View.
14. Propagate edits to connected clients.
15. Continue doing all of the above without Internet connectivity.

The fundamental SetFlow pipeline is therefore:

> **Real-world ChordPro → Sections → Song Map → Performance Sequence → Stage + Musician Views**

rather than:

> **ChordPro → static formatted document**