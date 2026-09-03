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
//
// =======================================================================================

import { isMine, nameColor, cellClass, classifyCell, classifyDot } from './grid.ts';
import { getBooking } from '../core/bookings.ts';
import { maintText } from './machine-text.ts';
import {
  isMachineAvailableOnWeekday,
  isMachineBlockedOnDate,
  getMaintenanceSlotAtDate,
} from '../core/machines.ts';
import { isWeekend, parseIsoDateString, todayAsIsoDateString } from '../../../shared/dates.ts';
import { paintSelection } from './grid-interaction.ts';
import { machById } from './machine-lookup.ts';
import { store } from '../store-instance.ts';

function findCellElement(machineId: string, date: string): HTMLElement | null {
  return document.querySelector(
    `td.cell[data-machine-id="${CSS.escape(machineId)}"][data-date="${date}"]`,
  );
}

function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

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
export function refreshCell(machineId: string, date: string): void {
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
    el.title = maintText(getMaintenanceSlotAtDate(machine, date));
    el.textContent = booking?.name ?? '';
  } else if (state === 'booked') {
    el.className = cellClass('booked', {
      mine: isMine(store.get('user'), booking!.name),
      today: isToday,
      weekend,
    });
    el.style.background = nameColor(booking!.name, isDarkTheme());
    el.title = booking!.name + (booking!.note ? ' — ' + booking!.note : '');
    el.textContent = booking!.name;
  } else if (state === 'unavail') {
    el.className = cellClass('unavail', { today: isToday, weekend });
    el.style.background = '';
    el.title = 'an diesem Wochentag nicht verfügbar';
    el.textContent = '';
  } else {
    el.className = cellClass('free', { today: isToday, weekend });
    el.style.background = '';
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
 *  Imported directly by `ui/mutate.ts`'s optimistic-apply path. */
export function patchCells(entries: readonly { machineId: string; date: string }[]): void {
  const machineIds = new Set<string>();
  for (const entry of entries) {
    refreshCell(entry.machineId, entry.date);
    machineIds.add(entry.machineId);
  }
  machineIds.forEach(refreshDot);
  paintSelection();
}
