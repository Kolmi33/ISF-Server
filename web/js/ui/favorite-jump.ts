// Favorites + the next-/previous-free-day jump buttons in the grid's row header (Phase 7 slice
// B10a). Faithful port of legacy `toggleFav`/`nextFreePtr`/`gotoDateCenter`/`bookable`/
// `nextFreeAfter`/`prevFreeBefore`/`jumpToSlot`/`gotoNextFree`/`gotoPrevFree`. The day-scan core
// (`nextFreeDay`/`prevFreeDay`) already lives in `ui/navigation.ts` — this is the DOM/state
// wiring around it, called from `ui/grid-interaction.ts` (B2) via the window bridge.
//
// `displayGroup`, `FAVGRP`, and legacy's own `orderedMachines()` are NOT ported here: dead code
// — their only callers were `render()` and this section, both already superseded by
// `ui/grid.ts`'s `displayGroup`/`orderedMachines` (Phase 7 slice B1).

import type { Machine } from '../../../shared/types.ts';
import {
  addDays,
  formatDateLong,
  mondayOfDate,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../shared/dates.ts';
import { dayAvailable, isBlockedOnDate, maintenanceSlots } from '../core/machines.ts';
import { getBooking } from '../core/booking-queries.ts';
import { nextFreeDay, prevFreeDay, type FreeDay } from './navigation.ts';
import { centerColumn } from './grid-scroll.ts';
import { selection, paintSelection } from './grid-interaction.ts';
import { toast } from './toast.ts';
import { store } from '../store-instance.ts';

/** Toggle machine `mid`'s favorite status, persist, and repaint. Faithful port of legacy
 *  `toggleFav`. */
export function toggleFav(mid: string): void {
  const favs = store.get('favs');
  if (favs.has(mid)) favs.delete(mid);
  else favs.add(mid);
  localStorage.setItem('mb_favs', JSON.stringify([...favs]));
  store.notify();
}

/** mid → the last free day jumped to (reset for every OTHER machine on each new jump). Exposed
 *  on `window` (via the module bridge) so the React Grid (B1) can read it for the row header's
 *  "back" button. */
export const nextFreePtr: Record<string, string> = {};

function centerOnDate(isoDate: string): void {
  requestAnimationFrame(() => centerColumn(isoDate)); // instant, centered — no snap-back
}

/** Is `machine` bookable on `isoDate`: not booked, not blocked, and available that weekday. */
function isFreeFor(machine: Machine): FreeDay {
  return (isoDate) =>
    !getBooking(store.get('data')!.bookings, machine.id, isoDate) &&
    !isBlockedOnDate(machine, isoDate) &&
    dayAvailable(machine, isoDate);
}

/** The next free working day for `machine` strictly after `fromIso` (or from today when null).
 *  Faithful port of legacy `nextFreeAfter`. */
export function nextFreeAfter(machine: Machine, fromIso: string | null): string | null {
  return nextFreeDay(fromIso, todayAsIsoDateString(), isFreeFor(machine));
}

/** The previous free working day for `machine` before `fromIso`, not earlier than today.
 *  Faithful port of legacy `prevFreeBefore`. */
export function prevFreeBefore(machine: Machine, fromIso: string): string | null {
  return prevFreeDay(fromIso, todayAsIsoDateString(), isFreeFor(machine));
}

/**
 * Jump the grid to `isoDate` for `machine`: rebuild the visible window centered on it (2 weeks
 * before, 4 after), select the cell, and toast — flagging when nothing is booked/blocked past
 * this point ("dauerhaft frei"). Faithful port of legacy `jumpToSlot`.
 */
function jumpToSlot(machine: Machine, isoDate: string, isBack: boolean): void {
  store.set({
    startMonday: addDays(mondayOfDate(parseIsoDateString(isoDate)), -14),
    extraWeeks: 4,
  });
  document.getElementById('gridWrap')!.scrollLeft = 0;
  selection.anchor = { mid: machine.id, date: isoDate };
  selection.focus = { mid: machine.id, date: isoDate };
  paintSelection();
  centerOnDate(isoDate);

  const machineBookings = store.get('data')!.bookings[machine.id] || {};
  const today = todayAsIsoDateString();
  const lastBookedDate =
    Object.keys(machineBookings)
      .filter((date) => date >= today)
      .sort()
      .pop() || '';
  const slots = maintenanceSlots(machine);
  const lastBlockedDate = slots.length
    ? slots.some((slot) => !slot.until)
      ? '9999-12-31'
      : slots
          .map((slot) => slot.until)
          .sort()
          .pop()!
    : '';
  const isPermanentlyFree =
    isoDate > (lastBookedDate > lastBlockedDate ? lastBookedDate : lastBlockedDate);
  const hint = isPermanentlyFree ? ' (ab hier dauerhaft frei)' : '';
  toast(
    `${machine.name}: ${isBack ? 'zurück zu' : 'freier Termin'} ${formatDateLong(isoDate)}${hint}`,
  );
}

/**
 * Jump forward to machine `mid`'s next free working day (relative to the last jump).
 * Switching machines resets every other machine's pointer. Faithful port of legacy
 * `gotoNextFree`.
 */
export function gotoNextFree(mid: string): void {
  const machine = window.machById(mid);
  if (!machine) return;
  for (const key of Object.keys(nextFreePtr)) {
    if (key !== mid) delete nextFreePtr[key];
  }
  const found = nextFreeAfter(machine, nextFreePtr[mid] || null);
  if (!found) {
    toast(`${machine.name}: kein freier Termin in den nächsten 2 Jahren gefunden.`);
    return;
  }
  nextFreePtr[mid] = found;
  jumpToSlot(machine, found, false);
}

/** Jump back to machine `mid`'s previous free working day, ending at today. Faithful port of
 *  legacy `gotoPrevFree`. */
export function gotoPrevFree(mid: string): void {
  const machine = window.machById(mid);
  if (!machine || !nextFreePtr[mid]) return;
  const previous = prevFreeBefore(machine, nextFreePtr[mid]);
  if (previous) {
    nextFreePtr[mid] = previous;
    jumpToSlot(machine, previous, true);
    return;
  }
  const today = todayAsIsoDateString();
  if (nextFreePtr[mid] !== today) {
    nextFreePtr[mid] = today;
    jumpToSlot(machine, today, true);
  } else {
    toast(`${machine.name}: bereits am heutigen Tag.`);
  }
}
