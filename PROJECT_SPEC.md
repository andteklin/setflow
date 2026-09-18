# SetFlow — Project Specification

## 1. Project Overview

**SetFlow** is a local-first worship chart and music-director application designed to turn structured ChordPro songs and programmed song maps into readable, synchronized charts for musicians and stage displays.

The core problem SetFlow solves is that traditional chord charts define the sections of a song but do not necessarily display those sections in the chronological order in which they will be performed.

For example, a song may contain:

- Verse 1
- Verse 2
- Chorus
- Bridge
- Tag

while the actual arrangement is:

`Intro → Verse 1 → Chorus → Verse 2 → Chorus → Bridge ×4 → Chorus ×2 → Tag`

SetFlow should allow each musical section to be defined **once**, define the performance order separately as a **Song Map**, and automatically generate the performance chart from that map.

SetFlow must also operate entirely over a local network without requiring Internet access. This allows it to function reliably at retreats, conferences, outdoor events, and other locations with poor or nonexistent Internet connectivity.

---

# 2. Core Design Principles

## 2.1 Local First

All functionality required during a live performance must work without Internet access.

The cloud must never be required in the live control path.

A typical deployment should function as:

```text
                     LOCAL ROUTER
                    (WAN optional)
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

Internet connectivity may be used for optional importing, synchronization, backup, or integrations, but loss of WAN connectivity must not interrupt an active SetFlow session.

## 2.2 Single Source of Truth

Each song should contain one authoritative definition of its musical sections.

Repeated sections should not require duplicated ChordPro content.

For example:

```text
Verse 1
Chorus
Verse 2
Bridge
Tag
```

plus:

```text
Song Map:
V1 → C → V2 → C → B → B → C → Tag
```

should generate the complete performance sequence automatically.

Changing the Chorus definition must update **every occurrence of the Chorus**.

## 2.3 Separate Content from Arrangement

SetFlow must distinguish between:

**Song Content**
- lyrics
- chords
- section names
- metadata

and:

**Song Arrangement**
- chronological section order
- repeated sections
- optional sections
- arrangement-specific notes

The same song content should be capable of supporting multiple arrangements.

Example:

```text
Build My Life

Arrangement: Standard
I → V1 → C → V2 → C → B×2 → C → O

Arrangement: Acoustic
V1 → C → V2 → C → B → C
```

## 2.4 One Application, Multiple Views

SetFlow should be implemented as one application with a shared data model and multiple interfaces.

Required views:

1. **Control View**
2. **Stage View**
3. **Musician View**

Future versions may add a dedicated **MD View**.

---

# 3. Primary Use Cases

## 3.1 Normal Worship Service

The operator:

1. Opens SetFlow.
2. Selects a setlist.
3. Selects a song.
4. Loads the desired arrangement.
5. Outputs Stage View to a portrait external display.
6. The external display is distributed to multiple stage TVs.

## 3.2 Offline Event

The host laptop and musician devices connect to a local router.

No WAN connection is required.

Musicians navigate to the SetFlow server using a local URL.

Example:

```text
http://setflow.local
```

All charts and song data are served locally.

## 3.3 Rehearsal Chart Change

During rehearsal, the MD notices an incorrect chord.

The operator changes:

```text
[G]Great are You Lord
```

to:

```text
[G/B]Great are You Lord
```

After saving:

- Stage View updates.
- Every occurrence of that section updates.
- Connected Musician Views receive the new chart.
- No Internet connection is required.

## 3.4 Arrangement Change

The worship leader changes:

```text
Bridge ×2
```

to:

```text
Bridge ×4
```

The operator modifies the Song Map.

SetFlow immediately regenerates the performance sequence without requiring the Bridge content to be copied and pasted.

---

# 4. Song Data Model

Each song should contain at minimum:

```text
Song
├── ID
├── Title
├── Artist
├── Original Key
├── Current Key
├── Tempo
├── Time Signature
├── ChordPro Source
├── Sections
└── Arrangements
```

Optional metadata may include:

- CCLI number
- BPM
- duration
- notes
- tags
- source
- copyright information

---

# 5. Section Model

SetFlow should parse ChordPro into identifiable musical sections.

Example source:

```text
{title: Build My Life}
{key: G}

{start_of_verse: Verse 1}
[G]Worthy of every song
We could ever [C]sing
{end_of_verse}

{start_of_chorus: Chorus}
[C]Holy, there is no one like You
[G]There is none beside You
{end_of_chorus}

