// =======================================================================================
// GRID SELECTION & KEYBOARD NAVIGATION MODULE (web/js/ui/grid-interaction.ts)
// =======================================================================================
//
// Grid cell selection (click, shift+click, drag) and keyboard navigation.
// This module:
// 1. Owns the live `selection` state (anchor/focus/covered cells/drag flag).
// 2. Paints the selection by toggling DOM classes directly on the exact cells that changed.
// 3. Handles drag-to-select with auto-scroll at the grid's edges.
// 4. Handles keyboard navigation: arrows move, Shift+arrows extend, Enter opens, Escape clears.
//
// Key Principles:
// - TARGETED DOM PATCHING, NOT REACT STATE: `paintSelection`'s whole reason to exist is to
//   update only the cells whose selection state actually changed, by toggling classes on
//   the exact DOM nodes the React Grid already renders with a stable
//   `data-machine-id`/`data-date` contract. Routing selection through React state would
//   mean re-rendering the whole grid on every mouseover during a drag; this module instead
//   reads/writes the DOM directly and stays a plain gated module — the same shape
//   `modal.tsx`'s document-level dismissal listeners already use alongside React content.
// - HANDLERS ARE INJECTED, NOT IMPORTED: booking actions the selection hands off to
//   (opening the context menu, the single-cell booking action, the next-free jump, growing
//   the grid) are each gated components/modules of their own — but this module is a
//   dependency-graph "hub" several of them import FROM (`selection`/`paintSelection`/
//   `clearSelection`), so a direct import back into any of them would cycle.
//   `initGridInteraction` takes them as an injected `GridInteractionHandlers` struct
//   instead — `app.ts`, which already imports every module with no cycle risk of its own,
//   wires the real implementations in once at boot.
//
// =======================================================================================

import { computeSelCells, clampIndex, type Cell } from './selection.ts';
import { categoryTap, categoryTapCancel, toggleAllGroupsInCategory } from './category-fold.ts';
import { store } from '../store-instance.ts';
import { triggerGridRender } from './grid-render-bridge.ts';

/** Everything this module hands off to a higher-level component/module — injected once at
 *  boot (`initGridInteraction`) rather than imported directly, since each of these modules
 *  already imports something from this one (`selection`/`paintSelection`/`clearSelection`),
 *  which would make the reverse a real import cycle. */
export interface GridInteractionHandlers {
  showCtx: (x: number, y: number) => void;
  hideCtx: () => void;
  toggleFav: (machineId: string) => void;
  gotoPrevFree: (machineId: string) => void;
  gotoNextFree: (machineId: string) => void;
  openCellAction: (machineId: string, date: string) => void;
  prependWeek: () => void;
}

let handlers: GridInteractionHandlers | null = null;

/** The current selection: an anchor/focus pair spanning a rectangle, the cells it covers,
 *  and whether a drag is in progress. */
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

/** Finds the live grid cell for `machineId`×`date`, or null if it isn't currently rendered
 *  (its week scrolled out, its machine filtered away). */
function findCellElement(machineId: string, date: string): HTMLElement | null {
  return document.querySelector(
    `td.cell[data-machine-id="${CSS.escape(machineId)}"][data-date="${date}"]`,
  );
}

/**
 * Repaints the selection.
 *
 * How it works: clears the previous `.sel`/`.kfocus` marks, recomputes the covered cells
 * from the current anchor/focus against the store's visible rows/columns, and marks them.
 * The focus cell also gets a roving `tabindex` so keyboard navigation has somewhere to land.
 */
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
    store.get('visM'),
    store.get('visD'),
  );
  for (const cell of selection.cells) {
    const el = findCellElement(cell.machineId, cell.date);
    if (el) {
      el.classList.add('sel');
      el.setAttribute('aria-selected', 'true');
    }
  }
  if (selection.focus) {
    const el = findCellElement(selection.focus.machineId, selection.focus.date);
    if (el) {
      el.classList.add('kfocus');
      el.setAttribute('tabindex', '0');
    }
  }
}

/** Clears the selection and hides the context menu. */
export function clearSelection(): void {
  selection.anchor = null;
  selection.focus = null;
  selection.cells = [];
  paintSelection();
  handlers!.hideCtx();
}

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
    if (wrap.scrollLeft <= 0) handlers!.prependWeek();
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
    (cellUnderPointer.dataset.machineId !== selection.focus.machineId ||
      cellUnderPointer.dataset.date !== selection.focus.date)
  ) {
    selection.focus = {
      machineId: cellUnderPointer.dataset.machineId!,
      date: cellUnderPointer.dataset.date!,
    };
    selection.didDrag = true;
    paintSelection();
  }
}

/**
 * While dragging, scrolls the grid when the pointer sits near an edge (and grows the grid —
 * a new week on the left, via `prependWeek` — when the edge is also the grid's actual
 * start), then re-derives the focus cell under the now-stationary pointer.
 *
 * A real-browser-only behavior: geometry this DOM-timing-dependent isn't meaningfully
 * unit-testable in jsdom, so this function itself has no direct test — `autoScrollHorizontally`/
 * `autoScrollVertically` below carry the testable logic.
 */
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
  handlers!.hideCtx();
  if (event.shiftKey && selection.anchor) {
    // Shift+click: span the selection from the existing anchor to this cell.
    selection.dragging = true;
    selection.didDrag = true;
    selection.focus = { machineId: cell.dataset.machineId!, date: cell.dataset.date! };
    paintSelection();
    event.preventDefault();
    startDragScroll();
    return;
  }
  selection.dragging = true;
  selection.didDrag = false;
  selection.anchor = { machineId: cell.dataset.machineId!, date: cell.dataset.date! };
  selection.focus = { ...selection.anchor };
  paintSelection();
  event.preventDefault(); // no text selection while dragging
  startDragScroll();
}

