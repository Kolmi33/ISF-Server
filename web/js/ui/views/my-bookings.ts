// =======================================================================================
// MY BOOKINGS VIEW MODEL MODULE (web/js/ui/views/my-bookings.ts)
// =======================================================================================
//
// The "My bookings" view model's pure kernel: turns the raw state into the list the modal
// draws — the current user's future bookings, grouped into consecutive-workday runs (series).
//
// =======================================================================================

import type { Machine, Bookings } from '../../../../shared/types.ts';
import { parseIsoDateString, isWeekend, nextWeekday } from '../../../../shared/dates.ts';

/** A run of consecutive workdays the user has booked on one machine (a bookable "series"). */
export interface BookingRun {
  machine: Machine;
  dates: string[];
}

/**
 * Groups the user's future bookings into consecutive-workday runs.
 *
 * How it works: for each machine (in the given display order), takes that user's bookings
 * from `today` onward, drops weekends, and splits the sorted days into runs where each day
 * is the next workday after the previous one (so Fri→Mon is one continuous run, not two).
 * Runs are returned sorted by their first date.
 */
export function computeMyRuns(
  machines: readonly Machine[],
  bookings: Bookings,
  user: string,
  today: string,
): BookingRun[] {
  const lowercaseUser = user.toLowerCase();
  const runs: BookingRun[] = [];
  for (const machine of machines) {
    const machineBookings = bookings[machine.id] || {};
    const myBookedWorkdays = Object.keys(machineBookings)
      .filter(
        (date) =>
          date >= today &&
          !isWeekend(parseIsoDateString(date)) &&
          machineBookings[date]!.name.toLowerCase() === lowercaseUser,
      )
      .sort();
    let currentRunDates: string[] = [];
    for (const date of myBookedWorkdays) {
      const continuesCurrentRun =
        currentRunDates.length &&
        nextWeekday(currentRunDates[currentRunDates.length - 1]!) === date;
      if (continuesCurrentRun) {
        currentRunDates.push(date);
      } else {
        if (currentRunDates.length) runs.push({ machine, dates: currentRunDates });
        currentRunDates = [date];
      }
    }
    if (currentRunDates.length) runs.push({ machine, dates: currentRunDates });
  }
  runs.sort((runA, runB) => (runA.dates[0]! < runB.dates[0]! ? -1 : 1));
  return runs;
}
