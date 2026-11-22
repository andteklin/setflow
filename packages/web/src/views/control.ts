import { parseChordPro, parseSongMap, songMetadata, type ArrangementNote } from "@setflow/core";
import type {
  ArrangementView,
  HostInfo,
  ImportPreview,
  LiveStatus,
  SetlistItem,
  SetlistRecord,
  SongDetail,
  SongSummary,
} from "@setflow/server/protocol";
import { api, clientId } from "../api";
import { h, load, mount, save } from "../dom";
import { insertAt, isNoOpMove, moveTo, trackDrag } from "../drag";
import type { LiveClient } from "../live";
import { KEYS, livePanel, type StartTarget } from "./livePanel";
import { inputsPanel } from "./inputsPanel";
import { midiPanel } from "./midiPanel";
import { stageRenderer } from "./stageRenderer";

interface DraftItem {
  token: string;
  repetitions: number;
  /** This item's arrangement-only comments (issue #9); they move with the item. Their `item` index is set on save. */
  notes: ArrangementNote[];
}

const NEW_SONG_TEMPLATE = `{title: New Song}
{artist: }
{key: C}
{tempo: }
{time: 4/4}

{comment: Verse 1}
[C]Lyrics with [F]chords in [G]brackets

{comment: Chorus}
[F]Chorus [G]line
`;

/**
 * Control View (spec §20): library, import, Song Map editor, source editor,
 * setlists and the live conducting panel, in one browser window on the LAN.
 */
