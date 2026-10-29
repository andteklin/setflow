# SetFlow — Cloud + Local Architecture and Migration Plan

**Status:** proposal, not yet approved · **Date:** 2026-10-26

This document looks at how the current prototype can grow into a hybrid system:

- a **cloud** deployment for preparation during the week;
- a **local-first** host for rehearsal and services, which keeps working with no Internet.

It builds on [PROJECT_SPEC.md](../PROJECT_SPEC.md), in particular §2.6 (planned arrangement and live authority) and §25.1 (cloud preparation and local performance).

The guiding principle:

> The cloud owns what we plan to play. The local SetFlow host owns what we are playing right now.

Live commands never make a round trip through the cloud.

---

## A. Current architecture

SetFlow is an npm-workspaces monorepo with three packages and the older arranger tool. At the time of writing all tests pass: 75 in core, 15 in server.

| Package | Role | I/O |
|---|---|---|
| [packages/core](../packages/core/src/index.ts) | ChordPro parsing, section vocabulary and normalization, song maps, arrangement expansion, serialization, transposition, the performance engine and the command gateway (`PerformanceSession`) | None. It runs in Node and in the browser; [control.ts](../packages/web/src/views/control.ts) already calls `parseChordPro` client-side. |
| [packages/server](../packages/server/src/app.ts) | The local host: plain Node `http` + `ws`, a `node:sqlite` store, the Library service, `LiveHost`, MIDI input. It also serves the built web app. | All of it |
| [packages/web](../packages/web/src/main.ts) | Vite with no framework. Hash routes `#/control`, `#/stage`, `#/musician` in one bundle. | Same-origin `/api` and `/ws` |
| [setflow-parser-test](../setflow-parser-test/src/arrange.ts) | The earlier tool that writes arranged ChordPro for WorshipTools. It imports `@setflow/core`. | Files |

### Data flow

```text
Import:   paste/file → POST /api/import/preview (parse, sections, warnings)
                     → POST /api/songs → songs.source_text (verbatim) + auto "Source Order" arrangement
Read:     every GET re-parses source_text → sections are derived, never stored
Arrange:  arrangement = song-map TEXT ("I → V1 → B×2") + performanceKey, resolved against the current source
Live:     POST /api/session/start {songId, arrangementId}
          → parse + resolve map → applyArrangement → plannedSequence
          → PerformanceSession (pinned copy of source text + map; recovery row in SQLite)
Commands: client/MIDI → CommandEnvelope {sessionId, expectedRevision, controllerId, commandId}
          → gateway (idempotent, revision-checked, single controller) → new PerformanceState
          → WS broadcast "status" → each client fetches /api/session/content once per sessionId
Library:  any mutating route → WS broadcast "library" → Control reloads
```

Arranged ChordPro generation (`serializeChordPro`) lives in core. Today only the legacy parser-test tool uses it; the host has no export endpoint yet.

---

## B. Compatibility assessment

### Already fits the target architecture

1. **Core is already the shared domain layer.** It does no I/O and runs in both the browser and Node, so a cloud deployment can import it unchanged.
2. **Live authority is already local.** `PerformanceSession` makes the host authoritative and gives:
   - revision numbers;
   - idempotent command ids;
   - a single controller;
   - rejection of commands meant for another session.

   Commands never leave the LAN.
3. **Clients are independent.** Stage is its own URL and WebSocket client, not a child window, so devices can be combined in any way.
4. **Inputs map to generic commands.** MIDI produces a `PerformanceCommand` and goes through the same gateway as the web UI. Clickers should follow this pattern.
5. **The host serves its own assets.** A fresh browser can load the app with the Internet down, and `index.html` loads nothing external.
6. **Pinning exists.** `PinnedContent` freezes the song text and the arrangement revision for a session, so library edits never touch a running song. It is a one-song version of the "offline package" this plan proposes.
7. **Optimistic concurrency exists.** Songs and arrangements carry `revision`. Edits send `expectedRevision`, and the server answers 409 on a mismatch. This is the seed of base-revision sync.
8. **Live deviations are recorded separately** in `PerformanceState.liveDeviations` and never written back to the arrangement. A future "save live changes to the arrangement" action can build on this.

### Would become problematic

