// =======================================================================================
// TARGETED CELL PATCHING MODULE (web/js/ui/cell-patch.ts)
// =======================================================================================
//
// After a booking write or delete, only the affected cells are updated in the DOM instead
// of rebuilding the whole grid — a deliberate performance choice: rerendering hundreds of
// unaffected cells for a one- or two-cell change would be wasted work.
// This module:
// 1. Repaints one cell's class/background/title/text after its booking state changed.
// 2. Repaints one machine row's today-dot.
// 3. `patchCells`: does both for every cell an undo-entries list names, then restores
//    selection/focus marks the repaint wiped.
//
// Key Principles:
// - PLAIN MODULE, NOT REACT: reads and writes the exact DOM nodes the React Grid renders,
//   deliberately bypassing a React re-render for a handful of cells — the same reason
//   `ui/grid-interaction.ts` is a plain module rather than a component.
// - MERGE-AWARE, NOT JUST PER-CELL: a booked cell's segment (whether it shows its own name,
//   which edges merge into a same-booking neighbor, the "mine" accent) depends on its
//   NEIGHBORS, not just itself — recomputed fresh from `computeVisibleBookingBlocks` (once per
//   `patchCells` call, shared across every entry it touches), not left at whatever a PRIOR
//   full render happened to leave the DOM in. A real bug lived here: this file used to just
//   always show a booked cell's own name and never touch merge/mine styling at all, so any
//   write that went through this patch path (nearly all of them — see `mutate.ts`) could leave
//   a merged multi-day/multi-machine block's name back in every cell instead of just its one
//   center cell, most visibly after deleting then undoing a grouped booking.
//
// =======================================================================================

import {
  isMine,
  nameColor,
  cellClass,
  classifyCell,
  classifyDot,
  buildGridRows,
  visibleWeeks,
  computeVisibleBookingBlocks,
  mineAccentLayers,
  type BookingBlockSegment,
} from './grid.ts';
import { isDarkTheme } from './theme.ts';
import { getBooking } from '../core/bookings.ts';
import { maintText } from './machine-text.ts';
import {
  isMachineAvailableOnWeekday,
  isMachineBlockedOnDate,
  getMaintenanceSlotAtDate,
} from '../core/machines.ts';
import { isWeekend, parseIsoDateString, todayAsIsoDateString } from '../../../shared/dates.ts';
import { paintSelection } from './grid-interaction.ts';
import { daysPerWeek } from './grid-scroll.ts';
import { machById } from './machine-lookup.ts';
import { store } from '../store-instance.ts';

function findCellElement(machineId: string, date: string): HTMLElement | null {
  return document.querySelector(
    `td.cell[data-machine-id="${CSS.escape(machineId)}"][data-date="${date}"]`,
  );
}

/** The exact same recipe `Grid.tsx`'s own render uses (`computeGridViewModel`) to compute
 *  every visible cell's merge segment, fresh from the current store state — so a patched
 *  cell's showName/merge/mine styling always agrees with what a full re-render would produce.
 *  Computed once per `patchCells` call (not once per cell) and shared across every entry it
 *  touches, so patching several cells from one mutation doesn't redo this work per cell. */
function currentVisibleSegments(): Map<string, BookingBlockSegment> {
  const data = store.get('data')!;
  const columnsPerWeek = daysPerWeek();
  const weekCount = store.get('weeks') + store.get('extraWeeks');
  const weeks = visibleWeeks(store.get('startMonday'), weekCount, columnsPerWeek);
  const rows = buildGridRows(data.machines, {
    selectedGroups: store.get('groupsSel'),
    selectedMachineIds: store.get('machSel'),
    openCategories: store.get('cats'),
    collapsedGroups: store.get('collapsed'),
    favoriteIds: store.get('favs'),
  });
  return computeVisibleBookingBlocks(weeks, rows, data.bookings);
}

const MINE_ACCENT_PROPS = ['--mine-top', '--mine-bottom', '--mine-left', '--mine-right'] as const;

/** Sets (or, when not "mine", clears) the cell's four `--mine-*` box-shadow layer custom
 *  properties — via `setProperty`/`removeProperty`, not a plain `style.background`-style
 *  assignment, since these are CSS custom properties. Clearing them explicitly when not "mine"
 *  matters: without it, a cell that WAS a "mine" booking keeps its old accent values inline
 *  forever after becoming free/someone-else's-booking, since nothing else in this module ever
 *  touches those four properties again. */
function applyMineAccent(el: HTMLElement, mine: boolean, segment: BookingBlockSegment): void {
  const layers = mine ? mineAccentLayers(segment) : null;
  for (const prop of MINE_ACCENT_PROPS) {
    if (layers) el.style.setProperty(prop, layers[prop]!);
    else el.style.removeProperty(prop);
  }
}