export function controlView(root: HTMLElement, live: LiveClient): () => void {
  document.body.dataset.view = "control";

  let songs: SongSummary[] = [];
  let setlists: SetlistRecord[] = [];
  let filter = "";
  let detail: SongDetail | null = null;
  let arrangementId: string | null = null;
  let draft: DraftItem[] = [];
  let draftKey = "";
  let mapDirty = false;
  let sourceDirty = false;
  /** Unsaved comment edits in the Arranged ChordPro tab (issue #9). */
  let arrangedDirty = false;
  let tab: "map" | "arranged" | "source" | "stage" = load("setflow.control.tab", "map");
  let setlistId: string | null = load("setflow.control.setlist", null);
  /** The setlist entry last clicked, whose arrangement and key can be changed in place (issue #6). */
  let editingItemId: string | null = null;
  let notice = "";
  const details = new Map<string, SongDetail>();

  const header = h("header", { class: "control-bar" });
  const sidebar = h("nav", { class: "library" });
  const center = h("section", { class: "song-panel" });
  const panel = livePanel(live, startTarget, () => {
    const s = currentSetlist();
    return s ? { setlistId: s.id, name: s.name, count: s.items.length } : null;
  });
  const midi = midiPanel(live);
  const inputs = inputsPanel(live);
  const stage = stageRenderer("chords");
  mount(root, header, h("div", { class: "control-grid" }, sidebar, center, h("aside", { class: "live-panel" }, panel.el, inputs.el, midi.el)));

  function arrangement(): ArrangementView | undefined {
    return detail?.arrangements.find((a) => a.id === arrangementId);
  }

  function startTarget(): StartTarget | null {
    const a = arrangement();
    if (!detail || !a) return null;
    return {
      songId: detail.song.id,
      songTitle: detail.song.title,
      arrangementId: a.id,
      arrangementName: mapDirty ? `${a.name} (saved version)` : a.name,
      performanceKey: draftKey || a.performanceKey || detail.metadata.originalKey || "",
      ready: a.items !== null,
    };
  }

  const fail = (err: unknown) => {
    notice = (err as Error).message;
    renderCenter();
  };

  // Loading

  async function loadLibrary() {
    [songs, setlists] = await Promise.all([api<SongSummary[]>("GET", "/api/songs"), api<SetlistRecord[]>("GET", "/api/setlists")]);
    if (setlistId && !setlists.some((s) => s.id === setlistId)) setlistId = null;
    await Promise.all(
      [...new Set(currentSetlist()?.items.map((i) => i.songId) ?? [])].map(async (id) => details.set(id, await api<SongDetail>("GET", `/api/songs/${id}`))),
    );
    renderSidebar();
    panel.refresh();
  }

  async function selectSong(id: string, preferArrangement?: string, preferKey?: string) {
    if ((mapDirty || sourceDirty || arrangedDirty) && !confirm("Discard unsaved changes to this song?")) return;
    arrangedDirty = false;
    detail = await api<SongDetail>("GET", `/api/songs/${id}`);
    details.set(id, detail);
    const pick = detail.arrangements.find((a) => a.id === preferArrangement) ?? detail.arrangements.find((a) => a.id === arrangementId) ?? detail.arrangements[0];
    selectArrangement(pick?.id ?? null, preferKey);
    sourceDirty = false;
    notice = "";
    renderSidebar();
    renderCenter();
  }

  function selectArrangement(id: string | null, preferKey?: string) {
    arrangementId = id;
    const a = arrangement();
    const tokens = new Map(detail?.sections.map((s) => [s.id, s.token]) ?? []);
    draft = a?.items?.map((i, index) => ({ token: tokens.get(i.sectionId) ?? "?", repetitions: i.repetitions, notes: a.notes.filter((n) => n.item === index) })) ?? [];
    draftKey = preferKey ?? a?.performanceKey ?? "";
    mapDirty = false;
    panel.refresh();
  }

  async function reloadSong() {
    if (!detail) return;
    detail = await api<SongDetail>("GET", `/api/songs/${detail.song.id}`);
    details.set(detail.song.id, detail);
    if (!detail.arrangements.some((a) => a.id === arrangementId)) selectArrangement(detail.arrangements[0]?.id ?? null);
    else if (!mapDirty) selectArrangement(arrangementId, draftKey);
    renderCenter();
  }

  // Header

  let hostInfo: HostInfo | null = null;
  let wasConnected = false;

  function renderHeader() {
    const { clients, connected } = live.current;
    if (connected && !wasConnected) {
      void api<HostInfo>("GET", "/api/host").then((info) => {
        hostInfo = info;
        renderHeader();
      });
    }
    wasConnected = connected;
    const count = (role: string) => clients.filter((c) => c.role === role).length;
    const lan = hostInfo?.urls.find((u) => !u.includes("localhost"));
    mount(
      header,
      h("strong", { class: "brand" }, "SETFLOW"),
      h("span", { class: live.current.connected ? "dot ok" : "dot bad" }, live.current.connected ? "Host connected" : "Host disconnected"),
      h("span", { class: "muted" }, `Stage ${count("stage")} · Musicians ${count("musician")} · Control ${count("control")}`),
      lan
        ? h("span", { class: "join" }, "Band devices join at ", h("code", null, lan), " → ", h("a", { href: `${lan}/#/stage`, target: "_blank" }, "Stage"), " · ", h("a", { href: `${lan}/#/musician`, target: "_blank" }, "Musician"))
        : h("span", { class: "muted" }, "Open ", h("a", { href: "#/stage", target: "_blank" }, "Stage"), " · ", h("a", { href: "#/musician", target: "_blank" }, "Musician")),
    );
  }

  // Sidebar: library and setlists

  function currentSetlist(): SetlistRecord | undefined {
    return setlists.find((s) => s.id === setlistId);
  }

  function renderSidebar() {
    const shown = songs.filter((s) => `${s.title} ${s.artist ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
    const search = h("input", {
      type: "search",
      placeholder: "Search songs",
      value: filter,
      oninput: () => {
        filter = search.value;
        mount(songList, renderSongItems(songs.filter((s) => `${s.title} ${s.artist ?? ""}`.toLowerCase().includes(filter.toLowerCase()))));
      },
    });
    const songList = h("ul", { class: "song-list" }, renderSongItems(shown));
    const setlist = currentSetlist();

    mount(
      sidebar,
      h("div", { class: "row spread" }, h("h2", null, "Library"), h("div", { class: "row" }, h("button", { onclick: () => openImport() }, "Import"), h("button", { onclick: () => openImport(NEW_SONG_TEMPLATE, "manual") }, "New"))),
      search,
      songList,
      h("div", { class: "row spread" }, h("h2", null, "Setlists"), h("button", { onclick: () => void newSetlist() }, "New")),
      setlists.length
        ? h(
            "select",
            {
              onchange: (e: Event) => {
                setlistId = (e.target as HTMLSelectElement).value || null;
                save("setflow.control.setlist", setlistId);
                void loadLibrary();
              },
            },
            h("option", { value: "" }, "Choose a setlist…"),
            setlists.map((s) => h("option", { value: s.id, selected: s.id === setlistId }, s.name)),
          )
        : h("p", { class: "muted" }, "No setlists yet."),
      setlist ? renderSetlist(setlist) : null,
    );
  }

  function renderSongItems(list: SongSummary[]) {
    if (list.length === 0) return h("li", { class: "muted" }, songs.length ? "No matches." : "Import a ChordPro chart to begin.");
    return list.map((s) =>
      h(
        "li",
        { class: s.id === detail?.song.id ? "selected" : "", onclick: () => { editingItemId = null; void selectSong(s.id).catch(fail); } },
        h("span", null, s.title),
        h("span", { class: "muted small" }, [s.originalKey, s.artist].filter(Boolean).join(" · ")),
      ),
    );
  }

  function renderSetlist(setlist: SetlistRecord) {
    // New entries have no itemId yet; the host assigns one.
    const saveItems = (items: Array<Omit<SetlistItem, "itemId"> & { itemId?: string }>) =>
      api("PUT", `/api/setlists/${setlist.id}`, { name: setlist.name, items }).then(loadLibrary).catch(fail);
    const updateItem = (i: number, patch: Partial<SetlistItem>) => {
      const items = setlist.items.map((item, j) => (j === i ? { ...item, ...patch } : item));
      if (!patch.performanceKey && "performanceKey" in patch) delete items[i].performanceKey;
      void saveItems(items).then(() => {
        // Show the change in the editor too, unless the MD has unsaved edits there.
        const item = items[i];
        if (detail?.song.id === item.songId && !mapDirty) {
          selectArrangement(item.arrangementId, item.performanceKey);
          renderCenter();
        }
      });
    };
    const move = (i: number, by: number) => void saveItems(moveTo(setlist.items, i, by < 0 ? i - 1 : i + 2));
    const target = startTarget();
    const list = h("ol");
    mount(
      list,
      setlist.items.map((item, i) => {
          const d = details.get(item.songId);
          const a = d?.arrangements.find((x) => x.id === item.arrangementId);
          const editing = item.itemId === editingItemId;
          const active = editing || (!editingItemId && item.songId === detail?.song.id && item.arrangementId === arrangementId);
          const row: HTMLElement = h(
            "li",
            {
              class: active ? "setlist-row selected" : "setlist-row",
              onpointerdown: (e: PointerEvent) => {
                if (!canStartRowDrag(e)) return;
                trackDrag(e, {
                  source: row,
                  list,
                  rowSelector: ".setlist-row",
                  onDrop: (to) => !isNoOpMove(i, to) && void saveItems(moveTo(setlist.items, i, to)),
                });
              },
            },
            h("span", { class: "grip", title: "Drag to move" }, "⋮⋮"),
            h(
              "button",
              {
                class: "link",
                onclick: () => {
                  editingItemId = item.itemId;
                  void selectSong(item.songId, item.arrangementId, item.performanceKey).catch(fail);
                },
              },
              h("span", null, d?.song.title ?? "…"),
              h("span", { class: "muted small" }, [a?.name, item.performanceKey && `Key ${item.performanceKey}`].filter(Boolean).join(" · ")),
            ),
            h(
              "span",
              { class: "row tight" },
              h("button", { class: "icon", title: "Move up", disabled: i === 0, onclick: () => move(i, -1) }, "↑"),
              h("button", { class: "icon", title: "Move down", disabled: i === setlist.items.length - 1, onclick: () => move(i, 1) }, "↓"),
              h("button", { class: "icon", title: "Remove", onclick: () => void saveItems(setlist.items.filter((_, j) => j !== i)) }, "×"),
            ),
            editing && d ? setlistItemEditor(item, d, (patch) => updateItem(i, patch)) : null,
          );
          return row;
        }),
    );
    return h(
      "div",
      { class: "setlist" },
      list,
      h(
        "div",
        { class: "row wrap" },
        h(
          "button",
          {
            disabled: !target,
            onclick: () =>
              target &&
              void saveItems([...setlist.items, { songId: target.songId, arrangementId: target.arrangementId, ...(draftKey && { performanceKey: draftKey }) }]),
          },
          "+ Add selected song",
        ),
        h("button", { onclick: () => { const name = prompt("Rename setlist", setlist.name); if (name) void api("PUT", `/api/setlists/${setlist.id}`, { name, items: setlist.items }).then(loadLibrary).catch(fail); } }, "Rename"),
        h("button", { class: "danger", onclick: () => confirm(`Delete setlist "${setlist.name}"?`) && void api("DELETE", `/api/setlists/${setlist.id}`).then(loadLibrary).catch(fail) }, "Delete"),
      ),
    );
  }

  async function newSetlist() {
    const name = prompt("Setlist name", "Sunday");
    if (!name) return;
    const created = await api<SetlistRecord>("POST", "/api/setlists", { name, items: [] }).catch(fail);
    if (!created) return;
    setlistId = created.id;
    save("setflow.control.setlist", setlistId);
    await loadLibrary();
  }

  function renderStageView(): HTMLElement {
    // Always render the latest authoritative snapshot.
    stage.render(live.current);
    return stage.el;
  }

  // Center: song detail, Song Map editor and source editor

  function renderCenter() {
    if (!detail) {
      mount(center, h("div", { class: "empty" }, h("h2", null, "No song selected"), h("p", null, "Choose a song from the library, or import a ChordPro chart."), h("button", { class: "primary", onclick: () => openImport() }, "Import a chart")));
      return;
    }
    const m = detail.metadata;
    mount(
      center,
      h(
        "div",
        { class: "song-head" },
        h("div", null, h("h1", null, detail.song.title), m.artist ? h("p", { class: "muted" }, m.artist) : null),
        h(
          "div",
          { class: "meta" },
          [m.originalKey && `Key ${m.originalKey}`, m.tempo && `${m.tempo} BPM`, m.timeSignature, m.ccliNumber && `CCLI ${m.ccliNumber}`]
            .filter(Boolean)
            .map((t) => h("span", { class: "chip" }, String(t))),
          h("button", { class: "danger small", onclick: () => void deleteSong() }, "Delete song"),
        ),
      ),
      notice ? h("div", { class: "banner error" }, notice, h("button", { class: "x", onclick: () => { notice = ""; renderCenter(); } }, "×")) : null,
      h(
        "div",
        { class: "tabs" },
        h("button", { class: tab === "map" ? "active" : "", onclick: () => setTab("map") }, "Song Map"),
        h("button", { class: tab === "stage" ? "active" : "", onclick: () => setTab("stage"), }, "Stage View"),
        h("button", { class: tab === "arranged" ? "active" : "", onclick: () => setTab("arranged") }, "Arranged ChordPro"),
        h("button", { class: tab === "source" ? "active" : "", onclick: () => setTab("source") }, "ChordPro source"),
      ),
      tab === "map"
      ? renderMapEditor()
      : tab === "arranged"
        ? renderArrangedEditor()
        : tab === "source"
          ? renderSourceEditor()
          : renderStageView(),
    );
  }

  function setTab(next: typeof tab) {
    if (tab === "arranged" && next !== tab && arrangedDirty) {
      if (!confirm("Discard unsaved comments in the arranged chart?")) return;
      arrangedDirty = false;
    }
    tab = next;
    save("setflow.control.tab", tab);
    renderCenter();
  }

  async function deleteSong() {
    if (!detail || !confirm(`Delete "${detail.song.title}" and its arrangements from this host?`)) return;
    await api("DELETE", `/api/songs/${detail.song.id}`).catch(fail);
    detail = null;
    arrangementId = null;
    mapDirty = sourceDirty = false;
    renderCenter();
    await loadLibrary();
    panel.refresh();
  }

  function renderMapEditor() {
    const d = detail!;
    const a = arrangement();
    const byToken = new Map(d.sections.map((s) => [s.token, s]));
    const editor = h("div", { class: "map-editor" });
    const mapText = () => draft.map((i) => (i.repetitions > 1 ? `${i.token}×${i.repetitions}` : i.token)).join(" → ");

    const touch = () => {
      mapDirty = true;
      drawEditor();
    };

    const textInput = h("input", { class: "map-text", spellcheck: false });
    const textError = h("span", { class: "error small" });
    textInput.addEventListener("change", () => {
      try {
        const parsed = parseChordPro(d.song.sourceText);
        const tokens = new Map(parsed.sections.map((s) => [s.id, s.token]));
        // Parsed locally with the same rules the host uses; the host validates again on save.
        draft = textInput.value.trim() ? parseSongMap(textInput.value, parsed).map((i) => ({ token: tokens.get(i.sectionId)!, repetitions: i.repetitions, notes: [] })) : [];
        textError.textContent = "";
        touch();
      } catch (err) {
        textError.textContent = (err as Error).message;
      }
    });

    const drawEditor = () => {
      textInput.value = mapText();
      // Pointer drag (issue #5): rows reorder, palette chips insert where dropped. Buttons stay the non-drag path.
      const rows = h("ol", { class: "map-rows" });
      const dragRow = (i: number, row: HTMLElement) => (e: PointerEvent) => {
        if (!canStartRowDrag(e)) return;
        trackDrag(e, {
          source: row,
          list: rows,
          rowSelector: ".map-row",
          onDrop: (to) => {
            if (isNoOpMove(i, to)) return;
            draft = moveTo(draft, i, to);
            touch();
          },
        });
      };
      const dragChip = (token: string) => (e: PointerEvent) =>
        trackDrag(e, {
          source: e.currentTarget as HTMLElement,
          list: rows,
          rowSelector: ".map-row",
          onDrop: (to) => {
            draft = insertAt(draft, to, { token, repetitions: 1, notes: [] });
            touch();
          },
        });
      mount(
        rows,
        draft.map((item, i) => {
          const section = byToken.get(item.token);
          const row: HTMLElement = h(
            "li",
            {
              class: `map-row type-${section?.type ?? "custom"}`,
              onpointerdown: (e: PointerEvent) => dragRow(i, row)(e),
            },
            h("span", { class: "grip", title: "Drag to move" }, "⋮⋮"),
            h("span", { class: "token" }, item.token),
            h("span", { class: "label" }, section?.sourceLabel ?? "Unknown section"),
            item.notes.length ? h("span", { class: "note-badge", title: item.notes.map((n) => n.text).join("\n") }, `✎ ${item.notes.length}`) : null,
            h(
              "span",
              { class: "reps" },
              h("button", { class: "icon", title: "Fewer repeats", disabled: item.repetitions <= 1, onclick: () => { item.repetitions--; touch(); } }, "−"),
              h("span", null, `×${item.repetitions}`),
              h("button", { class: "icon", title: "More repeats", onclick: () => { item.repetitions++; touch(); } }, "+"),
            ),
            h("button", { class: "icon", title: "Move up", disabled: i === 0, onclick: () => { draft = moveTo(draft, i, i - 1); touch(); } }, "↑"),
            h("button", { class: "icon", title: "Move down", disabled: i === draft.length - 1, onclick: () => { draft = moveTo(draft, i, i + 2); touch(); } }, "↓"),
            h("button", { class: "icon", title: "Duplicate", onclick: () => { draft.splice(i + 1, 0, { ...item, notes: [] }); touch(); } }, "⧉"),
            h("button", { class: "icon", title: "Remove", onclick: () => { draft.splice(i, 1); touch(); } }, "×"),
          );
          return row;
        }),
      );
      mount(
        editor,
        h("h4", null, "Available sections ", h("span", { class: "muted small" }, "click to add at the end, or drag into place")),
        h(
          "div",
          { class: "palette" },
          d.sections.map((s) =>
            h(
              "button",
              {
                class: `section-chip type-${s.type}`,
                title: s.sourceLabel,
                onpointerdown: dragChip(s.token),
                onclick: () => { draft.push({ token: s.token, repetitions: 1, notes: [] }); touch(); },
              },
              h("span", { class: "token" }, s.token),
              h("span", { class: "small" }, s.displayLabel),
            ),
          ),
        ),
        h("h4", null, "Arrangement ", h("span", { class: "muted small" }, "drag to reorder")),
        draft.length === 0 ? h("p", { class: "muted" }, "Empty — click or drag sections here.") : null,
        rows,
        h("label", { class: "stack" }, "Song map ", textInput, textError),
        h(
          "div",
          { class: "row" },
          h("button", { class: "primary", disabled: !mapDirty || !a, onclick: () => void saveMap() }, mapDirty ? "Save arrangement" : "Saved"),
          mapDirty ? h("button", { onclick: () => { selectArrangement(arrangementId, draftKey); renderCenter(); } }, "Revert") : null,
        ),
      );
      panel.refresh();
    };

    const keySelect = h(
      "select",
      {
        onchange: () => {
          draftKey = keySelect.value;
          mapDirty = true;
          drawEditor();
        },
      },
      h("option", { value: "" }, `Original${d.metadata.originalKey ? ` (${d.metadata.originalKey})` : ""}`),
      keyChoices(d.metadata.originalKey, draftKey).map((k) => h("option", { value: k, selected: k === draftKey }, k)),
    );

    const view = h(
      "div",
      null,
      h(
        "div",
        { class: "row wrap arrangement-bar" },
        h(
          "select",
          {
            onchange: (e: Event) => {
              if (mapDirty && !confirm("Discard unsaved changes to this arrangement?")) return void renderCenter();
              selectArrangement((e.target as HTMLSelectElement).value);
              renderCenter();
            },
          },
          d.arrangements.map((x) => h("option", { value: x.id, selected: x.id === arrangementId }, x.error ? `⚠ ${x.name}` : x.name)),
        ),
        h("button", { onclick: () => void newArrangement() }, "New"),
        h("button", { disabled: !a, onclick: () => a && void api<ArrangementView>("POST", `/api/arrangements/${a.id}/duplicate`, {}).then((x) => { arrangementId = x.id; return reloadSong(); }).catch(fail) }, "Duplicate"),
        h("button", { disabled: !a, onclick: () => { const name = a && prompt("Rename arrangement", a.name); if (a && name) void api("PUT", `/api/arrangements/${a.id}`, { name }).then(reloadSong).catch(fail); } }, "Rename"),
        h("button", { disabled: !a, onclick: () => a && confirm("Reset this arrangement to source order?") && void api("POST", `/api/arrangements/${a.id}/restore-source-order`).then(() => { mapDirty = false; return reloadSong(); }).catch(fail) }, "Restore source order"),
        h("button", { class: "danger", disabled: !a || d.arrangements.length < 2, onclick: () => a && confirm(`Delete arrangement "${a.name}"?`) && void api("DELETE", `/api/arrangements/${a.id}`).then(reloadSong).catch(fail) }, "Delete"),
        h("label", null, "Performance key ", keySelect),
      ),
      a?.error ? h("div", { class: "banner error" }, `This saved map no longer matches the song source: ${a.error}. Its text was “${a.songMap}”. Rebuild it below and save.`) : null,
      editor,
    );
    drawEditor();
    return view;
  }



  async function saveMap() {
    const a = arrangement();
    if (!a) return;
    const songMap = draft.map((i) => (i.repetitions > 1 ? `${i.token}*${i.repetitions}` : i.token)).join(", ");
    // Re-index each item's notes to its new position; a pass that no longer exists loses its notes.
    const notes = draft.flatMap((d, item) => d.notes.filter((n) => n.repetition < d.repetitions).map((n) => ({ ...n, item })));
    try {
      await api("PUT", `/api/arrangements/${a.id}`, { songMap, notes, performanceKey: draftKey || null, expectedRevision: a.revision });

      const hasActivePerformance =
        live.current.status?.state?.status !== undefined &&
        live.current.status.state.status !== "ended";

      mapDirty = false;
      await reloadSong();

      if (hasActivePerformance) {
        showArrangementSavedDialog();
      }

    } catch (err) {
      fail(err);
    }
  }

  function showArrangementSavedDialog() {
    const dialog = h("dialog", { class: "import" });

    const close = () => {
      dialog.close();
      dialog.remove();
    };

    const endPerformance = async () => {
      close();
      await panel.endPerformance();
    };

    const endAndRestart = async () => {
      close();

      // Check whether a performance is currently active.
      const state = live.current.status?.state;

      // If no performance is active, behave like End performance.
      if (!state || state.status === "ended") {
        await panel.endPerformance();
        return;
      }

      // End the current performance.
      await panel.endPerformance();

      // Start the updated arrangement.
      const target = startTarget();

      if (!target?.ready) return;

      await api<LiveStatus>("POST", "/api/session/start", {
        songId: target.songId,
        arrangementId: target.arrangementId,
        performanceKey: target.performanceKey || undefined,
        controllerId: clientId,
      })
        .then((status) => {
          live.refresh(status);
        })
        .catch(fail);
    };

    mount(
      dialog,
      h("h2", null, "Arrangement saved"),
      h(
        "p",
        null,
        "To broadcast the changes to connected musicians, end and restart the current performance.",
      ),
      h(
        "div",
        { class: "row wrap end" },
        h("button", { onclick: close }, "Close"),
        h(
          "button",
          { onclick: () => void endPerformance() },
          "End performance",
        ),
        h(
          "button",
          {
            class: "primary",
            onclick: () => void endAndRestart(),
          },
          "End and restart performance",
        ),
      ),
    );

    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  async function newArrangement() {
    if (!detail) return;
    const name = prompt("Arrangement name", "Sunday");
    if (!name) return;
    const created = await api<ArrangementView>("POST", `/api/songs/${detail.song.id}/arrangements`, { name, songMap: "" }).catch(fail);
    if (!created) return;
    arrangementId = created.id;
    mapDirty = false;
    await reloadSong();
  }

  function renderSourceEditor() {
    const d = detail!;
    const area = h("textarea", { class: "source", spellcheck: false, value: d.song.sourceText });
    const preview = h("div", { class: "source-preview" });
    const drawPreview = () => {
      const parsed = parseChordPro(area.value);
      const m = songMetadata(parsed);
      mount(
        preview,
        h("h4", null, "Detected"),
        h("p", null, h("strong", null, m.title || "(no title)"), m.originalKey ? ` · Key ${m.originalKey}` : ""),
        h("ol", { class: "detected" }, parsed.sections.map((s) => h("li", null, h("span", { class: "token" }, s.token), " ", s.sourceLabel, h("span", { class: "muted small" }, ` ${s.type}`)))),
        parsed.sections.length === 0 ? h("p", { class: "error" }, "No sections detected.") : null,
        h("p", { class: "muted small" }, "Sections start at {comment: Verse 1} style lines. Other comments stay with their section as notes. Start a line with # to hide it from the band (the MD still sees it). Rename a section here to correct its type."),
      );
    };
    let timer = 0;
    area.addEventListener("input", () => {
      sourceDirty = true;
      saveButton.disabled = false;
      clearTimeout(timer);
      timer = window.setTimeout(drawPreview, 250);
    });
    const saveButton = h(
      "button",
      {
        class: "primary",
        disabled: !sourceDirty,
        onclick: async () => {
          try {
            await api("PUT", `/api/songs/${d.song.id}`, { text: area.value, expectedRevision: d.song.revision });
            sourceDirty = false;
            await reloadSong();
            await loadLibrary();
          } catch (err) {
            fail(err);
          }
        },
      },
      "Save source",
    );
    drawPreview();
    return h(
      "div",
      { class: "source-editor" },
      h("div", { class: "stack grow" }, area, h("div", { class: "row" }, saveButton, h("span", { class: "muted small" }, `Revision ${d.song.revision} · imported via ${d.song.provenance.providerId}${d.song.provenance.fileName ? ` (${d.song.provenance.fileName})` : ""} · stored on this host only`))),
      preview,
    );
  }

  /**
   * The saved arrangement as one chronological ChordPro chart (issue #9).
   * The song's own comments carry through; comment lines added here belong
   * to this arrangement only. Chords and lyrics are edited in the source.
   */
  function renderArrangedEditor() {
    const a = arrangement();
    if (!a) return h("p", { class: "muted" }, "Choose an arrangement.");
    if (a.items === null) return h("div", { class: "banner error" }, `This arrangement no longer matches the song: ${a.error}. Fix it in the Song Map tab first.`);

    let revision = a.revision;
    const area = h("textarea", { class: "source", spellcheck: false, disabled: true, value: "Loading…" });
    const problem = h("div");
    const saved = h("span", { class: "muted small" });
    const saveButton = h("button", { class: "primary", disabled: true }, "Save comments");
    const fileName = `${detail!.song.title} - ${a.name}.cho`.replace(/[\\/:*?"<>|]/g, "_");

    void api<{ text: string; revision: number }>("GET", `/api/arrangements/${a.id}/chordpro`).then(
      (r) => {
        area.value = r.text;
        area.disabled = false;
        revision = r.revision;
      },
      (err: Error) => mount(problem, h("div", { class: "banner error" }, err.message)),
    );
    area.addEventListener("input", () => {
      arrangedDirty = true;
      saveButton.disabled = false;
      saved.textContent = "";
    });
    saveButton.addEventListener("click", async () => {
      try {
        await api("PUT", `/api/arrangements/${a.id}/chordpro`, { text: area.value, expectedRevision: revision });
        arrangedDirty = false;
        mount(problem);
        await reloadSong();
      } catch (err) {
        mount(problem, h("div", { class: "banner error" }, (err as Error).message));
      }
    });

    return h(
      "div",
      { class: "source-editor" },
      h(
        "div",
        { class: "stack grow" },
        mapDirty ? h("div", { class: "banner warn" }, "This shows the saved arrangement. Save or revert the Song Map first to see your changes here.") : null,
        problem,
        area,
        h(
          "div",
          { class: "row wrap" },
          saveButton,
          h("button", { onclick: () => void navigator.clipboard?.writeText(area.value).then(() => (saved.textContent = "Copied")) }, "Copy"),
          h("button", { onclick: () => download(fileName, area.value) }, "Download .cho"),
          saved,
        ),
      ),
      h(
        "div",
        { class: "source-preview" },
        h("h4", null, "Comments for this arrangement"),
        h("p", null, "Add comment lines anywhere inside a section. They show for this arrangement only; the song and its other arrangements are unchanged."),
        h("ul", { class: "small" }, h("li", null, h("code", null, "{ci: Drums out}"), " — shown to the band"), h("li", null, h("code", null, "# Watch the leader"), " — MD only, hidden from Stage and Musician")),
        h("p", { class: "muted small" }, "Comments already in the song source appear here too; change those, and chords or lyrics, in the ChordPro source tab. A comment stays with its section when you reorder the Song Map."),
      ),
    );
  }

  // Import dialog (spec §16–17)

  function openImport(initial = "", providerId: "file" | "paste" | "manual" = "paste") {
    let provider = providerId;
    let fileName: string | undefined;
    const dialog = h("dialog", { class: "import" });
    const area = h("textarea", { class: "source", spellcheck: false, placeholder: "Paste ChordPro here, or drop a .cho / .chordpro / .txt file", value: initial });
    const preview = h("div", { class: "import-preview" });
    const importButton = h("button", { class: "primary", disabled: true }, "Import song");

    const runPreview = async () => {
      if (!area.value.trim()) {
        mount(preview, h("p", { class: "muted" }, "Nothing to preview yet."));
        importButton.disabled = true;
        return;
      }
      try {
        const p = await api<ImportPreview>("POST", "/api/import/preview", { text: area.value });
        const m = p.metadata;
        mount(
          preview,
          h("h3", null, m.title || fileName || "Untitled"),
          m.artist ? h("p", { class: "muted" }, m.artist) : null,
          h("p", null, [m.originalKey && `Key: ${m.originalKey}`, m.tempo && `Tempo: ${m.tempo}`, m.timeSignature && `Time: ${m.timeSignature}`, m.ccliNumber && `CCLI: ${m.ccliNumber}`].filter(Boolean).join("   ")),
          h("h4", null, `Detected sections (${p.sections.length})`),
          h("ul", { class: "detected" }, p.sections.map((s) => h("li", null, "✓ ", h("span", { class: "token" }, s.token), " ", s.sourceLabel))),
          p.warnings.map((w) => h("p", { class: "warn" }, w)),
          h("p", { class: "muted small" }, "A Source Order arrangement is created automatically. The original text is kept unchanged."),
        );
        importButton.disabled = false;
      } catch (err) {
        mount(preview, h("p", { class: "error" }, (err as Error).message));
        importButton.disabled = true;
      }
    };

    let timer = 0;
    area.addEventListener("input", () => {
      if (provider === "file") provider = "paste";
      clearTimeout(timer);
      timer = window.setTimeout(runPreview, 250);
    });
    const readFile = async (file: File) => {
      area.value = await file.text();
      fileName = file.name;
      provider = "file";
      await runPreview();
    };
    area.addEventListener("dragover", (e) => e.preventDefault());
    area.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) void readFile(file);
    });
    const picker = h("input", { type: "file", accept: ".cho,.chordpro,.chopro,.crd,.pro,.txt,text/plain", onchange: () => picker.files?.[0] && void readFile(picker.files[0]) });

    importButton.addEventListener("click", async () => {
      try {
        const created = await api<SongDetail>("POST", "/api/songs", { text: area.value, providerId: provider, fileName });
        dialog.close();
        await loadLibrary();
        await selectSong(created.song.id);
      } catch (err) {
        mount(preview, h("p", { class: "error" }, (err as Error).message));
      }
    });

    mount(
      dialog,
      h("h2", null, providerId === "manual" ? "New song" : "Import song"),
      h("div", { class: "import-grid" }, h("div", { class: "stack" }, picker, area), preview),
      h("div", { class: "row end" }, h("button", { onclick: () => dialog.close() }, "Cancel"), importButton),
    );
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    void runPreview();
  }

  // Wiring

  const unsubscribeLibrary = live.onLibraryChange(() => {
    void loadLibrary();
    if (detail && !mapDirty && !sourceDirty && !arrangedDirty) void reloadSong().catch(() => { detail = null; renderCenter(); });
  });
  const unsubscribeLive = live.subscribe(() => {
    renderHeader();
    stage.render(live.current);
  });
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (mapDirty || sourceDirty || arrangedDirty) e.preventDefault();
  };
  window.addEventListener("beforeunload", beforeUnload);

  renderCenter();
  void loadLibrary().catch(fail);

  return () => {
    unsubscribeLibrary();
    unsubscribeLive();

    panel.dispose();
    midi.dispose();
    inputs.dispose();

    // Release the Stage renderer's resize listener and pending animation frame.
    stage.dispose();

    window.removeEventListener("beforeunload", beforeUnload);
  };
}

/** Save text as a file in the browser, e.g. an arranged .cho chart for another app. */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = h("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Whether a press on a row may start dragging it. A mouse can grab the row
 * anywhere; touch and pen must use the grip so a swipe still scrolls the page.
 * Presses on the row's own buttons and pickers are always left to them.
 */
function canStartRowDrag(e: PointerEvent): boolean {
  const target = e.target as HTMLElement;
  if (target.closest(".icon, select, input")) return false;
  return e.pointerType === "mouse" || target.closest(".grip") !== null;
}

/** Arrangement and key pickers for one setlist entry, shown under it once it is selected. */
function setlistItemEditor(item: SetlistItem, song: SongDetail, change: (patch: Partial<SetlistItem>) => void): HTMLElement {
  const arrangement = song.arrangements.find((a) => a.id === item.arrangementId);
  const defaultKey = arrangement?.performanceKey || song.metadata.originalKey;
  return h(
    "div",
    { class: "setlist-item-editor" },
    h(
      "label",
      null,
      "Arrangement ",
      h(
        "select",
        { onchange: (e: Event) => change({ arrangementId: (e.target as HTMLSelectElement).value }) },
        song.arrangements.map((a) => h("option", { value: a.id, selected: a.id === item.arrangementId, disabled: a.items === null }, a.items === null ? `⚠ ${a.name}` : a.name)),
      ),
    ),
    h(
      "label",
      null,
      "Key ",
      h(
        "select",
        { onchange: (e: Event) => change({ performanceKey: (e.target as HTMLSelectElement).value || undefined }) },
        h("option", { value: "", selected: !item.performanceKey }, `Arrangement's${defaultKey ? ` (${defaultKey})` : ""}`),
        keyChoices(song.metadata.originalKey, item.performanceKey ?? "").map((k) => h("option", { value: k, selected: k === item.performanceKey }, k)),
      ),
    ),
  );
}

function keyChoices(original: string | undefined, current: string): string[] {
  const minor = original?.endsWith("m") && !original.endsWith("maj");
  const keys = KEYS.map((k) => (minor ? `${k}m` : k));
  if (current && !keys.includes(current)) keys.unshift(current);
  return keys;
}
