/**
 * Pointer-based drag and drop for short vertical lists: the Song Map rows and
 * setlist entries (spec §12, §29; issue #5). One code path serves mouse,
 * touch and pen, unlike native HTML5 drag events, which most tablets and
 * phones never fire. Every drag has a button equivalent (move up/down, click
 * to add), so dragging is never the only way to reorder.
 *
 * The list positions are "insertion indexes": 0 is before the first row and
 * `rows.length` is after the last, so a drop always means "put it here".
 */

/** Where a pointer at `y` would insert, given each row's vertical midpoint in order. */
export function insertionIndex(midpoints: readonly number[], y: number): number {
  let index = 0;
  while (index < midpoints.length && y > midpoints[index]) index++;
  return index;
}

/** Move the item at `from` to an insertion index measured in the original list. */
export function moveTo<T>(list: readonly T[], from: number, insertion: number): T[] {
  const result = [...list];
  const [item] = result.splice(from, 1);
  result.splice(insertion > from ? insertion - 1 : insertion, 0, item);
  return result;
}

/** Insert a new item at an insertion index. */
export function insertAt<T>(list: readonly T[], insertion: number, item: T): T[] {
  const result = [...list];
  result.splice(Math.max(0, Math.min(result.length, insertion)), 0, item);
  return result;
}

/** True when dropping row `from` at `insertion` would leave it where it is. */
export function isNoOpMove(from: number, insertion: number): boolean {
  return insertion === from || insertion === from + 1;
}

export interface DragOptions {
  /** The element being dragged: a row of `list`, or something outside it (a palette chip). */
  source: HTMLElement;
  /** The list that receives the drop. */
  list: HTMLElement;
  /** Selector for the list's rows, in order. */
  rowSelector: string;
  /** Called with the insertion index when the item is dropped on the list. */
  onDrop: (insertion: number) => void;
}

/** Pointer travel before a press becomes a drag, so taps and clicks keep working. */
const DRAG_THRESHOLD_PX = 6;

/**
 * Begin tracking a press that may turn into a drag. Call from `pointerdown`.
 * Nothing changes until the pointer moves past a small threshold; a press
 * released before then stays an ordinary click.
 */
export function trackDrag(down: PointerEvent, options: DragOptions): void {
  if (down.button !== 0) return;
  const { source, list, rowSelector, onDrop } = options;
  const startX = down.clientX;
  const startY = down.clientY;
  let ghost: HTMLElement | null = null;
  let offsetX = 0;
  let offsetY = 0;
  let rows: HTMLElement[] = [];
  let insertion = -1;

  const begin = () => {
    const rect = source.getBoundingClientRect();
    offsetX = startX - rect.left;
    offsetY = startY - rect.top;
    ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.add("drag-ghost");
    ghost.style.width = `${rect.width}px`;
    document.body.append(ghost);
    source.classList.add("dragging");
    list.classList.add("drop-target");
    document.documentElement.classList.add("is-dragging");
    rows = [...list.querySelectorAll<HTMLElement>(rowSelector)];
  };

  const place = (x: number, y: number) => {
    ghost!.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px)`;
    const box = list.getBoundingClientRect();
    const inside = x >= box.left - 40 && x <= box.right + 40 && y >= box.top - 40 && y <= box.bottom + 40;
    const next = inside ? insertionIndex(rows.map((r) => midpoint(r)), y) : -1;
    if (next !== insertion) {
      insertion = next;
      showMarker(rows, insertion);
    }
    // Keep a long list reachable while dragging on a small screen.
    if (y < 48) window.scrollBy(0, -12);
    else if (y > window.innerHeight - 48) window.scrollBy(0, 12);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!ghost) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
      begin();
    }
    e.preventDefault();
    place(e.clientX, e.clientY);
  };

  const finish = (drop: boolean) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey);
    if (!ghost) return;
    ghost.remove();
    source.classList.remove("dragging");
    list.classList.remove("drop-target");
    document.documentElement.classList.remove("is-dragging");
    showMarker(rows, -1);
    // The release after a drag must not also click whatever is under the pointer.
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    if (drop && insertion >= 0) onDrop(insertion);
  };
  const onUp = (e: PointerEvent) => e.pointerId === down.pointerId && finish(true);
  const onCancel = (e: PointerEvent) => e.pointerId === down.pointerId && finish(false);
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish(false);

  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey);
}

function midpoint(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  return r.top + r.height / 2;
}

/** Draw the insertion line: above row `insertion`, or below the last row. -1 clears it. */
function showMarker(rows: readonly HTMLElement[], insertion: number): void {
  rows.forEach((row, i) => {
    row.classList.toggle("drop-before", i === insertion);
    row.classList.toggle("drop-after", i === rows.length - 1 && insertion === rows.length);
  });
}

function swallow(e: Event): void {
  e.stopPropagation();
  e.preventDefault();
}