function handleGridMouseOver(event: MouseEvent): void {
  if (!selection.dragging || !selection.focus) return;
  const cell = cellFromEvent(event);
  if (!cell) return;
  if (
    cell.dataset.machineId !== selection.focus.machineId ||
    cell.dataset.date !== selection.focus.date
  ) {
    selection.focus = { machineId: cell.dataset.machineId!, date: cell.dataset.date! };
    selection.didDrag = true;
    paintSelection();
  }
}

function handleDocumentMouseUp(event: MouseEvent): void {
  if (!selection.dragging) return;
  selection.dragging = false;
  stopDragScroll();
  if (selection.didDrag && selection.cells.length > 1)
    handlers!.showCtx(event.clientX, event.clientY);
}

/** Toggles one group's collapsed state and persists it — for a clicked group-header row
 *  that isn't a category header (those go through `categoryTap` instead). */
function toggleGroupCollapse(group: string): void {
  const collapsed = store.get('collapsed');
  if (collapsed.has(group)) collapsed.delete(group);
  else collapsed.add(group);
  localStorage.setItem('mb_collapsed', JSON.stringify([...collapsed]));
  store.notify();
}

function handleGridClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const favStar = target.closest<HTMLElement>('.favstar');
  if (favStar) {
    handlers!.toggleFav(favStar.dataset.fav!);
    return;
  }
  const backButton = target.closest<HTMLElement>('[data-nb]');
  if (backButton) {
    handlers!.gotoPrevFree(backButton.dataset.nb!);
    return;
  }
  const nextButton = target.closest<HTMLElement>('[data-nf]');
  if (nextButton) {
    handlers!.gotoNextFree(nextButton.dataset.nf!);
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
  handlers!.openCellAction(cell.dataset.machineId!, cell.dataset.date!);
}

// ---- Keyboard navigation: arrows move, Shift+arrows extend, Enter opens, Escape clears ---

const ARROW_DELTAS: Record<string, [rowDelta: number, colDelta: number]> = {
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
};

const MAX_EXTRA_WEEKS_FOR_GROWTH = 150;

/**
 * Moves the focus cell by one arrow-key step, growing the grid at either edge as needed:
 * past the right edge appends a week directly (bypassing the store, the same way
 * `ensureOverflow` does its own direct repaint); past the left edge calls `prependWeek()`,
 * which re-renders synchronously — the column index is re-read afterward since the
 * prepend may have replaced `visD` with a new array.
 */
function moveFocusByArrowKey(key: string, extendSelection: boolean): void {
  const [rowDelta, colDelta] = ARROW_DELTAS[key]!;
  if (!selection.focus) {
    selection.focus = { machineId: store.get('visM')[0]!, date: store.get('visD')[0]! };
    selection.anchor = { ...selection.focus };
    return;
  }
  let row = store.get('visM').indexOf(selection.focus.machineId) + rowDelta;
  let col = store.get('visD').indexOf(selection.focus.date) + colDelta;
  if (col >= store.get('visD').length && store.get('extraWeeks') < MAX_EXTRA_WEEKS_FOR_GROWTH) {
    // Direct field mutation, deliberately NOT store.set() — a store.set() here would notify
    // (→ the subscribed render()) AND the direct triggerGridRender() right below would run too,
    // double-rendering. Same bypass ensureOverflow's own direct render() call uses.
    store.state.extraWeeks++;
    triggerGridRender();
  }
  if (col < 0 && store.get('extraWeeks') < MAX_EXTRA_WEEKS_FOR_GROWTH) {
    handlers!.prependWeek();
    // prependWeek() re-renders synchronously and may replace visD with a new array
    // (a fresh week prepended) — re-read it now rather than reuse an earlier value.
    col = store.get('visD').indexOf(selection.focus.date) + colDelta;
  }
  row = clampIndex(row, store.get('visM').length);
  col = clampIndex(col, store.get('visD').length);
  selection.focus = { machineId: store.get('visM')[row]!, date: store.get('visD')[col]! };
  if (!extendSelection) selection.anchor = { ...selection.focus };
}

function handleArrowKey(key: string, extendSelection: boolean): void {
  if (!store.get('visM').length || !store.get('visD').length) return;
  moveFocusByArrowKey(key, extendSelection);
  paintSelection();
  findCellElement(selection.focus!.machineId, selection.focus!.date)?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
  });
}

/** Enter opens the context menu for a multi-cell selection, or the single-cell booking
 *  action otherwise (`selection.focus` is guaranteed set by the caller before this runs). */
function handleEnterKey(): void {
  const focus = selection.focus!;
  if (selection.cells.length > 1) {
    const rect = findCellElement(focus.machineId, focus.date)?.getBoundingClientRect();
    handlers!.showCtx(rect?.right ?? 120, rect?.bottom ?? 120);
  } else {
    handlers!.openCellAction(focus.machineId, focus.date);
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
 * Wires up the grid's selection/keyboard-navigation listeners, and registers
 * `injectedHandlers` for the higher-level actions this module hands off to (see
 * `GridInteractionHandlers` above). Called once at boot.
 */
export function initGridInteraction(injectedHandlers: GridInteractionHandlers): void {
  handlers = injectedHandlers;
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