1. **Live sessions are per-song and ad hoc.** The MD starts each song from the library, and setlists are only a sidebar list. There is no "service" unit, so nothing defines what to download for Sunday. This is the biggest gap.
2. **Arrangements are not bound to a song revision.** The map text is resolved against whatever the source is now. A source edit can renumber tokens (for example `C1A` becomes `C1B`), and a stored map then points at different content or fails. Locally, a person sees that happen. Once a cloud edit arrives through sync, nobody does.
3. **Song edits overwrite in place** (`UPDATE songs SET source_text`). Old versions are lost, so a draft made against revision 4 can't be compared with revision 4 later.
4. **There is no schema migration mechanism.** The store relies on `CREATE TABLE IF NOT EXISTS`, so adding a column breaks existing `~/.setflow` databases.
5. **Preparation and live logic are mixed together.**
   - `app.ts` registers library, live, MIDI and settings routes in one list.
   - `Library` throws `HttpError` instead of domain errors.
   - [control.ts](../packages/web/src/views/control.ts) is 651 lines and mixes library editing, setlists and conducting.

   A cloud build needs the preparation half without the live half.
6. **The shared protocol types live in the server package.** Web imports `@setflow/server/protocol`, and a cloud server shouldn't depend on the local-host package.
7. **There is no identity model.** `controllerId` is a random id kept in browser localStorage, and anyone on the LAN can take control. That is acceptable on the LAN, but the cloud needs users, organizations and permissions.
8. **Licensing conflicts with remote chart access.** `Provenance.storagePolicy: "organization-local"` and spec §25.1 keep licensed chart content on the local host unless provider terms allow cloud storage. Remote musician access, however, needs original ChordPro in the cloud. See [Open decisions](#open-decisions).
9. **"Join Live" can't run inside the cloud page.** An HTTPS page at `app.setflow.com` cannot reliably open `ws://192.168.x.x`; mixed-content rules and Chrome's Private Network Access block it. "Join Live" must be a top-level navigation to the local host.

---

## C. Target architecture

### Package layout

```text
packages/
├── core/        (existing) chordpro, sections, songmap, arrange, transpose, performance, session
│   └── + service package: build/validate a service snapshot (pure)
├── protocol/    (moved from server) API/WS types, shared by every deployment
├── server/      ONE server codebase, composed by mode
│   ├── library/     preparation service + Repository interface   ← both modes
│   ├── live/        LiveHost, ServiceSession, WS, MIDI           ← local only
│   ├── sync/        pull packages / push drafts                  ← local only (later)
│   ├── auth/        users, orgs, memberships                     ← cloud only (later)
│   ├── main-local.ts   SQLite, live on, LAN trust model
│   └── main-cloud.ts   cloud DB, live off, auth on
└── web/         ONE bundle; GET /api/host returns {mode, features}
    ├── #/library   prepare: songs, map editor, setlists    (cloud + local)
    ├── #/control   conduct                                  (local only)
    ├── #/stage     band display                             (local only)
    └── #/musician  charts; follows live when local, static when cloud
```

### Deployment

```text
         CLOUD (later)                                   LOCAL HOST (Pi / laptop / PC)
 ┌──────────────────────────┐                    ┌───────────────────────────────────────┐
 │ server (mode=cloud)      │   pull package     │ server (mode=local)                   │
 │  library + auth          │ ─────────────────► │  library (SQLite)                     │
 │  canonical revisions     │                    │  service_packages (pinned, immutable) │
 │  DB: songs, versions,    │ ◄───────────────── │  pending_changes (drafts + base rev)  │
 │  arrangements, setlists  │   push drafts      │  LiveHost / ServiceSession            │
 └──────────▲───────────────┘   (explicit)       │     ▲ commands         │ WS broadcast │
            │ HTTPS                              └─────┼──────────────────┼──────────────┘
   prep clients at home                     LAN only:  │                  ▼
   (#/library, #/musician read-only)        /control, clicker, MIDI   /stage, /musician
```

### Responsibilities

| Layer | Plan |
|---|---|
| Frontend / clients | One web bundle served by both deployments. Features are switched on from `/api/host`, not by separate builds. |
| Shared domain | `core` stays the home for all parsing, arranging and performance rules. New pure pieces go there so the cloud can run them too, for example service packages and turning live deviations into a song map. |
| Local server | Today's server. It keeps the live runtime and gains a service-level session and package storage. |
| Cloud backend | The same server code in cloud mode: library routes and auth/orgs, with no live routes and no MIDI. |
| Local persistence | SQLite. It adds versioned migrations, immutable `service_packages` and a `pending_changes` outbox. |
| Cloud persistence | The same logical tables plus organizations, users and memberships. Database choice: see [Open decisions](#open-decisions). |
| Realtime | LAN WebSocket only, with today's protocol. The cloud needs at most a "library changed" notification, and polling is fine at first. |
| Sync boundary | The **service package**. Cloud → local is a whole-package pull that is validated, then activated atomically. Local → cloud is explicit drafts carrying their base revision. |
| Performance state | `LiveHost` and `PerformanceState` exist only on the local host. The cloud never sees or routes commands. At most it later receives a read-only heartbeat to power a "Join Live" link. |

A service package contains a setlist plus, for each item:
- the exact song version (source text);
- the arrangement revision;
- the key;
- notes.

---

## D. Data model implications

Sections and occurrences are **derived, not stored**. The parser is deterministic: `sec-N` ids are stable for a given source text. So a pinned song version fully determines its sections, and the section ids used by JUMP are safe inside a pinned session.

| Concept | Representation | Change from today |
|---|---|---|
| Song | `{id (uuid), orgId?, title, currentRevision}` | Add `orgId` later |
| Song version | Immutable `{songId, revision, sourceText, provenance, createdAt, createdBy?}` | New: edits append a version instead of overwriting |
| Sections | Parsed from a song version, never persisted | None |
| Arrangement | `{id, songId, name, songMap, performanceKey, revision, basedOnSongRevision}` | Add `basedOnSongRevision`, so a map is always resolved against the version it was written for. A newer song revision prompts "re-check this map". |
| Arrangement occurrences | Derived by `applyArrangement`. Live insertions exist only in `PerformanceState.sequence`. | None |
| Setlist / service | `{id, name, date?, revision, items: [{itemId, songId, arrangementId, performanceKey?, notes?}]}` | Add `itemId` (the same song can appear twice) and `notes` |
| Local cached copy | `service_packages {id, setlistId, setlistRevision, source: "local"\|"cloud", preparedAt, payload JSON, active}`. Each item in the payload holds the full song text, map, key and the revisions it came from. | New. It is self-contained, so library edits, deleted songs or a lost cloud connection can't break it. |
| Revisions | Integers per entity. Once the cloud exists, it issues the canonical numbers and local edits never invent one. | Mostly in place |
| Pending changes | `pending_changes {id, entity, entityId, baseRevision, payload, createdAt, status}` | New (M4). Inert until sync exists. |
| Live session | `ServiceSession {serviceSessionId, packageId, itemIndex, controllerId}`, wrapping the existing per-song `PerformanceSession` | New, thin layer |
| Performance state | `PerformanceState` unchanged. Recovery also stores `packageId` and `itemIndex`. | Small |

### Temporary versus persistent rehearsal changes

- **Temporary** (for example, "Repeat Bridge") is a live command. It changes only `PerformanceState` and is lost when the song ends.
- **Persistent** (for example, "Bridge ×2 → ×4") happens only when the user explicitly chooses "Save to arrangement":
  1. Run-length-encode the effective `sequence` into `ArrangementItem[]`.
  2. Turn the items into map text with `formatSongMap`.
  3. Save the result as a new arrangement revision.
  4. If the host is offline, also record a `pending_changes` entry.

---

## E. Incremental migration plan

### M0 — Already done

The steps below already exist on the `backend` branch:
- domain extraction into core;
- client/server split;
- multiple independent clients;
- WebSocket performance state;
- local SQLite persistence and recovery;
- MIDI mapped to commands.

### M1 — Service package and service session (local only)

- **What changes:**
  - Core: a pure `ServicePackage` type with `buildServicePackage` and `validateServicePackage`.
  - Server: schema migrations via `PRAGMA user_version`, and a `service_packages` table.
  - Control: "Prepare for service" on a setlist, and previous/next-song controls.
  - `LiveHost` starts songs from the active package; recovery remembers the package and item.
- **Why:** It defines the offline/sync boundary and makes the setlist the unit of a service. It is useful today with no cloud.
- **Must keep working:**
  - starting any song directly, as today;
  - all commands, MIDI and recovery;
  - existing databases.
- **Test:**
  - Unit tests for build and validate; a stale map reports "not ready".
  - Server tests: editing or deleting a library song mid-service changes nothing on Stage; restarting and recovering mid-set works; an old database migrates.
  - A manual rehearsal run-through.
- **Branch:** `feature/service-package`

### M2 — Version-safe preparation data

- **What changes:**
  - immutable song versions;
  - `basedOnSongRevision` on arrangements;
  - `itemId` and `notes` on setlist items.
- **Why:** Sync needs to know which version an arrangement or draft was made against.
- **Must keep working:** the editor's 409 conflict check; restoring source order.
- **Test:**
  - An M1 database migrates.
  - An edit that renumbers sections flags the map instead of silently re-pointing it.
- **Branch:** `feature/song-versions`

### M3 — Split preparation from live

- **What changes:**
  - Server:
    - move `protocol` into its own package;
    - split `app.ts` into route modules;
    - `Library` uses domain errors behind a repository interface;
    - `/api/host` reports `mode` and features;
    - add `main-local.ts` plus a cloud-mode stub.
  - Web: split Control into `#/library` and `#/control`.
- **Why:** The cloud must reuse the library without the live runtime.
- **Must keep working:** every current route and view.
- **Test:**
  - Existing server tests pass unchanged.
  - A new test checks that cloud mode exposes no `/api/session` or `/ws`.
- **Branch:** `refactor/prep-live-split`

### M4 — Rehearsal edits

- **What changes:**
  - "Save live changes to arrangement";
  - editing an arrangement inside the active package, which applies the next time that song starts;
  - the `pending_changes` outbox.
- **Why:** It separates temporary performance changes from persistent arrangement changes.
- **Must keep working:** the running song is never mutated.
- **Test:** Repeat the Bridge live, then save. A new revision appears with ×4, and the plan of the running song is unchanged until restart.
- **Branch:** `feature/rehearsal-edits`

### M5 — Cloud preparation library

- **What changes:**
  - deploy cloud mode;
  - auth, organizations and memberships;
  - choose the cloud database;
  - preparation and read-only musician charts at home.
- **Why:** Remote preparation.
- **Gate:** the licensing decision in [Open decisions](#open-decisions).
- **Must keep working:** local mode stays fully standalone.
- **Test:** the same library tests run against the cloud repository, plus an auth test suite.
- **Branch:** `feature/cloud-library`

### M6 — Cloud → local sync

- **What changes:**
  - The local host pulls a service package, validates it, then activates it atomically.
  - The UI shows "Available Offline ✓ · Last synced 8:47 AM".
- **Why:** Prepared at home, performed offline.
- **Must keep working:** an interrupted pull leaves the previous package active.
- **Test:**
  - Cut the network mid-pull.
  - Unplug the WAN and run a full service.
  - Join from a fresh browser.
- **Branch:** `feature/sync-pull`

### M7 — Local → cloud drafts

- **What changes:** Pending changes are pushed. The cloud accepts a draft only if its base revision is current; otherwise it shows an explicit conflict.
- **Why:** Rehearsal edits reach the cloud.
- **Must keep working:** no silent last-write-wins.
- **Test:** editing the same arrangement in both places produces a conflict screen.
- **Branch:** `feature/sync-push`

### M8 — Joining and appliance polish

- **What changes:**
  - QR-code joining;
  - mDNS `setflow.local`;
  - a "Join Live" link from the cloud (a top-level navigation; see B9);
  - presentation-clicker mapping;
  - Raspberry Pi packaging.
- **Must keep working:** joining by IP address.
- **Test:** a matrix of real devices.
- **Branch:** one per item.

### Notes on ordering

- **M1 before M2.** M1 and M2 could swap, but packages copy source text, so M1 does not need version history yet.
- **Song navigation.** Service-level navigation (start item N, next song) should eventually go through the same command-envelope gateway, so a clicker or MIDI button can advance songs. In M1 it can be a controller-guarded endpoint, like key and cues are today.

---

## F. Recommended next step

**M1: service package and service session.** It is all local, with no cloud code.

### Why first

- It closes the biggest gap: there is no service unit, so "what to download for Sunday" isn't defined.
- It makes the sync boundary a real, testable format before any cloud exists.
- It gives rehearsals something useful now: running a whole set from one prepared, frozen snapshot.
- It mostly reuses existing code. `PinnedContent` already has the shape of one package item, so `LiveHost.start` gains a second source of content rather than a rewrite.

### Scope

- **Core:**
  - a pure `ServicePackage` type;
  - `buildServicePackage` and `validateServicePackage`.
- **Server:**
  - migration versioning and the `service_packages` table;
  - routes to prepare a package, read the active service and start an item.
- **Web:**
  - Control shows "Prepare for service / Ready ✓ · prepared at …" and previous/next-song controls;
  - Stage and Musician show "Song 2 of 5".

### Out of scope

- song versioning;
- auth;
- sync;
- splitting Control into separate views.

---

## Open decisions

1. **Licensing and cloud storage of charts (blocks M5).** The spec keeps licensed ChordPro on the local host unless provider terms permit cloud storage (§16.2, §25.1). Remote musician access to charts needs that content in the cloud. Options include:
   - the cloud holds only permitted content plus metadata, with charts fetched on the local host;
   - per-provider policy decides what is stored where;
   - organization-uploaded content that the organization itself is licensed to store.

   The `storagePolicy` field already exists, so this decision doesn't block M1–M4.
2. **Cloud database (decide at M5).**
   - Supabase/Postgres is the spec's candidate and comes with auth.
   - Firebase (Auth + Firestore) is a candidate: managed auth and client SDKs, but a document model, so versioned sync and conflict handling stay our responsibility.
   - The same SQLite store on one small server would keep a single database code path for the first cloud release.

   Either works if the library talks to a repository interface (M3).