{start_of_bridge: Bridge}
[C]I will build my life
[D]Upon Your love
{end_of_bridge}
```

Internally:

```text
sections = {
    "V1": Verse 1,
    "C": Chorus,
    "B": Bridge
}
```

Each section should have:

- unique identifier
- display name
- section type
- ChordPro content
- ordering metadata where applicable

---

# 6. Song Maps

Song Maps define the actual performance sequence.

Example:

```text
I → V1 → C → V2 → C → B×4 → C×2 → T
```

Internally this may be represented as:

```text
[
  "INTRO",
  "VERSE_1",
  "CHORUS",
  "VERSE_2",
  "CHORUS",
  "BRIDGE",
  "BRIDGE",
  "BRIDGE",
  "BRIDGE",
  "CHORUS",
  "CHORUS",
  "TAG"
]
```

The UI should allow song maps to be created without manually editing this representation.

### Required Song Map Operations

The operator must be able to:

- add a section
- remove a section
- reorder sections
- duplicate a section
- specify repetitions
- clear the map
- save the map as an arrangement
- select among saved arrangements

A drag-and-drop interface is preferred.

Example:

```text
[Intro]
[Verse 1]
[Chorus]
[Verse 2]
[Chorus]
[Bridge ×4]
[Chorus ×2]
[Tag]
```

---

# 7. Automatic Performance Chart Generation

SetFlow must generate a chronological chart from:

```text
Section definitions + Song Map
```

Example:

```text
VERSE 1
<Verse 1 content>

CHORUS
<Chorus content>

VERSE 2
<Verse 2 content>

CHORUS
<Chorus content>

BRIDGE
<Bridge content>

BRIDGE
<Bridge content>

CHORUS
<Chorus content>
```

The generated chart must update whenever:

- ChordPro source changes
- a section changes
- the song map changes
- the key changes

---

# 8. ChordPro Requirements

SetFlow should use **ChordPro as its primary interchange format**.

Required support:

- inline chords
- song title
- artist
- key
- comments
- section directives
- verse sections
- chorus sections
- bridge sections
- custom sections

Example:

```text
[G]Amazing grace how [C]sweet the [G]sound
```

The application should parse ChordPro into structured data rather than treating it solely as formatted text.

---

# 9. Transposition

SetFlow must support automatic chord transposition.

Changing:

```text
Key: G
```

to:

```text
Key: A
```

should transpose all recognized chords.

Example:

```text
G → A
C → D
D → E
Em → F#m
G/B → A/C#
```

The underlying original chart should remain preserved.

The UI should provide:

```text
[-1] [-½]  KEY: G  [+½] [+1]
```

or equivalent controls.

Enharmonic spelling should be musically sensible.

---

# 10. Control View

Control View is the primary operator/MD interface.

It should run on the host laptop's built-in landscape display.

Example layout:

```text
+-------------------------------------------------------+
| SETFLOW                         Fall Getaway - Session 2 |
+----------------+--------------------------------------+
| SETLIST        | BUILD MY LIFE                       |
|                | Key: E      BPM: 68                 |
| Gratitude      |                                      |
| Build My Life  | SONG MAP                            |
| Firm Foundation|                                      |
| Goodness of God| V1 → C → V2 → C → B×4 → C×2 → T   |
|                |                                      |
|                | CURRENT: Bridge 2/4                 |
|                | NEXT: Bridge 3/4                    |
|                |                                      |
|                | [PREV] [NEXT] [JUMP TO...]          |
+----------------+--------------------------------------+
```

Control View should provide:

- setlist navigation
- song selection
- arrangement selection
- current section
- next section
- previous/next controls
- direct section jumping
- key/transposition controls
- ChordPro editing
- Song Map editing
- Stage View status

---

# 11. Stage View

Stage View is designed primarily for large portrait displays.

Target display sizes:

- 24"
- 27"
- 32"
- 43"

Typical resolution:

```text
1080 × 1920
```

Stage View should prioritize **maximum readability at distance**.

Example:

```text
+----------------------------+
| BUILD MY LIFE        KEY: E|
|                            |
|          CHORUS            |
|                            |
| A                          |
| Holy, there is no one      |
| like You                   |
|                            |
| E/G#                       |
| There is none beside You   |
|                            |
|                            |
| NEXT: BRIDGE               |
+----------------------------+
```

### Stage View Requirements

- fullscreen
- portrait optimized
- very large text
- clear section labels
- high visual contrast
- minimal controls
- no editing UI
- current song title
- current key
- current section
- optional next-section indicator

Stage View should be capable of showing:

**Section Mode**
- one musical section at a time

and optionally:

**Chart Mode**
- chronological full-song chart

---

# 12. External Display Architecture

The host computer should use an **extended desktop**.

Example:

```text
Laptop Display
1920 × 1080 landscape
        |
        └── Control View

