// Targeted cell patching (Phase 7 slice B4). After a booking write or delete, only the
// affected cells are updated in the DOM instead of rebuilding the whole grid — legacy's own
// comment calls this out as a deliberate performance choice ("GEZIELTES ZELL-PATCHING").
// `window.mutate`'s optimistic-apply path (still legacy) calls `patchCells` with the write's
// undo-entry list, which conveniently already names every cell that changed.
//
// A plain gated module, not a component, for the same reason ui/grid-interaction.ts (B2) is:
// this reads and writes the exact DOM nodes the React Grid (B1) renders, deliberately bypassing
// a React re-render for a handful of cells.

import { isMine, nameColor, cellClass, classifyCell, classifyDot } from './grid.ts';
import { getBooking } from '../core/booking-queries.ts';
import { maintText } from './machine-text.ts';
import { dayAvailable, isBlockedOnDate, maintenanceSlotAt } from '../core/machines-queries.ts';
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

/** Update one cell's class/background/title/text after its booking state changed underneath
 *  it, without touching the rest of the grid. Faithful port of legacy `refreshCell`, with one
 *  fix (not a behavior conservation — a real, pre-existing bug, tracked in `PROGRESS.md`'s
 *  Known Bugs and now closed): the patch path used to omit the `wknd` class the full render
 *  sets, so a weekend cell lost its weekend styling on the next targeted patch until the next
 *  full repaint. `patchCells` repaints `.sel`/`.kfocus` right after this, since the `className`
 *  assignments below wipe them. */
export function refreshCell(machineId: string, date: string): void {
  const el = findCellElement(machineId, date);
  if (!el) return; // e.g. a weekend column that isn't shown
  const machine = machById(machineId);
  if (!machine) return;
  const isToday = date === todayAsIsoDateString();
  const weekend = isWeekend(parseIsoDateString(date));
  const booking = getBooking(store.get('data')!.bookings, machineId, date);
  const state = classifyCell(isBlockedOnDate(machine, date), booking, dayAvailable(machine, date));
  if (state === 'blocked') {
    el.className = cellClass('blocked', { today: isToday, weekend });
    el.style.background = '';
    el.title = maintText(maintenanceSlotAt(machine, date));
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

/** Update one machine row's today-dot after its booking state changed. Faithful port of
 *  legacy `refreshDot` (the `.statdot` maintenance icon is static — only `.dot` is patched;
 *  a row with an active maintenance slot has no `.dot` element at all, matching legacy calling
 *  `classifyDot(null, …)` — a blocked state never arises here). */
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
  const state = classifyDot(null, todaysBooking, dayAvailable(machine, today));
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

/** Patch every cell an undo-entries list names, refresh their rows' today-dots, then restore
 *  the selection/focus marks (the classNames patched above just wiped them). Faithful port of
 *  legacy `patchCells`, imported directly by `ui/mutate.ts`'s optimistic-apply path. */
export function patchCells(entries: readonly { machineId: string; date: string }[]): void {
  const machineIds = new Set<string>();
  for (const entry of entries) {
    refreshCell(entry.machineId, entry.date);
    machineIds.add(entry.machineId);
  }
  machineIds.forEach(refreshDot);
  paintSelection();
}
