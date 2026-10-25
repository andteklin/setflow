import { parseChordPro, parseSongMap, songMetadata } from "@setflow/core";
import type {
  ArrangementView,
  HostInfo,
  ImportPreview,
  SetlistItem,
  SetlistRecord,
  SongDetail,
  SongSummary,
} from "@setflow/server/protocol";
import { api } from "../api";
import { h, load, mount, save } from "../dom";
import type { LiveClient } from "../live";
import { KEYS, livePanel, type StartTarget } from "./livePanel";

interface DraftItem {
  token: string;
  repetitions: number;
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
  let tab: "map" | "source" = load("setflow.control.tab", "map");
  let setlistId: string | null = load("setflow.control.setlist", null);
  let notice = "";
  const details = new Map<string, SongDetail>();

  const header = h("header", { class: "control-bar" });
  const sidebar = h("nav", { class: "library" });
  const center = h("section", { class: "song-panel" });
  const panel = livePanel(live, startTarget);
  mount(root, header, h("div", { class: "control-grid" }, sidebar, center, panel.el));

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
  }

  async function selectSong(id: string, preferArrangement?: string, preferKey?: string) {
    if ((mapDirty || sourceDirty) && !confirm("Discard unsaved changes to this song?")) return;
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
    draft = a?.items?.map((i) => ({ token: tokens.get(i.sectionId) ?? "?", repetitions: i.repetitions })) ?? [];
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
        { class: s.id === detail?.song.id ? "selected" : "", onclick: () => void selectSong(s.id).catch(fail) },
        h("span", null, s.title),
        h("span", { class: "muted small" }, [s.originalKey, s.artist].filter(Boolean).join(" · ")),
      ),
    );
  }

  function renderSetlist(setlist: SetlistRecord) {
    const saveItems = (items: SetlistItem[]) =>
      api("PUT", `/api/setlists/${setlist.id}`, { name: setlist.name, items }).then(loadLibrary).catch(fail);
    const move = (i: number, by: number) => {
      const items = [...setlist.items];
      const [item] = items.splice(i, 1);
      items.splice(Math.max(0, Math.min(items.length, i + by)), 0, item);
      void saveItems(items);
    };
    const target = startTarget();
    return h(
      "div",
      { class: "setlist" },
      h(
        "ol",
        null,
        setlist.items.map((item, i) => {
          const d = details.get(item.songId);
          const a = d?.arrangements.find((x) => x.id === item.arrangementId);
          const active = item.songId === detail?.song.id && item.arrangementId === arrangementId;
          return h(
            "li",
            { class: active ? "selected" : "" },
            h(
              "button",
              { class: "link", onclick: () => void selectSong(item.songId, item.arrangementId, item.performanceKey).catch(fail) },
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
          );
        }),
      ),
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
        h("button", { class: tab === "source" ? "active" : "", onclick: () => setTab("source") }, "ChordPro source"),
      ),
      tab === "map" ? renderMapEditor() : renderSourceEditor(),
    );
  }

  function setTab(next: typeof tab) {
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
        draft = textInput.value.trim() ? parseSongMap(textInput.value, parsed).map((i) => ({ token: tokens.get(i.sectionId)!, repetitions: i.repetitions })) : [];
        textError.textContent = "";
        touch();
      } catch (err) {
        textError.textContent = (err as Error).message;
      }
    });

    let dragFrom = -1;
    const drawEditor = () => {
      textInput.value = mapText();
      mount(
        editor,
        h("h4", null, "Available sections ", h("span", { class: "muted small" }, "click to add")),
        h(
          "div",
          { class: "palette" },
          d.sections.map((s) =>
            h(
              "button",
              { class: `section-chip type-${s.type}`, title: s.sourceLabel, onclick: () => { draft.push({ token: s.token, repetitions: 1 }); touch(); } },
              h("span", { class: "token" }, s.token),
              h("span", { class: "small" }, s.displayLabel),
            ),
          ),
        ),
        h("h4", null, "Arrangement ", h("span", { class: "muted small" }, "drag to reorder")),
        draft.length === 0 ? h("p", { class: "muted" }, "Empty — add sections above.") : null,
        h(
          "ol",
          { class: "map-rows" },
          draft.map((item, i) => {
            const section = byToken.get(item.token);
            const row = h(
              "li",
              {
                class: `map-row type-${section?.type ?? "custom"}`,
                draggable: true,
                ondragstart: () => (dragFrom = i),
                ondragover: (e: DragEvent) => e.preventDefault(),
                ondrop: (e: DragEvent) => {
                  e.preventDefault();
                  if (dragFrom < 0 || dragFrom === i) return;
                  const [moved] = draft.splice(dragFrom, 1);
                  draft.splice(i, 0, moved);
                  dragFrom = -1;
                  touch();
                },
              },
              h("span", { class: "grip" }, "⋮⋮"),
              h("span", { class: "token" }, item.token),
              h("span", { class: "label" }, section?.sourceLabel ?? "Unknown section"),
              h(
                "span",
                { class: "reps" },
                h("button", { class: "icon", title: "Fewer repeats", disabled: item.repetitions <= 1, onclick: () => { item.repetitions--; touch(); } }, "−"),
                h("span", null, `×${item.repetitions}`),
                h("button", { class: "icon", title: "More repeats", onclick: () => { item.repetitions++; touch(); } }, "+"),
              ),
              h("button", { class: "icon", title: "Move up", disabled: i === 0, onclick: () => { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; touch(); } }, "↑"),
              h("button", { class: "icon", title: "Duplicate", onclick: () => { draft.splice(i + 1, 0, { ...item }); touch(); } }, "⧉"),
              h("button", { class: "icon", title: "Remove", onclick: () => { draft.splice(i, 1); touch(); } }, "×"),
            );
            return row;
          }),
        ),
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
    try {
      await api("PUT", `/api/arrangements/${a.id}`, { songMap, performanceKey: draftKey || null, expectedRevision: a.revision });
      mapDirty = false;
      await reloadSong();
    } catch (err) {
      fail(err);
    }
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
        h("p", { class: "muted small" }, "Sections start at {comment: Verse 1} style lines. Other comments stay with their section as notes. Rename a section here to correct its type."),
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
    if (detail && !mapDirty && !sourceDirty) void reloadSong().catch(() => { detail = null; renderCenter(); });
  });
  const unsubscribeLive = live.subscribe(renderHeader);
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (mapDirty || sourceDirty) e.preventDefault();
  };
  window.addEventListener("beforeunload", beforeUnload);

  renderCenter();
  void loadLibrary().catch(fail);

  return () => {
    unsubscribeLibrary();
    unsubscribeLive();
    panel.dispose();
    window.removeEventListener("beforeunload", beforeUnload);
  };
}

function keyChoices(original: string | undefined, current: string): string[] {
  const minor = original?.endsWith("m") && !original.endsWith("maj");
  const keys = KEYS.map((k) => (minor ? `${k}m` : k));
  if (current && !keys.includes(current)) keys.unshift(current);
  return keys;
}