const NO_SEGMENT: BookingBlockSegment = {
  continuesLeft: false,
  continuesRight: false,
  continuesUp: false,
  continuesDown: false,
  showName: true, // an isolated cell (no segment found) is its own whole block — always centered
};

/**
 * Updates one cell's class/background/title/text after its booking state changed
 * underneath it, without touching the rest of the grid.
 *
 * Every `cellClass` call below must pass `weekend` even though a weekend column is rarely
 * shown — omitting it once regressed a weekend cell's styling until the next full repaint,
 * since this patch path is the only place that recomputes the class from scratch.
 * `patchCells` repaints the selection/focus marks right after calling this, since the
 * `className` assignments below wipe whatever `.sel`/`.kfocus` classes were on the cell.
 */
export function refreshCell(
  machineId: string,
  date: string,
  segments: ReadonlyMap<string, BookingBlockSegment>,
): void {
  const el = findCellElement(machineId, date);
  if (!el) return; // e.g. a weekend column that isn't shown
  const machine = machById(machineId);
  if (!machine) return;
  const isToday = date === todayAsIsoDateString();
  const weekend = isWeekend(parseIsoDateString(date));
  const booking = getBooking(store.get('data')!.bookings, machineId, date);
  const state = classifyCell(
    isMachineBlockedOnDate(machine, date),
    booking,
    isMachineAvailableOnWeekday(machine, date),
  );
  if (state === 'blocked') {
    el.className = cellClass('blocked', { today: isToday, weekend });
    el.style.background = '';
    applyMineAccent(el, false, NO_SEGMENT);
    el.title = maintText(getMaintenanceSlotAtDate(machine, date));
    el.textContent = booking?.name ?? '';
  } else if (state === 'booked') {
    const segment = segments.get(`${machineId}|${date}`) ?? NO_SEGMENT;
    const mine = isMine(store.get('user'), booking!.name);
    el.className = cellClass('booked', {
      mine,
      today: isToday,
      weekend,
      mergeLeft: segment.continuesLeft,
      mergeRight: segment.continuesRight,
      mergeUp: segment.continuesUp,
      mergeDown: segment.continuesDown,
    });
    el.style.background = nameColor(booking!.name, isDarkTheme());
    applyMineAccent(el, mine, segment);
    el.title = booking!.name + (booking!.note ? ' — ' + booking!.note : '');
    el.textContent = segment.showName ? booking!.name : '';
  } else if (state === 'unavail') {
    el.className = cellClass('unavail', { today: isToday, weekend });
    el.style.background = '';
    applyMineAccent(el, false, NO_SEGMENT);
    el.title = 'an diesem Wochentag nicht verfügbar';
    el.textContent = '';
  } else {
    el.className = cellClass('free', { today: isToday, weekend });
    el.style.background = '';
    applyMineAccent(el, false, NO_SEGMENT);
    el.title = '';
    el.textContent = '';
  }
}

/** Updates one machine row's today-dot after its booking state changed. Only `.dot` is
 *  patched — the `.statdot` maintenance icon is static, and a row with an active
 *  maintenance slot has no `.dot` element at all, which is why this always calls
 *  `classifyDot(null, …)`: a blocked state can never actually arise here. */
export function refreshDot(machineId: string): void {
  const anyCellInRow = findCellElement(machineId, store.get('visD')[0] ?? '');
  if (!anyCellInRow) return;
  const row = anyCellInRow.closest('tr');
  if (!row) return;
  const dot = row.querySelector<HTMLElement>('.dot');
  if (!dot) return;
  const machine = machById(machineId);
  if (!machine) return;
  const today = todayAsIsoDateString();
  const todaysBooking = getBooking(store.get('data')!.bookings, machineId, today);
  const state = classifyDot(null, todaysBooking, isMachineAvailableOnWeekday(machine, today));
  if (state === 'busy') {
    dot.className = 'dot busy';
    dot.title = 'heute belegt: ' + todaysBooking!.name;
  } else if (state === 'unavail') {
    dot.className = 'dot unavail';
    dot.title = 'an diesem Wochentag nicht verfügbar';
  } else {
    dot.className = 'dot free';
    dot.title = 'heute frei';
  }
}

/** Patches every cell an undo-entries list names, refreshes their rows' today-dots, then
 *  restores the selection/focus marks (the classNames patched above just wiped them).
 *  Imported directly by `ui/mutate.ts`'s optimistic-apply path. Segments are computed once
 *  here (from the fully-applied post-mutation data) and shared across every entry, so
 *  patching several cells from one mutation — the common case for a multi-day/multi-machine
 *  write, delete, or undo — doesn't redo that computation once per cell. */
export function patchCells(entries: readonly { machineId: string; date: string }[]): void {
  const segments = currentVisibleSegments();
  const machineIds = new Set<string>();
  for (const entry of entries) {
    refreshCell(entry.machineId, entry.date, segments);
    machineIds.add(entry.machineId);
  }
  machineIds.forEach(refreshDot);
  paintSelection();
}
