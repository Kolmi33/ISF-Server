// Grid selection & keyboard navigation (Phase 7 slice B2). Faithful port of legacy's `Sel`
// object and its mouse/keyboard event handlers.
//
// This is deliberately NOT a React component. `paintSel()`'s whole reason to exist — legacy's
// own comment calls it "GEZIELTES ZELL-PATCHING (Performance)" — is to update only the cells
// whose selection state actually changed, by toggling classes on the exact DOM nodes the React
// Grid (B1) already renders with a stable `data-mid`/`data-date` contract. Routing selection
// through React state would mean re-rendering the whole grid on every mouseover during a drag;
// this module instead reads/writes the DOM directly, exactly as legacy did, and stays a plain
// gated TypeScript module — the same shape `modal.tsx`'s document-level dismissal listeners
// already use alongside their React content.
//
// Everything genuinely part of selection/navigation is ported here. Booking actions the
// selection hands off to (opening the context menu, the single-cell booking action, the
// next-free jump) are each gated components/modules of their own, called via the `window.*`
// bridge (unlike `selection`/`paintSelection`/`clearSelection` themselves, which
// `ui/grid-scroll.ts` and `ui/components/Grid.tsx` import directly).

import { computeSelCells, clampIndex, type Cell } from './selection.ts';
import { categoryTap, categoryTapCancel, toggleAllGroupsInCategory } from './category-fold.ts';

/** The current selection: an anchor/focus pair spanning a rectangle, the cells it covers, and
 *  whether a drag is in progress. Faithful port of legacy's module-level `Sel` object. */
interface SelectionState {
  anchor: Cell | null;
  focus: Cell | null;
  cells: Cell[];
  dragging: boolean;
  /** True once a drag has actually moved to a different cell (vs. a plain click). */
  didDrag: boolean;
}

// `ui/grid-scroll.ts` (B3) and `ui/components/Grid.tsx` (B1) import this directly (both
// already gated) — they need the SAME object this module also mutates, not a copy.
export const selection: SelectionState = {
  anchor: null,
  focus: null,
  cells: [],
  dragging: false,
  didDrag: false,
};

/** The live grid cell for `mid`×`date`, or null if it isn't currently rendered (its week
 *  scrolled out, its machine filtered away). Faithful port of legacy `cellEl`. */
function findCellElement(mid: string, date: string): HTMLElement | null {
  return document.querySelector(`td.cell[data-mid="${CSS.escape(mid)}"][data-date="${date}"]`);
}

/** Repaint the selection: clears the previous `.sel`/`.kfocus` marks, recomputes the covered
 *  cells from the current anchor/focus against `window.S`'s visible rows/columns, and marks
 *  them. The focus cell also gets a roving `tabindex` so keyboard nav has somewhere to land.
 *  Faithful port of legacy `paintSel`. */
export function paintSelection(): void {
  document.querySelectorAll('td.cell.sel').forEach((el) => {
    el.classList.remove('sel');
    el.removeAttribute('aria-selected');
  });
  document.querySelectorAll('td.cell.kfocus').forEach((el) => {
    el.classList.remove('kfocus');
    el.removeAttribute('tabindex');
  });
  selection.cells = computeSelCells(
    selection.anchor,
    selection.focus,
    window.S.visM,
    window.S.visD,
  );
  for (const cell of selection.cells) {
    const el = findCellElement(cell.mid, cell.date);
    if (el) {
      el.classList.add('sel');
      el.setAttribute('aria-selected', 'true');
    }
  }
  if (selection.focus) {
    const el = findCellElement(selection.focus.mid, selection.focus.date);
    if (el) {
      el.classList.add('kfocus');
      el.setAttribute('tabindex', '0');
    }
  }
}

/** Clear the selection and hide the context menu. Faithful port of legacy `clearSel`. */
export function clearSelection(): void {
  selection.anchor = null;
  selection.focus = null;
  selection.cells = [];
  paintSelection();
  window.hideCtx();
}

