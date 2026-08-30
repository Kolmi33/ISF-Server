// Pure read-only booking queries extracted from legacy `openBookingDetail`: given one booked
// cell, what else is "the same booking" from the user's point of view? Two different notions,
// both faithfully ported: a contiguous same-name run of workdays on one machine (no explicit
// group), and a booking group sharing a `gid` (possibly spanning several machines). Kept
// separate from core/booking.ts (which is the write-path reducers) purely to stay under that
// file's line budget — this is genuinely a different concern (reading, not mutating).

import type { Bookings } from '../../../shared/types.ts';
import { addDays, isWeekend, parseIsoDateString, formatDateAsIsoString } from './dates.ts';

/** The next (or previous, for `direction: -1`) WORKDAY after `isoDate` — weekends are skipped
 *  entirely, never treated as part of a run. Faithful port of legacy `step`. */
function adjacentWorkday(isoDate: string, direction: 1 | -1): string {
  let date = parseIsoDateString(isoDate);
  do {
    date = addDays(date, direction);
  } while (isWeekend(date));
  return formatDateAsIsoString(date);
}

/**
 * The contiguous run of workdays, centered on `isoDate`, that machine `mid` has booked under
 * the same `name` — weekends don't break the run (they're simply skipped over), but a gap of
 * any other kind (a different booker, or a free/blocked day) does. Returned in chronological
 * order, always including `isoDate` itself. Faithful port of legacy `openBookingDetail`'s
 * backward/forward walk.
 */
export function findSameNameWorkdayRun(
  bookings: Bookings,
  mid: string,
  isoDate: string,
  name: string,
): string[] {
  const machineBookings = bookings[mid] || {};
  const run = [isoDate];

  let cursor = isoDate;
  while (true) {
    const previousWorkday = adjacentWorkday(cursor, -1);
    if (machineBookings[previousWorkday]?.name !== name) break;
    cursor = previousWorkday;
    run.unshift(cursor);
  }

  cursor = isoDate;
  while (true) {
    const nextWorkday = adjacentWorkday(cursor, 1);
    if (machineBookings[nextWorkday]?.name !== name) break;
    cursor = nextWorkday;
    run.push(cursor);
  }

  return run;
}

/** Every cell (across every machine) sharing booking-group id `gid`, plus which machines and
 *  dates that spans. Faithful port of legacy `openBookingDetail`'s group-collection loop. */
export interface BookingGroup {
  machineIds: Set<string>;
  /** Every date in the group, sorted ascending. */
  dates: string[];
}

export function findBookingGroup(bookings: Bookings, gid: string): BookingGroup {
  const machineIds = new Set<string>();
  const dates = new Set<string>();
  for (const mid of Object.keys(bookings)) {
    const machineBookings = bookings[mid]!;
    for (const date of Object.keys(machineBookings)) {
      if (machineBookings[date]?.gid === gid) {
        machineIds.add(mid);
        dates.add(date);
      }
    }
  }
  return { machineIds, dates: [...dates].sort() };
}
