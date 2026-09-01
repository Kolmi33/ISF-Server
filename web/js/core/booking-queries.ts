// Pure read-only booking queries extracted from legacy `openBookingDetail`: given one booked
// cell, what else is "the same booking" from the user's point of view? Two different notions,
// both faithfully ported: a contiguous same-name run of workdays on one machine (no explicit
// group), and a booking group sharing a `gid` (possibly spanning several machines). Kept
// separate from core/booking.ts (which is the write-path reducers) purely to stay under that
// file's line budget — this is genuinely a different concern (reading, not mutating).

import type { Bookings } from '../../../shared/types.ts';
import { nextWeekday, previousWeekday } from './dates.ts';

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
    const previousWorkday = previousWeekday(cursor);
    if (machineBookings[previousWorkday]?.name !== name) break;
    cursor = previousWorkday;
    run.unshift(cursor);
  }

  cursor = isoDate;
  while (true) {
    const nextWorkday = nextWeekday(cursor);
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