External Display
1080 × 1920 portrait
        |
        └── Stage View
                |
             HDMI
                |
          HDMI Splitter
          /     |     \
        TV 1   TV 2   TV 3
```

SetFlow itself does not need to manage the HDMI splitter.

The operating system handles the external display.

---

# 13. Musician View

Musician View is intended for:

- drummer
- bassist
- instrumentalists
- vocalists
- other musicians without direct visibility of the stage TVs

It should be accessible through a standard web browser.

No native application should be required.

Example:

```text
http://setflow.local
```

### Musician View Requirements

Musicians should receive:

- current song
- current chart revision
- current key
- chronological chart
- updated ChordPro content

Musicians should be allowed to control locally:

- scrolling
- zoom/font size
- light/dark mode
- potentially chord display preference

Musicians should **not** have their scrolling position forcibly synchronized by default.

The MD controls **content**, not where each musician is looking.

---

# 14. Local Networking

The host laptop runs the SetFlow server.

All devices connect through a local router.

Example:

```text
AX3000
192.168.1.1

SetFlow Host
192.168.1.10

Musician Devices
192.168.1.x
```

Internet access is optional.

SetFlow must continue functioning if the router WAN cable is disconnected.

---

# 15. Real-Time Updates

SetFlow should use a real-time local communication mechanism such as WebSockets.

When authoritative state changes, connected clients should receive the update.

Examples:

- ChordPro edited
- key changed
- arrangement changed
- song changed
- chart revision changed

The system should synchronize **state**, not merely events.

Bad:

```text
NEXT_PAGE
NEXT_PAGE
NEXT_PAGE
```

Preferred:

```text
song_id: 42
revision: 17
key: E
current_section: BRIDGE
section_occurrence: 2
```

This allows disconnected devices to immediately recover the correct state after reconnecting.

---

# 16. Reconnection Behavior

If a musician's device temporarily disconnects:

1. The rest of SetFlow must continue operating.
2. The disconnected client should attempt to reconnect.
3. Upon reconnection, it requests the current authoritative state.
4. The chart immediately updates to the latest revision.

Clients should not need to replay missed events.

---

# 17. Setlists

SetFlow should support ordered setlists.

Example:

```text
Fall Getaway 2026 — Saturday Night

1. House of the Lord
2. Build My Life
3. Gratitude
4. Firm Foundation
5. Goodness of God
```

Each setlist item should reference:

- song
- selected arrangement
- performance key
- optional notes

---

# 18. Local Persistence

All required data must be stored locally.

This includes:

- songs
- ChordPro source
- arrangements
- song maps
- setlists
- application settings

Closing and reopening SetFlow must not require Internet access.

---

# 19. Import and Export

## Required

SetFlow should support:

- importing ChordPro files
- exporting ChordPro files
- copying ChordPro to clipboard
- importing/exporting SetFlow song data

## Desired

Future integrations may include:

- WorshipTools import/export
- Planning Center import
- SongSelect import
- setlist bundle export

External integrations must remain optional.

---

# 20. Revision Tracking

Every meaningful chart edit should increment a revision number.

Example:

```text
Build My Life
Revision 14
```

Connected clients should know which revision they are displaying.

This helps prevent situations where different musicians unknowingly have different versions.

Future versions may provide:

- revision history
- undo
- restore previous revision
- change comparison

---

# 21. MD / Performance Features

Future versions may include a dedicated MD mode.

Potential features:

- current section
- next section
- remaining arrangement
- BPM
- key
- time signature
- MD notes
- countdown
- elapsed song time
- set duration

Example:

```text
BUILD MY LIFE

CURRENT
BRIDGE 2/4

NEXT
BRIDGE 3/4