// Note: legacy's `refreshCell`/`refreshDot`/`patchCells` (targeted DOM patching after a
// booking/delete, so a single write doesn't trigger a full grid re-render) are NOT ported
// here — their only caller is `mutate()`'s success path, which is still entirely legacy.
// They belong with whichever slice ports the booking form (B4), not this one.

// ---- Drag-to-select, with auto-scroll at the grid's edges ------------------------------

let dragPointer: { x: number; y: number } | null = null;
let dragScrollTimer: ReturnType<typeof setInterval> | null = null;

function startDragScroll(): void {
  if (dragScrollTimer) clearInterval(dragScrollTimer);
  dragScrollTimer = setInterval(dragAutoScroll, 60);
}

function stopDragScroll(): void {
  if (dragScrollTimer) clearInterval(dragScrollTimer);
  dragScrollTimer = null;
  dragPointer = null;
}

const DRAG_SCROLL_EDGE_PX = 45;

/** Scroll `wrap` horizontally if the drag pointer sits near its left/right edge; growing a new
 *  week on the left (via `prependWeek`) once there's nothing left to scroll to. Returns whether
 *  it scrolled or grew. */
function autoScrollHorizontally(
  wrap: HTMLElement,
  rect: DOMRect,
  machineColumnWidth: number,
): boolean {
  if (dragPointer!.x > rect.right - DRAG_SCROLL_EDGE_PX) {
    wrap.scrollLeft += 30;
    return true;
  }
  if (dragPointer!.x < rect.left + machineColumnWidth + DRAG_SCROLL_EDGE_PX) {
    if (wrap.scrollLeft <= 0) window.prependWeek();
    else wrap.scrollLeft -= 30;
    return true;
  }
  return false;
}

/** Scroll `wrap` vertically if the drag pointer sits near its top/bottom edge. */
function autoScrollVertically(wrap: HTMLElement, rect: DOMRect): boolean {
  if (dragPointer!.y > rect.bottom - DRAG_SCROLL_EDGE_PX) {
    wrap.scrollTop += 24;
    return true;
  }
  if (dragPointer!.y < rect.top + 60 && wrap.scrollTop > 0) {
    wrap.scrollTop -= 24;
    return true;
  }
  return false;
}

/** After an auto-scroll, the pointer itself hasn't moved but the cell underneath it has —
 *  re-derive the cell at the (clamped-inside-the-grid) pointer position and extend the drag
 *  to it if it's different from the current focus. */
function extendFocusToPointerAfterScroll(rect: DOMRect, machineColumnWidth: number): void {
  if (!selection.focus) return;
  const x = Math.min(Math.max(dragPointer!.x, rect.left + machineColumnWidth + 6), rect.right - 6);
  const y = Math.min(Math.max(dragPointer!.y, rect.top + 55), rect.bottom - 6);
  const cellUnderPointer = document.elementFromPoint(x, y)?.closest<HTMLElement>('td.cell');
  if (
    cellUnderPointer &&
    (cellUnderPointer.dataset.mid !== selection.focus.mid ||
      cellUnderPointer.dataset.date !== selection.focus.date)
  ) {
    selection.focus = { mid: cellUnderPointer.dataset.mid!, date: cellUnderPointer.dataset.date! };
    selection.didDrag = true;
    paintSelection();
  }
}

/** While dragging, scroll the grid when the pointer sits near an edge (and grow the grid — a
 *  new week on the left, via `prependWeek` — when the edge is also the grid's actual start),
 *  then re-derive the focus cell under the now-stationary pointer. Faithful port of legacy
 *  `dragAutoScroll`; a real-browser-only behavior (E5) — geometry this DOM-timing-dependent
 *  isn't meaningfully unit-testable in jsdom. */
