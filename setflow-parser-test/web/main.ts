import {
  applyArrangement,
  formatSongMap,
  occurrenceLabel,
  parseChordPro,
  parseSongMap,
  serializeChordPro,
  sourceOrderArrangement,
  type ParsedSong,
} from "../src/arranger";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const source = $<HTMLTextAreaElement>("source");
const mapInput = $<HTMLInputElement>("map");
const output = $<HTMLTextAreaElement>("output");
const sectionsEl = $<HTMLDivElement>("sections");
const songInfo = $<HTMLParagraphElement>("song-info");
const errorEl = $<HTMLParagraphElement>("error");
const sequenceEl = $<HTMLOListElement>("sequence");
const copyButton = $<HTMLButtonElement>("copy");
const copyStatus = $<HTMLParagraphElement>("copy-status");

const COPY_HINT = "Paste this into the WorshipTools ChordPro editor.";
let currentTitle = "";

function directive(song: ParsedSong, name: string): string {
  const re = new RegExp(`^\\s*\\{\\s*${name}\\s*:\\s*(.*?)\\s*\\}\\s*$`, "i");
  for (const line of song.metadata) {
    const m = re.exec(line);
    if (m) return m[1];
  }
  return "";
}

// The last map used for each song title, so next week's arrangement starts from it.
function savedMap(title: string): string {
  try {
    return localStorage.getItem(`setflow:map:${title}`) ?? "";
  } catch {
    return "";
  }
}

function saveMap(title: string, map: string): void {
  try {
    localStorage.setItem(`setflow:map:${title}`, map);
  } catch {
    // Storage unavailable: remembering maps is only a convenience.
  }
}

function showError(message: string | null): void {
  errorEl.hidden = message === null;
  errorEl.textContent = message ?? "";
}

function renderSections(song: ParsedSong | null): void {
  sectionsEl.replaceChildren(
    ...(song?.sections ?? []).map((section) => {
      const button = document.createElement("button");
      button.type = "button";
      const id = document.createElement("b");
      id.textContent = section.token;
      button.append(id, section.sourceLabel);
      button.title = `Add ${section.sourceLabel} to the map`;
      button.addEventListener("click", () => {
        const map = mapInput.value.trim();
        mapInput.value = map ? `${map}, ${section.token}` : section.token;
        update();
      });
      return button;
    }),
  );
}

function update(): void {
  output.value = "";
  copyButton.disabled = true;
  copyStatus.textContent = COPY_HINT;
  sequenceEl.replaceChildren();
  showError(null);

  if (source.value.trim() === "") {
    songInfo.textContent = "No chart yet.";
    renderSections(null);
    return;
  }

  const song = parseChordPro(source.value);
  const title = directive(song, "title") || "Untitled";
  const key = directive(song, "key");
  songInfo.textContent = `${title}${key ? ` · Key ${key}` : ""} · ${song.sections.length} sections`;
  renderSections(song);

  if (title !== currentTitle) {
    currentTitle = title;
    mapInput.value = savedMap(title);
  }

  if (song.songMap !== undefined) {
    showError(
      `This chart was already arranged by SetFlow (${song.songMap}). ` +
        "Press Reset in WorshipTools to restore the original chart, then paste it again.",
    );
    return;
  }
  if (song.sections.length === 0) {
    showError("No sections found. Expected section markers like {comment: Verse 1}.");
    return;
  }

  try {
    const map = mapInput.value.trim();
    const items = map ? parseSongMap(map, song) : sourceOrderArrangement(song);
    const occurrences = applyArrangement(song, items);
    const byId = new Map(song.sections.map((s) => [s.id, s]));

    output.value = serializeChordPro(song, occurrences, { songMap: formatSongMap(song, items) });
    copyButton.disabled = false;
    sequenceEl.replaceChildren(
      ...occurrences.map((occ) => {
        const li = document.createElement("li");
        li.textContent = occurrenceLabel(byId.get(occ.sectionId)!, occ);
        return li;
      }),
    );
    if (map) saveMap(title, map);
  } catch (err) {
    showError((err as Error).message);
  }
}

source.addEventListener("input", update);
mapInput.addEventListener("input", update);

$<HTMLButtonElement>("paste").addEventListener("click", async () => {
  try {
    source.value = await navigator.clipboard.readText();
    update();
  } catch {
    source.focus();
    source.select();
    songInfo.textContent = "Browser blocked clipboard access. Click in the box and press Ctrl+V.";
  }
});

$<HTMLButtonElement>("undo").addEventListener("click", () => {
  mapInput.value = mapInput.value.replace(/\s*(?:,|->|→)?\s*[^,→]*$/, "");
  update();
});

$<HTMLButtonElement>("source-order").addEventListener("click", () => {
  const song = parseChordPro(source.value);
  mapInput.value = formatSongMap(song, sourceOrderArrangement(song)).replaceAll(" → ", ", ");
  update();
});

$<HTMLButtonElement>("clear").addEventListener("click", () => {
  mapInput.value = "";
  update();
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.value);
  } catch {
    output.select();
    document.execCommand("copy");
  }
  copyStatus.textContent = "Copied. Paste it into the WorshipTools ChordPro editor.";
});

update();
