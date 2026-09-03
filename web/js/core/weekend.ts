// =======================================================================================
// WEEKEND-BRIDGE MODULE (web/js/core/weekend.ts)
// =======================================================================================
//
// Pure logic for one rule: a weekend day (Sat/Sun) only belongs in the plan as part of a
// continuous booking series that spans it — i.e. the Friday before AND the Monday after
// are also booked (by anyone, not necessarily the same person). `sweepWeekends` removes
// orphaned weekend days whose bridge has broken on one side.
//
// Key Principles:
// - PURE FUNCTION, MUTATING CONTRACT: no DOM, no I/O — but `sweepWeekends` mutates the
//   passed-in bookings object in place (deleting orphaned keys) and returns undo entries,
//   rather than returning a new object. Every caller relies on that exact contract.
//
// =======================================================================================

import type { BookingData } from '../../../shared/types.ts';
import { parseIsoDateString, formatDateAsIsoString, addDays } from '../../../shared/dates.ts';

/** An orphaned weekend day that was removed, with the previous value for undo. */
export interface WeekendUndo {
  machineId: string;
  date: string;
  prev: { name: string; ts?: string };
}

/**
 * Removes orphaned Sat/Sun entries for `machineId`: a weekend day survives only while both
 * the Friday before and the Monday after are booked (by anyone).
 *
 * How it works, for each booked day on the machine:
 * 1. Skips anything that isn't a Saturday or Sunday — this rule only ever removes weekend
 *    entries, never a weekday booking.
 * 2. Finds that weekend day's bridging Friday and Monday (Saturday's Friday is 1 day back
 *    and its Monday 2 days forward; Sunday's Friday is 2 days back and its Monday 1 day
 *    forward).
 * 3. If both bridging days are still booked, the weekend entry stays. Otherwise it's
 *    deleted and recorded as an undo entry.
 *
 * Mutates `freshServerData.bookings[machineId]` in place; returns the removed entries.
 */
export function sweepWeekends(freshServerData: BookingData, machineId: string): WeekendUndo[] {
  const machineBookings = freshServerData.bookings[machineId];
  if (!machineBookings) return [];
  const undo: WeekendUndo[] = [];
  for (const [isoDate, previousValue] of Object.entries(machineBookings)) {
    const date = parseIsoDateString(isoDate);
    const weekday = date.getUTCDay();
    const isSaturday = weekday === 6;
    const isSunday = weekday === 0;
    if (!isSaturday && !isSunday) continue;
    const fridayIsoDate = formatDateAsIsoString(addDays(date, isSaturday ? -1 : -2));
    const mondayIsoDate = formatDateAsIsoString(addDays(date, isSaturday ? 2 : 1));
    const bridgeStillHolds = machineBookings[fridayIsoDate] && machineBookings[mondayIsoDate];
    if (!bridgeStillHolds) {
      undo.push({ machineId, date: isoDate, prev: { ...previousValue } });
      delete machineBookings[isoDate];
    }
  }
  return undo;
}