THEN
BRIDGE 4/4
CHORUS
CHORUS
TAG
```

---

# 22. Stage Cues

Future versions may allow the MD to send temporary cues.

Examples:

```text
CHORUS AGAIN
VAMP
BUILD
DOWN
END
SKIP V2
```

These cues may appear temporarily at the top of Stage View and/or Musician View.

They should not modify the underlying chart.

---

# 23. PRIME / MIDI Integration

Future versions may support external playback systems such as Loop Community PRIME.

Potential inputs:

- MIDI
- MIDI clock
- section triggers
- song selection
- playback state

Example future architecture:

```text
PRIME
  |
  | MIDI / section events
  v
SetFlow
  |
  +--> Stage View
  |
  +--> Musician View
```

This integration must not be required for basic operation.

---

# 24. User Roles

MVP roles:

### Operator

Can:

- edit songs
- edit ChordPro
- edit song maps
- change keys
- create setlists
- control Stage View

### Musician

Can:

- view charts
- adjust local display settings
- scroll independently

Cannot modify authoritative song content.

Future versions may add:

- MD
- administrator
- read-only guest

---

# 25. Reliability Requirements

SetFlow is live-performance software.

Reliability is more important than feature count.

The following failures must not terminate an active session:

- Internet loss
- WAN disconnect
- musician device disconnect
- musician browser refresh
- one musician device crashing

The host should remain authoritative throughout the session.

---

# 26. Performance Requirements

For a typical local network:

- chart updates should appear on connected clients in less than approximately 250 ms
- Stage View should update effectively instantaneously
- changing songs should not require a page reload
- reconnecting clients should recover automatically
- the application should comfortably support at least 20 simultaneous musician clients

---

# 27. Security Model

SetFlow is primarily intended for trusted local networks.

MVP security can therefore remain simple.

However:

- Musician clients must not be able to modify authoritative data.
- Operator controls should not be exposed accidentally through Musician View.
- The server should not require Internet-facing ports.
- No cloud account should be required.

Future versions may add a simple session PIN or operator password.

---

# 28. Platform Requirements

The host application should ideally support:

- Windows
- macOS

Musician View should support modern browsers on:

- iOS
- iPadOS
- Android
- Windows
- macOS

Stage View should run in a browser or dedicated application window.

---

# 29. MVP Scope

Version 0.1 should contain only:

1. Local SetFlow server
2. ChordPro song storage
3. ChordPro parser/rendering
4. Section recognition
5. Song Map creation
6. Automatic chronological chart generation
7. Setlists
8. Key transposition
9. Control View
10. Portrait Stage View
11. Browser-based Musician View
12. Real-time LAN chart updates
13. Local persistence
14. Reconnection/state recovery

If these features work reliably, SetFlow already solves its primary problem.

---

# 30. Explicit Non-Goals for MVP

Version 0.1 should **not** attempt to become:

- a WorshipTools replacement
- presentation software for congregation lyrics
- a church scheduling platform
- a volunteer management system
- a cloud service
- a multitrack playback application
- a DAW
- a lighting controller
- a full Planning Center replacement
- a full music notation editor

SetFlow should do one thing exceptionally well:

> **Turn ChordPro sections and a programmed song map into reliable, readable, synchronized performance charts over a local network.**

---

# 31. Future Feature Ideas

After the MVP is stable:

- PWA installation
- QR-code musician joining
- Nashville Number System
- Roman numeral display
- per-user chord preferences
- annotations
- personal musician notes
- MIDI integration
- PRIME integration
- foot-pedal control
- automatic scrolling
- timed section advancement
- MD cue messages
- multiple simultaneous stage outputs
- WorshipTools interoperability
- Planning Center interoperability
- cloud backup
- collaborative editing
- revision history
- PDF export
- printable charts

---

# 32. Definition of MVP Success

SetFlow 0.1 is successful if the following test works:

1. Connect a host laptop, phone, and tablet to a router.
2. Disconnect the router's WAN connection completely.
3. Launch SetFlow on the laptop.
4. Open Musician View on the phone and tablet.
5. Load a song containing Verse, Chorus, and Bridge sections.
6. Program:

   `V1 → C → V2 → C → B×2 → C`

7. Verify that SetFlow generates the chart in that chronological order.
8. Change a chord in the Chorus.
9. Verify that every Chorus occurrence updates.
10. Verify that Stage View updates.
11. Verify that both musician devices update automatically.
12. Change the song key.
13. Verify that all views transpose.
14. Disconnect one musician device.
15. Change the chart.
16. Reconnect the device.
17. Verify that it immediately receives the newest chart revision.

All of this must succeed with:

**zero Internet connectivity.**

If this works reliably, the fundamental SetFlow architecture is successful.