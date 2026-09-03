// =======================================================================================
// FAVORITES & FREE-DAY JUMP MODULE (web/js/ui/favorite-jump.ts)
// =======================================================================================
//
// Favorites + the next-/previous-free-day jump buttons in the grid's row header.
// This module:
// 1. Toggles a machine's favorite status.
// 2. Finds and jumps the grid view to a machine's next/previous free working day.
//
// Key Principles:
// - DOM/STATE WIRING AROUND A PURE CORE: the day-scan logic itself (`nextFreeDay`/
//   `prevFreeDay`) already lives in `ui/navigation.ts`; this module is the DOM/state
//   plumbing around it — computing "is this machine free on this day" and driving the
//   actual scroll/selection/toast.
// - IMPORT DIRECTION AVOIDS A CYCLE: this module imports `selection`/`paintSelection` FROM
//   `ui/grid-interaction.ts` (rather than the reverse), since `grid-interaction.ts` calls
//   into this module via its own injected `GridInteractionHandlers` struct instead of a
//   direct import — a direct import the other way would create a cycle.
//
// =======================================================================================

import type { Machine } from '../../../shared/types.ts';
import {
  addDays,
  formatDateLong,
  mondayOfDate,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../shared/dates.ts';
import {
  isMachineAvailableOnWeekday,
  isMachineBlockedOnDate,
  getMaintenanceSlots,
} from '../core/machines.ts';
import { getBooking } from '../core/bookings.ts';
import { nextFreeDay, prevFreeDay, type FreeDay } from './navigation.ts';
import { centerColumn } from './grid-scroll.ts';
import { selection, paintSelection } from './grid-interaction.ts';
import { toast } from './toast.ts';
import { store } from '../store-instance.ts';
import { machById } from './machine-lookup.ts';

/** Toggles `machineId`'s favorite status, persists it, and repaints. */
export function toggleFav(machineId: string): void {
  const favs = store.get('favs');
  if (favs.has(machineId)) favs.delete(machineId);
  else favs.add(machineId);
  localStorage.setItem('mb_favs', JSON.stringify([...favs]));
  store.notify();
}

/** Machine id → the last free day jumped to (reset for every OTHER machine on each new
 *  jump, so switching machines always starts a fresh search from today). Read directly by
 *  the React Grid for the row header's "back" button. */
export const nextFreePtr: Record<string, string> = {};

function centerOnDate(isoDate: string): void {
  requestAnimationFrame(() => centerColumn(isoDate)); // instant, centered — no snap-back
}

/** Builds a `FreeDay` predicate for `machine`: bookable on a given day means not already
 *  booked, not blocked by maintenance, and available that weekday. */
function isFreeFor(machine: Machine): FreeDay {
  return (isoDate) =>
    !getBooking(store.get('data')!.bookings, machine.id, isoDate) &&
    !isMachineBlockedOnDate(machine, isoDate) &&
    isMachineAvailableOnWeekday(machine, isoDate);
}

/** Finds the next free working day for `machine` strictly after `fromIso` (or from today
 *  when `fromIso` is null — the first jump for a machine that has no pointer yet). */
export function nextFreeAfter(machine: Machine, fromIso: string | null): string | null {
  return nextFreeDay(fromIso, todayAsIsoDateString(), isFreeFor(machine));
}

/** Finds the previous free working day for `machine` before `fromIso`, never earlier than
 *  today — jumping "back" should never land in the past. */
export function prevFreeBefore(machine: Machine, fromIso: string): string | null {
  return prevFreeDay(fromIso, todayAsIsoDateString(), isFreeFor(machine));
}

/**
 * Jumps the grid to `isoDate` for `machine`.
 *
 * How it works:
 * 1. Rebuilds the visible window centered on `isoDate` (2 weeks before, 4 after) and
 *    selects that cell.
 * 2. Scrolls the grid to actually show it.
 * 3. Checks whether anything is booked or blocked anywhere past `isoDate` — if not, the
 *    toast flags the day as "dauerhaft frei" (permanently free from here on), since that's
 *    meaningfully different from "the next free day happens to be this one".
 */
function jumpToSlot(machine: Machine, isoDate: string, isBack: boolean): void {
  store.set({
    startMonday: addDays(mondayOfDate(parseIsoDateString(isoDate)), -14),
    extraWeeks: 4,
  });
  document.getElementById('gridWrap')!.scrollLeft = 0;
  selection.anchor = { machineId: machine.id, date: isoDate };
  selection.focus = { machineId: machine.id, date: isoDate };
  paintSelection();
  centerOnDate(isoDate);

  const machineBookings = store.get('data')!.bookings[machine.id] || {};
  const today = todayAsIsoDateString();
  const lastBookedDate =
    Object.keys(machineBookings)
      .filter((date) => date >= today)
      .sort()
      .pop() || '';
  const slots = getMaintenanceSlots(machine);
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
 * Jumps forward to `machineId`'s next free working day, relative to the last jump (or from
 * today, for a fresh machine). Switching machines resets every other machine's pointer.
 */
export function gotoNextFree(machineId: string): void {
  const machine = machById(machineId);
  if (!machine) return;
  for (const key of Object.keys(nextFreePtr)) {
    if (key !== machineId) delete nextFreePtr[key];
  }
  const found = nextFreeAfter(machine, nextFreePtr[machineId] || null);
  if (!found) {
    toast(`${machine.name}: kein freier Termin in den nächsten 2 Jahren gefunden.`);
    return;
  }
  nextFreePtr[machineId] = found;
  jumpToSlot(machine, found, false);
}

/** Jumps back to `machineId`'s previous free working day, stopping at today — repeated
 *  presses walk backward one free day at a time until there's nowhere earlier left to go. */
export function gotoPrevFree(machineId: string): void {
  const machine = machById(machineId);
  if (!machine || !nextFreePtr[machineId]) return;
  const previous = prevFreeBefore(machine, nextFreePtr[machineId]);
  if (previous) {
    nextFreePtr[machineId] = previous;
    jumpToSlot(machine, previous, true);
    return;
  }
  const today = todayAsIsoDateString();
  if (nextFreePtr[machineId] !== today) {
    nextFreePtr[machineId] = today;
    jumpToSlot(machine, today, true);
  } else {
    toast(`${machine.name}: bereits am heutigen Tag.`);
  }
}
