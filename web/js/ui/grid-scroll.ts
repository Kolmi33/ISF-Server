// =======================================================================================
// GRID SCROLL MODULE (web/js/ui/grid-scroll.ts)
// =======================================================================================
//
// Infinite scroll / week growth, and the month-jump controls that stay in sync with the
// leftmost visible column while scrolling.
// This module:
// 1. Grows the grid's visible week window as the user scrolls toward either edge.
// 2. Keeps the grid always wider than the viewport, so there's perpetually room to scroll.
// 3. Drives the month/year jump controls, both ways: reading them to jump the grid, and
//    updating them to reflect wherever the grid has scrolled to.
//
// Key Principles:
// - PLAIN MODULE, NOT REACT: manages real scroll position and a real DOM element's actual
//   measured width, which React doesn't own or need to know about — a "pure `useGridScroll`
//   hook" would still end up doing exactly this underneath, so a plain module avoids
//   pretending otherwise.
//
// =======================================================================================

import {
  addDays,
  formatDateAsIsoString,
  mondayOfDate,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../shared/dates.ts';
import { selection } from './grid-interaction.ts';
import { store } from '../store-instance.ts';
import { triggerGridRender } from './grid-render-bridge.ts';

const DAYS_PER_WEEK_WITH_WEEKENDS = 7;
const DAYS_PER_WEEK_WITHOUT_WEEKENDS = 5;

/** Days shown per week: 7 (Mon–Sun) when the "Wochenenden anzeigen" setting is on, else 5.
 *  Shared with the React Grid (B1), which needs the same value to lay out its columns. */
export function daysPerWeek(): number {
  return localStorage.getItem('mb_weekends') === 'on'
    ? DAYS_PER_WEEK_WITH_WEEKENDS
    : DAYS_PER_WEEK_WITHOUT_WEEKENDS;
}

/** The grid's week-window cap: beyond this many extra weeks, scrolling further shifts the
 *  window (drops a week off the far side) instead of growing it, keeping the DOM small and
 *  every render fast. A drag in progress is exempt, so the anchor cell never scrolls out
 *  from under an in-progress selection. */
const MAX_GROWN_WEEKS = 6;

/** The hard ceiling on total extra weeks — reachable only by someone scrolling relentlessly
 *  or an automated test; growth (and `ensureOverflow`'s own growth loop) simply stops here. */
const ABSOLUTE_MAX_EXTRA_WEEKS = 150;

/** Whether growing the window (vs. shifting it) is still allowed right now: either there's
 *  still room under the cap, or a drag is in progress (which always gets to grow, cap or not). */
export function canStillGrowWindow(extraWeeks: number, isDragging: boolean): boolean {
  return extraWeeks < MAX_GROWN_WEEKS || isDragging;
}

/** Whether the scroll position is close enough to the right edge (250px lookahead) to need
 *  more content ahead. */
export function isNearRightEdge(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): boolean {
  return scrollLeft + clientWidth > scrollWidth - 250;
}

/** Whether the scroll position is close enough to the left edge (150px lookahead) to need a
 *  week prepended. */
export function isNearLeftEdge(scrollLeft: number): boolean {
  return scrollLeft < 150;
}

/** Whether a wheel/trackpad gesture is scrolling toward the left: a plain horizontal scroll,
 *  or a shift-modified vertical one — the common "shift+wheel = horizontal" convention. */
export function isScrollingLeft(deltaX: number, deltaY: number, shiftKey: boolean): boolean {
  return deltaX < 0 || (shiftKey && deltaY < 0);
}

/** Whether the grid should grow another week to stay wider than the viewport (so there's
 *  always room to scroll right, which is what triggers further growth) — a 60px slack
 *  absorbs sub-pixel rounding so this doesn't flip-flop right at the threshold. */
export function needsOverflowGrowth(
  extraWeeks: number,
  scrollWidth: number,
  clientWidth: number,
): boolean {
  return extraWeeks < 100 && scrollWidth <= clientWidth + 60;
}

/** Computes one rendered week's pixel width: `daysPerWeek` day columns plus their borders
 *  (the `+1` per cell), plus the gap column between weeks (the trailing `+9`). */
export function computeWeekPixelWidth(cellWidth: number, daysInWeek: number): number {
  return (cellWidth + 1) * daysInWeek + 9;
}

/**
 * Picks which date column should drive the month/year jump controls while scrolling: the
 * first column (by its right edge) that extends past `leftEdge`, or the last column if none
 * does (fully scrolled to the end).
 *
 * Extracted as pure geometry so the DOM measurement (reading every `<th>`'s
 * `getBoundingClientRect`) and this decision are two separate, separately testable steps.
 */
export function pickVisibleDateColumn(
  columns: readonly { rightEdge: number; date: string }[],
  leftEdge: number,
): string | null {
  const firstPastEdge = columns.find((column) => column.rightEdge > leftEdge);
  return firstPastEdge ? firstPastEdge.date : (columns[columns.length - 1]?.date ?? null);
}

// ---- DOM wiring -------------------------------------------------------------------------

/** Guards `prependWeek`/the scroll handler's own growth against re-entrancy: each sets this,
 *  does its work, and clears it shortly after (80ms after a prepend, 100ms after a
 *  scroll-triggered grow/shift — different delays for the two different DOM operations
 *  each is compensating for). */
let extendPending = false;

/** The last time this module scrolled `#gridWrap` itself (`performance.now()`). The scroll
 *  handler ignores growth for 350ms after, so setting `scrollLeft` programmatically (a jump,
 *  a prepend's compensation) doesn't immediately re-trigger more growth — the fix for a
 *  "scroll position snaps back" bug a programmatic scroll would otherwise cause. */
let lastProgrammaticScrollAt = 0;

function gridWrapElement(): HTMLElement {
  return document.getElementById('gridWrap')!;
}

/** One week's pixel width, measured from an actual rendered cell (falling back to a
 *  plausible default before anything has rendered yet). */
function measuredWeekWidth(): number {
  const cell = document.querySelector<HTMLElement>('td.cell');
  return cell ? computeWeekPixelWidth(cell.offsetWidth, daysPerWeek()) : 500;
}

/**
 * Prepends one week of history: moves `startMonday` back 7 days and, window-cap allowing,
 * grows `extraWeeks` (otherwise the window slides — see the scroll handler for the
 * "already at the cap" case, which shifts forward instead of growing). Compensates
 * `scrollLeft` by however much the grid actually grew, so the visible content doesn't jump.
 *
 * `grid-interaction.ts` calls this via its injected `GridInteractionHandlers` struct (for
 * drag-auto-scroll and arrow-key growth) rather than a direct import — a direct import
 * would cycle, since this module already imports `selection` from `grid-interaction.ts`.
 */
export function prependWeek(): void {
  if (extendPending) return;
  extendPending = true;
  const wrap = gridWrapElement();
  const scrollLeftBefore = wrap.scrollLeft;
  const scrollWidthBefore = wrap.scrollWidth;
  const grownExtraWeeks = canStillGrowWindow(store.get('extraWeeks'), selection.dragging)
    ? store.get('extraWeeks') + 1
    : store.get('extraWeeks');
  store.set({ startMonday: addDays(store.get('startMonday'), -7), extraWeeks: grownExtraWeeks });
  const grew = wrap.scrollWidth - scrollWidthBefore;
  wrap.scrollLeft = scrollLeftBefore + (grew > 0 ? grew : measuredWeekWidth());
  lastProgrammaticScrollAt = performance.now();
  setTimeout(() => {
    extendPending = false;
  }, 80);
}

function handleGridWrapScroll(): void {
  const wrap = gridWrapElement();
  scheduleJumpControlsSync();
  if (extendPending || store.get('extraWeeks') >= ABSOLUTE_MAX_EXTRA_WEEKS) return;
  if (performance.now() - lastProgrammaticScrollAt < 350) return; // ignore our own recent scroll

  if (isNearRightEdge(wrap.scrollLeft, wrap.clientWidth, wrap.scrollWidth)) {
    extendPending = true;
    const scrollLeftBefore = wrap.scrollLeft;
    if (canStillGrowWindow(store.get('extraWeeks'), selection.dragging)) {
      store.set({ extraWeeks: store.get('extraWeeks') + 1 });
      wrap.scrollLeft = scrollLeftBefore;
    } else {
      store.set({ startMonday: addDays(store.get('startMonday'), 7) });
      wrap.scrollLeft = Math.max(0, scrollLeftBefore - measuredWeekWidth());
    }
    setTimeout(() => {
      extendPending = false;
    }, 100);
  } else if (isNearLeftEdge(wrap.scrollLeft)) {
    prependWeek();
  }
}

/** At the absolute left edge, scrolling fires no `scroll` event at all — a `wheel` listener
 *  catches the gesture that a `scroll` handler would otherwise miss entirely. */
function handleGridWrapWheel(event: WheelEvent): void {
  if (
    isScrollingLeft(event.deltaX, event.deltaY, event.shiftKey) &&
    gridWrapElement().scrollLeft <= 0
  ) {
    prependWeek();
  }
}

/**
 * Keeps the grid wider than the viewport so there's always room to scroll right (which is
 * what triggers `handleGridWrapScroll`'s own growth) — imported directly by the React
 * Grid's post-render effect, so it runs after every paint.
 */
export function ensureOverflow(): void {
  const wrap = gridWrapElement();
  if (wrap.style.display === 'none') return;
  if (needsOverflowGrowth(store.get('extraWeeks'), wrap.scrollWidth, wrap.clientWidth)) {
    // Direct field mutation, deliberately NOT store.set(): this can fire on every post-render
    // effect, so notifying (and re-rendering) on every single growth here would fight with
    // the render that just finished; triggerGridRender() below repaints directly instead.
    store.state.extraWeeks++;
    triggerGridRender();
  }
}

/** Scrolls so `isoDate`'s column sits at the grid's visual center — imported directly by
 *  `favorite-jump.ts`'s "jump to this date". */
export function centerColumn(isoDate: string): void {
  const cell = document.querySelector<HTMLElement>(`td.cell[data-date="${isoDate}"]`);
  const wrap = document.getElementById('gridWrap');
  if (!cell || !wrap) return;
  wrap.scrollLeft = Math.max(0, cell.offsetLeft - wrap.clientWidth / 2 + cell.offsetWidth / 2);
  lastProgrammaticScrollAt = performance.now();
}

/** Centers on today, once the grid has actually painted (so the cell exists to measure). */
export function centerToday(): void {
  requestAnimationFrame(() => centerColumn(todayAsIsoDateString()));
}

function machineColumnWidth(): number {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--machw')) || 230;
}

/** Scrolls so `isoDate`'s column sits at the grid's visual *start* (just right of the
 *  machine column) — used for the month-jump, which wants the 1st of the month leading the
 *  view rather than centered. */
export function gotoDate(isoDate: string): void {
  requestAnimationFrame(() => {
    const cell = document.querySelector<HTMLElement>(`td.cell[data-date="${isoDate}"]`);
    const wrap = document.getElementById('gridWrap');
    if (!cell || !wrap) return;
    wrap.scrollLeft = Math.max(0, cell.offsetLeft - machineColumnWidth() - 10);
    lastProgrammaticScrollAt = performance.now();
  });
}

/** Resets the month/year jump controls to reflect the week block currently at the grid's
 *  start — reads its Wednesday, not its Monday, so e.g. a week starting Monday the 29th
 *  still reads as the following month once most of the visible week belongs to it. Imported
 *  directly by the React Grid's post-render effect. */
export function syncJumpControls(): void {
  const midWeek = addDays(store.get('startMonday'), 3);
  const monthSelect = document.getElementById('jumpMonth') as HTMLSelectElement | null;
  const yearInput = document.getElementById('jumpYear') as HTMLInputElement | null;
  if (monthSelect) monthSelect.value = String(midWeek.getUTCMonth());
  if (yearInput) yearInput.value = String(midWeek.getUTCFullYear() % 100);
}

/** Re-syncs the jump controls to whichever date column is now leftmost, while scrolling —
 *  does not itself trigger a jump, only updates the displayed month/year values to match. */
function updateJumpControlsFromScroll(): void {
  const wrap = document.getElementById('gridWrap');
  const headers = document.querySelectorAll<HTMLElement>('#grid thead th[data-date]');
  if (!wrap || !headers.length) return;
  const leftEdge = wrap.getBoundingClientRect().left + machineColumnWidth() + 2;
  const columns = [...headers].map((th) => ({
    rightEdge: th.getBoundingClientRect().right,
    date: th.dataset.date!,
  }));
  const pickedDate = pickVisibleDateColumn(columns, leftEdge);
  if (!pickedDate) return;
  const date = parseIsoDateString(pickedDate);
  const monthSelect = document.getElementById('jumpMonth') as HTMLSelectElement | null;
  const yearInput = document.getElementById('jumpYear') as HTMLInputElement | null;
  if (monthSelect) monthSelect.value = String(date.getUTCMonth());
  if (yearInput) yearInput.value = String(date.getUTCFullYear() % 100);
}

let scheduledJumpControlsSync = 0;

/** rAF-throttles `updateJumpControlsFromScroll` — a `scroll` event fires far more often than
 *  once per frame, and re-measuring every header's bounding rect on every single one would
 *  be wasted work between paints. */
function scheduleJumpControlsSync(): void {
  if (scheduledJumpControlsSync) return;
  scheduledJumpControlsSync = requestAnimationFrame(() => {
    scheduledJumpControlsSync = 0;
    updateJumpControlsFromScroll();
  });
}

/** Resets the grid to its base week window — used by "Heute" before re-centering, and by
 *  the "jump to this result" actions in the Assistant/All Bookings/My Bookings views before
 *  they scroll to a specific date. */
export function resetView(): void {
  store.state.extraWeeks = 0; // silent — every caller notifies once, after its own related writes
  gridWrapElement().scrollLeft = 0;
}

/** Jumps to the 1st of whichever month/year the jump controls are set to — a two-digit year
 *  like "26" means 2026; a four-digit one is taken as-is. Wired to both controls' `change`
 *  events. */
function jumpToMonth(): void {
  const yearInput = document.getElementById('jumpYear') as HTMLInputElement;
  const monthSelect = document.getElementById('jumpMonth') as HTMLSelectElement;
  const enteredYear = parseInt(yearInput.value);
  const year = isNaN(enteredYear)
    ? new Date().getFullYear()
    : enteredYear >= 1000
      ? enteredYear
      : 2000 + enteredYear;
  const month = parseInt(monthSelect.value) || 0;
  // Silent, like resetView below — one notify covers both writes, matching the original's
  // single window.notify() after both this assignment and resetView's own field reset.
  store.state.startMonday = mondayOfDate(new Date(Date.UTC(year, month, 1)));
  const firstOfMonth = formatDateAsIsoString(store.get('startMonday'));
  resetView();
  store.notify();
  prependWeek();
  gotoDate(firstOfMonth);
}

/**
 * Wires up the grid's scroll/wheel listeners, the month/year jump controls, and the
 * Heute/◀/▶ toolbar buttons. Called once at boot.
 */
export function initGridScroll(): void {
  const wrap = gridWrapElement();
  wrap.addEventListener('scroll', handleGridWrapScroll);
  wrap.addEventListener('wheel', handleGridWrapWheel, { passive: true });
  document.getElementById('jumpMonth')!.addEventListener('change', jumpToMonth);
  document.getElementById('jumpYear')!.addEventListener('change', jumpToMonth);
  document.getElementById('btnToday')!.addEventListener('click', () => {
    // Silent, like resetView below — one notify covers both writes.
    store.state.startMonday = mondayOfDate(new Date());
    resetView();
    store.notify();
    prependWeek();
    centerToday();
  });
  document.getElementById('btnPrev')!.addEventListener('click', () => {
    store.set({ startMonday: addDays(store.get('startMonday'), -7) });
  });
  document.getElementById('btnNext')!.addEventListener('click', () => {
    store.set({ startMonday: addDays(store.get('startMonday'), 7) });
  });
}