function dragAutoScroll(): void {
  if (!selection.dragging || !dragPointer) return;
  const wrap = document.getElementById('gridWrap');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const machineColumnWidth =
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--machw')) || 230;
  const movedHorizontally = autoScrollHorizontally(wrap, rect, machineColumnWidth);
  const movedVertically = autoScrollVertically(wrap, rect);
  if (movedHorizontally || movedVertically)
    extendFocusToPointerAfterScroll(rect, machineColumnWidth);
}

function cellFromEvent(event: Event): HTMLElement | null {
  return (event.target as HTMLElement).closest('td.cell');
}

function handleGridMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  const cell = cellFromEvent(event);
  if (!cell) return;
  window.hideCtx();
  if (event.shiftKey && selection.anchor) {
    // Shift+click: span the selection from the existing anchor to this cell.
    selection.dragging = true;
    selection.didDrag = true;
    selection.focus = { mid: cell.dataset.mid!, date: cell.dataset.date! };
    paintSelection();
    event.preventDefault();
    startDragScroll();
    return;
  }
  selection.dragging = true;
  selection.didDrag = false;
  selection.anchor = { mid: cell.dataset.mid!, date: cell.dataset.date! };
  selection.focus = { ...selection.anchor };
  paintSelection();
  event.preventDefault(); // no text selection while dragging
  startDragScroll();
}

function handleGridMouseOver(event: MouseEvent): void {
  if (!selection.dragging || !selection.focus) return;
  const cell = cellFromEvent(event);
  if (!cell) return;
  if (cell.dataset.mid !== selection.focus.mid || cell.dataset.date !== selection.focus.date) {
    selection.focus = { mid: cell.dataset.mid!, date: cell.dataset.date! };
    selection.didDrag = true;
    paintSelection();
  }
}

function handleDocumentMouseUp(event: MouseEvent): void {
  if (!selection.dragging) return;
  selection.dragging = false;
  stopDragScroll();
  if (selection.didDrag && selection.cells.length > 1) window.showCtx(event.clientX, event.clientY);
}

/** Toggle one group's collapsed state and persist it (mirrors legacy's inline handler for a
 *  clicked group-header row that isn't a category header). */
function toggleGroupCollapse(group: string): void {
  if (window.S.collapsed.has(group)) window.S.collapsed.delete(group);
  else window.S.collapsed.add(group);
  localStorage.setItem('mb_collapsed', JSON.stringify([...window.S.collapsed]));
  window.notify();
}

function handleGridClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const favStar = target.closest<HTMLElement>('.favstar');
  if (favStar) {
    window.toggleFav(favStar.dataset.fav!);
    return;
  }
  const backButton = target.closest<HTMLElement>('[data-nb]');
  if (backButton) {
    window.gotoPrevFree(backButton.dataset.nb!);
    return;
  }
  const nextButton = target.closest<HTMLElement>('[data-nf]');
  if (nextButton) {
    window.gotoNextFree(nextButton.dataset.nf!);
    return;
  }
  const groupRow = target.closest<HTMLElement>('tr.grouprow');
  if (groupRow) {
    if (groupRow.dataset.catgroup) {
      categoryTap(groupRow.dataset.catgroup);
    } else if (groupRow.dataset.group) {
      toggleGroupCollapse(groupRow.dataset.group);
    }
    return;
  }
  if (selection.didDrag) {
    selection.didDrag = false; // this click ended a drag, not a plain click
    return;
  }
  // A plain click only selects the cell (handled by mousedown) — booking opens on double-click.
}

function handleGridDoubleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const groupRow = target.closest<HTMLElement>('tr.grouprow');
  if (groupRow?.dataset.catgroup) {
    categoryTapCancel();
    toggleAllGroupsInCategory(groupRow.dataset.catgroup);
    return;
  }
  const cell = cellFromEvent(event);
  if (!cell) return;
  window.openCellAction(cell.dataset.mid!, cell.dataset.date!);
}

// ---- Keyboard navigation: arrows move, Shift+arrows extend, Enter opens, Escape clears ---

const ARROW_DELTAS: Record<string, [rowDelta: number, colDelta: number]> = {
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
};

