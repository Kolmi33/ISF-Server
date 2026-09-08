// =======================================================================================
// GRID SELECTION & USER INTERACTION MODULE (web/js/ui/grid-interaction.ts)
// =======================================================================================
//
// Manages interactive mouse, drag, and keyboard gestures on the scheduling grid.
//
// Responsibilities:
// 1. Marquee Cell Selection: Coordinates click, drag-to-select, and Shift+click multi-cell ranges.
// 2. Targeted DOM Highlighting (`paintSelection`): Efficiently toggles `.sel` and `.kfocus` CSS classes
//    directly on selected table cells without triggering expensive React full-table re-renders.
// 3. Edge Auto-Scrolling: Smoothly scrolls horizontally and vertically when dragging near container borders.
// 4. Keyboard Navigation: Arrow keys move focus across cells, Shift+arrows expand selection bounds,
//    Enter opens booking modals or context menus, and Escape clears active selections.
//
// =======================================================================================

import { computeSelCells, clampIndex, type Cell } from './selection.ts';
import { categoryTap, categoryTapCancel, toggleAllGroupsInCategory } from './category-fold.ts';
import { store } from '../store-instance.ts';
import { triggerGridRender } from './grid-render-bridge.ts';

/** Handlers injected by app bootstrap to decouple grid interactions from modal controllers. */
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

/** Active grid selection state. */
interface SelectionState {
  anchor: Cell | null;
  focus: Cell | null;
  cells: Cell[];
  dragging: boolean;
  didDrag: boolean;
}

export const selection: SelectionState = {
  anchor: null,
  focus: null,
  cells: [],
  dragging: false,
  didDrag: false,
};

/**
 * Finds the DOM cell element corresponding to `machineId` and `date`.
 */
function findCellElement(machineId: string, date: string): HTMLElement | null {
  return document.querySelector(
    `td.cell[data-machine-id="${CSS.escape(machineId)}"][data-date="${date}"]`,
  );
}

/**
 * Updates visual selection classes (`.sel` and `.kfocus`) on DOM cells.
 */
const paintedSelection = new Map<string, HTMLElement>();
let paintedFocus: { key: string; element: HTMLElement } | null = null;

function cellKey(cell: Cell): string {
  return `${cell.machineId}\u0000${cell.date}`;
}

function paintSelectedCells(cells: readonly Cell[]): void {
  const nextPainted = new Map<string, HTMLElement>();
  for (const cell of cells) {
    const key = cellKey(cell);
    const cached = paintedSelection.get(key);
    const el = cached?.isConnected ? cached : findCellElement(cell.machineId, cell.date);
    if (el) {
      if (!el.classList.contains('sel')) el.classList.add('sel');
      if (el.getAttribute('aria-selected') !== 'true') el.setAttribute('aria-selected', 'true');
      nextPainted.set(key, el);
    }
  }
  for (const [key, el] of paintedSelection) {
    if (nextPainted.has(key) || !el.isConnected) continue;
    el.classList.remove('sel');
    el.removeAttribute('aria-selected');
  }
  paintedSelection.clear();
  for (const [key, el] of nextPainted) paintedSelection.set(key, el);
}

function paintFocusedCell(focus: Cell | null): void {
  const nextFocusKey = focus ? cellKey(focus) : null;
  if (paintedFocus && (paintedFocus.key !== nextFocusKey || !paintedFocus.element.isConnected)) {
    if (paintedFocus.element.isConnected) {
      paintedFocus.element.classList.remove('kfocus');
      paintedFocus.element.removeAttribute('tabindex');
    }
    paintedFocus = null;
  }
  if (focus) {
    const selectedElement = paintedSelection.get(nextFocusKey!);
    const el = selectedElement?.isConnected
      ? selectedElement
      : findCellElement(focus.machineId, focus.date);
    if (el) {
      if (!el.classList.contains('kfocus')) el.classList.add('kfocus');
      if (el.getAttribute('tabindex') !== '0') el.setAttribute('tabindex', '0');
      paintedFocus = { key: nextFocusKey!, element: el };
    }
  }
}

export function paintSelection(): void {
  selection.cells = computeSelCells(
    selection.anchor,
    selection.focus,
    store.get('visM'),
    store.get('visD'),
  );
  paintSelectedCells(selection.cells);
  paintFocusedCell(selection.focus);
}

/**
 * Clears the active selection rectangle and hides any open context menu.
 */
export function clearSelection(): void {
  selection.anchor = null;
  selection.focus = null;
  selection.cells = [];
  paintSelection();
  handlers!.hideCtx();
}

// ---------------- Drag-to-Select & Edge Auto-Scrolling ----------------

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

/**
 * Scrolls the grid horizontally if the mouse pointer is near the left or right edge.
 */
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

/**
 * Scrolls the grid vertically if the mouse pointer is near the top or bottom edge.
 */
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

/**
 * Re-derives the focused cell under the pointer after auto-scrolling shifts the viewport.
 */
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
 * Performs periodic edge auto-scroll while a drag selection is active.
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
  event.preventDefault();
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

/**
 * Toggles a group's collapsed state in the store and persists it to localStorage.
 */
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
    selection.didDrag = false;
    return;
  }
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

// ---------------- Keyboard Navigation Engine ----------------

const ARROW_DELTAS: Record<string, [rowDelta: number, colDelta: number]> = {
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
};

const MAX_EXTRA_WEEKS_FOR_GROWTH = 150;

/**
 * Moves the focused cell by arrow key delta, growing visible calendar weeks when reaching grid edges.
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
    store.state.extraWeeks++;
    triggerGridRender();
  }
  if (col < 0 && store.get('extraWeeks') < MAX_EXTRA_WEEKS_FOR_GROWTH) {
    handlers!.prependWeek();
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

/**
 * Handles Enter key presses to open booking modals or context menus on selected cells.
 */
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
 * Initializes DOM event listeners for mouse selection and keyboard navigation on the grid.
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
