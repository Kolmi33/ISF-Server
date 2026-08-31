// Infinite scroll / week growth, and month-jump (Phase 7 slice B3). Faithful port of legacy's
// `prependWeek`, its `gridWrap` scroll/wheel listeners, `ensureOverflow`, and the month/year
// jump controls that stay in sync with the leftmost visible column while scrolling.
//
// Like B2 (`grid-interaction.ts`), this is a plain gated TypeScript module, not a React
// component — it manages real scroll position and a real DOM element's actual width, which
// React doesn't own or need to know about. A "pure `useGridScroll` hook" would still end up
// doing exactly this underneath; keeping it a plain module avoids pretending otherwise.

import {
  addDays,
  formatDateAsIsoString,
  mondayOfDate,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../core/dates.ts';
import { selection } from './grid-interaction.ts';

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
 *  every render fast. A drag in progress (B2) is exempt, so the anchor cell never scrolls
 *  out mid-selection. Faithful port of legacy `MAXW`. */
const MAX_GROWN_WEEKS = 12;

/** The hard ceiling on total extra weeks — reachable only by someone scrolling relentlessly
 *  or an automated test; growth (and `ensureOverflow`'s own growth loop) simply stops here. */
const ABSOLUTE_MAX_EXTRA_WEEKS = 150;

/** Whether growing the window (vs. shifting it) is still allowed right now. Faithful port of
 *  legacy's repeated `S.extraWeeks<MAXW || Sel.dragging` check. */
export function canStillGrowWindow(extraWeeks: number, isDragging: boolean): boolean {
  return extraWeeks < MAX_GROWN_WEEKS || isDragging;
}

/** Whether the scroll position is close enough to the right edge to need more content ahead.
 *  Faithful port of legacy's scroll-handler threshold (250px lookahead). */
export function isNearRightEdge(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): boolean {
  return scrollLeft + clientWidth > scrollWidth - 250;
}

/** Whether the scroll position is close enough to the left edge to need a week prepended.
 *  Faithful port of legacy's scroll-handler threshold (150px lookahead). */
export function isNearLeftEdge(scrollLeft: number): boolean {
  return scrollLeft < 150;
}

/** Whether a wheel/trackpad gesture is scrolling toward the left (a plain horizontal scroll,
 *  or a shift-modified vertical one — the common "shift+wheel = horizontal" convention).
 *  Faithful port of legacy's wheel-listener condition. */
export function isScrollingLeft(deltaX: number, deltaY: number, shiftKey: boolean): boolean {
  return deltaX < 0 || (shiftKey && deltaY < 0);
}

/** Whether the grid should grow another week to stay wider than the viewport (so there's
 *  always room to scroll right, which is what triggers further growth). Faithful port of
 *  legacy `ensureOverflow`'s condition (a 60px slack to absorb rounding). */
export function needsOverflowGrowth(
  extraWeeks: number,
  scrollWidth: number,
  clientWidth: number,
): boolean {
  return extraWeeks < 100 && scrollWidth <= clientWidth + 60;
}

/** One rendered week's pixel width: `daysPerWeek` day columns plus their borders, plus the
 *  gap column between weeks. Faithful port of legacy `weekWidth`'s formula (the `+1` per cell
 *  accounts for a shared border, the trailing `+9` for the gap column). */
export function computeWeekPixelWidth(cellWidth: number, daysInWeek: number): number {
  return (cellWidth + 1) * daysInWeek + 9;
}

/**
 * Which date column should drive the month/year jump controls while scrolling: the first
 * column (by its right edge) that extends past `leftEdge`, or the last column if none does
 * (fully scrolled to the end). Faithful port of legacy `updateJumpFromScroll`'s picking loop,
 * extracted as pure geometry so the DOM measurement (reading every `<th>`'s
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
 *  does its work, and clears it shortly after (legacy used two separate `setTimeout` delays —
 *  80ms after a prepend, 100ms after a scroll-triggered grow/shift — kept as-is). */
let extendPending = false;

/** The last time this module scrolled `#gridWrap` itself (`performance.now()`). The scroll
 *  handler ignores growth for 350ms after, so setting `scrollLeft` programmatically (a jump,
 *  a prepend's compensation) doesn't immediately re-trigger more growth — legacy's comment
 *  calls this out explicitly as the fix for a "snaps back" bug. */
let lastProgrammaticScrollAt = 0;

function gridWrapElement(): HTMLElement {
  return document.getElementById('gridWrap')!;
}

/** One week's pixel width, measured from an actual rendered cell (falling back to a plausible
 *  default before anything has rendered yet). Faithful port of legacy `weekWidth`. */
function measuredWeekWidth(): number {
  const cell = document.querySelector<HTMLElement>('td.cell');
  return cell ? computeWeekPixelWidth(cell.offsetWidth, daysPerWeek()) : 500;
}

/**
 * Prepend one week of history: moves `startMonday` back 7 days and, window-cap allowing, grows
 * `extraWeeks` (otherwise the window slides — see the scroll handler for the "already at the
 * cap" case, which shifts forward instead of growing). Compensates `scrollLeft` by however much
 * the grid actually grew, so the visible content doesn't jump. Faithful port of legacy
 * `prependWeek`; bridged as `window.prependWeek` for B2's drag-auto-scroll and arrow-key growth.
 */
export function prependWeek(): void {
  if (extendPending) return;
  extendPending = true;
  const wrap = gridWrapElement();
  const scrollLeftBefore = wrap.scrollLeft;
  const scrollWidthBefore = wrap.scrollWidth;
  window.S.startMonday = addDays(window.S.startMonday, -7);
  if (canStillGrowWindow(window.S.extraWeeks, selection.dragging)) window.S.extraWeeks++;
  window.notify();
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
  if (extendPending || window.S.extraWeeks >= ABSOLUTE_MAX_EXTRA_WEEKS) return;
  if (performance.now() - lastProgrammaticScrollAt < 350) return; // ignore our own recent scroll

  if (isNearRightEdge(wrap.scrollLeft, wrap.clientWidth, wrap.scrollWidth)) {
    extendPending = true;
    const scrollLeftBefore = wrap.scrollLeft;
    if (canStillGrowWindow(window.S.extraWeeks, selection.dragging)) {
      window.S.extraWeeks++;
      window.notify();
      wrap.scrollLeft = scrollLeftBefore;
    } else {
      window.S.startMonday = addDays(window.S.startMonday, 7);
      window.notify();
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
 *  catches the gesture that a `scroll` handler would otherwise miss. Faithful port of legacy's
 *  own comment and listener. */
function handleGridWrapWheel(event: WheelEvent): void {
  if (
    isScrollingLeft(event.deltaX, event.deltaY, event.shiftKey) &&
    gridWrapElement().scrollLeft <= 0
  ) {
    prependWeek();
  }
}

/**
 * Keep the grid wider than the viewport so there's always room to scroll right (which is what
 * triggers `handleGridWrapScroll`'s own growth). Faithful port of legacy `ensureOverflow`;
 * bridged as `window.ensureOverflow`, called from the React Grid's (B1) post-render effect.
 * Grows directly, bypassing the store, exactly as legacy's own comment calls out.
 */
export function ensureOverflow(): void {
  const wrap = gridWrapElement();
  if (wrap.style.display === 'none') return;
  if (needsOverflowGrowth(window.S.extraWeeks, wrap.scrollWidth, wrap.clientWidth)) {
    window.S.extraWeeks++;
    window.render();
  }
}

/** Scroll so `isoDate`'s column sits at the grid's visual center. Faithful port of legacy
 *  `centerCol`; bridged as `window.centerCol` for B2/B4's "jump to this date" features. */
export function centerColumn(isoDate: string): void {
  const cell = document.querySelector<HTMLElement>(`td.cell[data-date="${isoDate}"]`);
  const wrap = document.getElementById('gridWrap');
  if (!cell || !wrap) return;
  wrap.scrollLeft = Math.max(0, cell.offsetLeft - wrap.clientWidth / 2 + cell.offsetWidth / 2);
  lastProgrammaticScrollAt = performance.now();
}

/** Center on today, once the grid has actually painted (so the cell exists to measure).
 *  Faithful port of legacy `centerToday`. */
export function centerToday(): void {
  requestAnimationFrame(() => centerColumn(todayAsIsoDateString()));
}

function machineColumnWidth(): number {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--machw')) || 230;
}

/** Scroll so `isoDate`'s column sits at the grid's visual *start* (just right of the machine
 *  column) — used for the month-jump, which wants the 1st of the month leading the view rather
 *  than centered. Faithful port of legacy `gotoDate`. */
export function gotoDate(isoDate: string): void {
  requestAnimationFrame(() => {
    const cell = document.querySelector<HTMLElement>(`td.cell[data-date="${isoDate}"]`);
    const wrap = document.getElementById('gridWrap');
    if (!cell || !wrap) return;
    wrap.scrollLeft = Math.max(0, cell.offsetLeft - machineColumnWidth() - 10);
    lastProgrammaticScrollAt = performance.now();
  });
}

/** Reset the month/year jump controls to reflect the week block currently at the grid's start
 *  (its Wednesday, so e.g. a Monday-29th week still reads as the following month). Faithful
 *  port of legacy `syncJumpControls`; bridged as `window.syncJumpControls`, called from the
 *  React Grid's (B1) post-render effect. */
export function syncJumpControls(): void {
  const midWeek = addDays(window.S.startMonday, 3);
  const monthSelect = document.getElementById('jumpMonth') as HTMLSelectElement | null;
  const yearInput = document.getElementById('jumpYear') as HTMLInputElement | null;
  if (monthSelect) monthSelect.value = String(midWeek.getUTCMonth());
  if (yearInput) yearInput.value = String(midWeek.getUTCFullYear() % 100);
}

/** Re-sync the jump controls to whichever date column is now leftmost, while scrolling (does
 *  not itself trigger a jump — only updates the displayed values). Faithful port of legacy
 *  `updateJumpFromScroll`. */
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

/** rAF-throttle `updateJumpControlsFromScroll` — scroll fires far more often than once per
 *  frame. Faithful port of legacy `scheduleJumpSync`. */
function scheduleJumpControlsSync(): void {
  if (scheduledJumpControlsSync) return;
  scheduledJumpControlsSync = requestAnimationFrame(() => {
    scheduledJumpControlsSync = 0;
    updateJumpControlsFromScroll();
  });
}

/** Reset the grid to its base week window (used by "Heute" before re-centering, and by the
 *  still-legacy "jump to this result" actions in the assistant/stats/my-bookings views).
 *  Faithful port of legacy `resetView`. */
export function resetView(): void {
  window.S.extraWeeks = 0;
  gridWrapElement().scrollLeft = 0;
}

/** Jump to the 1st of whichever month/year the jump controls are set to. Faithful port of
 *  legacy `jumpToMonth` (a two-digit year like "26" means 2026; a four-digit one is taken
 *  as-is). Wired to both controls' `change` events. */
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
  window.S.startMonday = mondayOfDate(new Date(Date.UTC(year, month, 1)));
  const firstOfMonth = formatDateAsIsoString(window.S.startMonday);
  resetView();
  window.notify();
  prependWeek();
  gotoDate(firstOfMonth);
}

/**
 * Wire up the grid's scroll/wheel listeners, the month/year jump controls, and the Heute/◀/▶
 * toolbar buttons. Called once at boot (app.ts) — mirrors legacy's own top-level
 * `addEventListener`/`.onclick=` assignments, which also ran exactly once, at script-load time.
 */
export function initGridScroll(): void {
  const wrap = gridWrapElement();
  wrap.addEventListener('scroll', handleGridWrapScroll);
  wrap.addEventListener('wheel', handleGridWrapWheel, { passive: true });
  document.getElementById('jumpMonth')!.addEventListener('change', jumpToMonth);
  document.getElementById('jumpYear')!.addEventListener('change', jumpToMonth);
  document.getElementById('btnToday')!.addEventListener('click', () => {
    window.S.startMonday = mondayOfDate(new Date());
    resetView();
    window.notify();
    prependWeek();
    centerToday();
  });
  document.getElementById('btnPrev')!.addEventListener('click', () => {
    window.S.startMonday = addDays(window.S.startMonday, -7);
    window.notify();
  });
  document.getElementById('btnNext')!.addEventListener('click', () => {
    window.S.startMonday = addDays(window.S.startMonday, 7);
    window.notify();
  });
}
