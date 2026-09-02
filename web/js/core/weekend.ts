// Pure weekend-bridge logic extracted from the monolith (legacy.js). No DOM, no I/O.
//
// A weekend day (Sat/Sun) only belongs in the plan as part of a continuous booking
// series that spans it — i.e. the Friday before AND the Monday after are also booked.
// sweepWeekends removes orphaned weekend days (series broken on one side). It mutates
// the passed-in bookings (deletes keys) and returns undo entries, exactly as the
// original — the caller relies on that contract.

import type { BookingData } from '../../../shared/types.ts';
import { parseIsoDateString, formatDateAsIsoString, addDays } from '../../../shared/dates.ts';

/** An orphaned weekend day that was removed, with the previous value for undo. */
export interface WeekendUndo {
  machineId: string;
  date: string;
  prev: { name: string; ts?: string };
}

/**
 * Remove orphaned Sat/Sun entries for `machineId`: a weekend day survives only while
 * both the Friday before and the Monday after are booked (by anyone). Mutates
 * `freshServerData.bookings[machineId]`; returns the removed entries as undo records.
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
    // Saturday's Friday is 1 day back and its Monday 2 days forward; Sunday's Friday
    // is 2 days back and its Monday 1 day forward.
    const fridayIsoDate = formatDateAsIsoString(addDays(date, isSaturday ? -1 : -2));
    const mondayIsoDate = formatDateAsIsoString(addDays(date, isSaturday ? 2 : 1));
    // The bridge holds as long as Friday AND Monday are booked (any person).
    const bridgeStillHolds = machineBookings[fridayIsoDate] && machineBookings[mondayIsoDate];
    if (!bridgeStillHolds) {
      undo.push({ machineId, date: isoDate, prev: { ...previousValue } });
      delete machineBookings[isoDate];
    }
  }
  return undo;
}