const MAX_EXTRA_WEEKS_FOR_GROWTH = 150;

/** Move the focus cell by one arrow-key step, growing the grid at either edge exactly as
 *  legacy did: past the right edge appends a week directly (bypassing the store, like
 *  `ensureOverflow`'s own direct `render()` call); past the left edge calls `prependWeek()`,
 *  which re-renders synchronously, so the column index is re-read afterward. */
function moveFocusByArrowKey(key: string, extendSelection: boolean): void {
  const [rowDelta, colDelta] = ARROW_DELTAS[key]!;
  if (!selection.focus) {
    selection.focus = { mid: window.S.visM[0]!, date: window.S.visD[0]! };
    selection.anchor = { ...selection.focus };
    return;
  }
  let row = window.S.visM.indexOf(selection.focus.mid) + rowDelta;
  let col = window.S.visD.indexOf(selection.focus.date) + colDelta;
  if (col >= window.S.visD.length && window.S.extraWeeks < MAX_EXTRA_WEEKS_FOR_GROWTH) {
    window.S.extraWeeks++;
    window.render();
  }
  if (col < 0 && window.S.extraWeeks < MAX_EXTRA_WEEKS_FOR_GROWTH) {
    window.prependWeek();
    col = window.S.visD.indexOf(selection.focus.date) + colDelta;
  }
  row = clampIndex(row, window.S.visM.length);
  col = clampIndex(col, window.S.visD.length);
  selection.focus = { mid: window.S.visM[row]!, date: window.S.visD[col]! };
  if (!extendSelection) selection.anchor = { ...selection.focus };
}

function handleArrowKey(key: string, extendSelection: boolean): void {
  if (!window.S.visM.length || !window.S.visD.length) return;
  moveFocusByArrowKey(key, extendSelection);
  paintSelection();
  findCellElement(selection.focus!.mid, selection.focus!.date)?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
  });
}

/** Enter opens the context menu for a multi-cell selection, or the single-cell booking action
 *  otherwise. Faithful port of legacy's `Enter` branch (`Sel.focus` is guaranteed by the caller). */
function handleEnterKey(): void {
  const focus = selection.focus!;
  if (selection.cells.length > 1) {
    const rect = findCellElement(focus.mid, focus.date)?.getBoundingClientRect();
    window.showCtx(rect?.right ?? 120, rect?.bottom ?? 120);
  } else {
    window.openCellAction(focus.mid, focus.date);
  }
}

function isTypingIntoAField(target: EventTarget | null): boolean {
  const tagName = (target as HTMLElement | null)?.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function handleDocumentKeyDown(event: KeyboardEvent): void {
  if (document.getElementById('overlay')?.classList.contains('open')) return;
  if (isTypingIntoAField(event.target)) return;

  if (ARROW_DELTAS[event.key]) {
    event.preventDefault();
    handleArrowKey(event.key, event.shiftKey);
  } else if (event.key === 'Enter' && selection.focus) {
    event.preventDefault();
    handleEnterKey();
  } else if (event.key === 'Escape') {
    clearSelection();
  }
}

/**
 * Wire up the grid's selection/keyboard-navigation listeners. Called once at boot (app.ts) —
 * mirrors legacy's top-level `gridEl.addEventListener(...)`/`document.addEventListener(...)`
 * calls, which also ran exactly once, at script-load time.
 */
export function initGridInteraction(): void {
  const gridElement = document.getElementById('grid')!;
  document.addEventListener('mousemove', (event) => {
    if (selection.dragging) dragPointer = { x: event.clientX, y: event.clientY };
  });
  gridElement.addEventListener('mousedown', handleGridMouseDown);
  gridElement.addEventListener('mouseover', handleGridMouseOver);
  document.addEventListener('mouseup', handleDocumentMouseUp);
  gridElement.addEventListener('click', handleGridClick);
  gridElement.addEventListener('dblclick', handleGridDoubleClick);
  document.addEventListener('keydown', handleDocumentKeyDown);
}
