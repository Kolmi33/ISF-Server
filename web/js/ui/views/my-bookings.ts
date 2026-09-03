// =======================================================================================
// MY BOOKINGS VIEW MODEL MODULE (web/js/ui/views/my-bookings.ts)
// =======================================================================================
//
// The "My bookings" view model's pure kernels: turning the raw state into the list the modal
// draws — the current user's future bookings, grouped into consecutive-workday runs
// (`computeMyRuns`) — and the filter/sort the list controls drive (`filterMyRuns`).
//
// =======================================================================================

import type { Machine, Bookings } from '../../../../shared/types.ts';
import { parseIsoDateString, isWeekend, nextWeekday } from '../../../../shared/dates.ts';
import { matchesGroupFilter } from '../../core/machines.ts';

/** A run of consecutive workdays the user has booked on one machine (a bookable "series"). */
export interface BookingRun {
  machine: Machine;
  dates: string[];
  /** The earliest creation timestamp among the run's days (empty string if none have one). */
  ts: string;
  /** The booking-group id/title this run's first day carries, if it's part of one (a single
   *  action that booked several machines together) — undefined for a plain, ungrouped
   *  booking. Only the first day is checked: a run that happens to splice a grouped day onto
   *  an otherwise-unrelated adjacent one (a rare edge case) still reads as "grouped" by its
   *  leading day, which is the day `gotoRun`/most user attention actually lands on anyway. */
  groupId?: string;
  groupTitle?: string;
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
    // The earliest creation timestamp among a run's days (empty string if none have one).
    const earliestTimestamp = (runDates: string[]): string =>
      runDates
        .map((date) => machineBookings[date]!.ts || '')
        .filter(Boolean)
        .sort()[0] || '';
    const pushRun = (runDates: string[]): void => {
      if (!runDates.length) return;
      const firstBooking = machineBookings[runDates[0]!]!;
      runs.push({
        machine,
        dates: runDates,
        ts: earliestTimestamp(runDates),
        groupId: firstBooking.gid,
        groupTitle: firstBooking.gtitle,
      });
    };
    let currentRunDates: string[] = [];
    for (const date of myBookedWorkdays) {
      const continuesCurrentRun =
        currentRunDates.length &&
        nextWeekday(currentRunDates[currentRunDates.length - 1]!) === date;
      if (continuesCurrentRun) {
        currentRunDates.push(date);
      } else {
        pushRun(currentRunDates);
        currentRunDates = [date];
      }
    }
    pushRun(currentRunDates);
  }
  runs.sort((runA, runB) => (runA.dates[0]! < runB.dates[0]! ? -1 : 1));
  return runs;
}

/** The list controls: free-text machine, a Bereich (group-or-category, see
 *  `core/machines.ts`'s `matchesGroupFilter`), a date window, and a sort key. Deliberately no
 *  "person" field, unlike `AllBookingsFilter` — every run here is already known to be the
 *  current user's own. */
export interface MyBookingsFilter {
  mach: string;
  group: string;
  from: string;
  to: string;
  sort: string;
}

/** A run shape generic enough to cover both the frozen `BookingRun` and the modal's own
 *  live-day-filtered variant — `filterMyRuns` only ever reads these three fields. */
export interface FilterableRun {
  machine: Machine;
  dates: readonly string[];
  ts: string;
}

/** The sort comparators, keyed by the modal's sort dropdown values — the same shape as
 *  `views/all-bookings.ts`'s own sorters, minus the 'person' key (meaningless here: every run
 *  is already the same one person). */
const sorters: Record<string, (runA: FilterableRun, runB: FilterableRun) => number> = {
  termin: (runA, runB) =>
    runA.dates[0]! < runB.dates[0]! ? -1 : runA.dates[0]! > runB.dates[0]! ? 1 : 0,
  erstellt: (runA, runB) => (runB.ts || '').localeCompare(runA.ts || ''),
  bereich: (runA, runB) =>
    (runA.machine.group || '').localeCompare(runB.machine.group || '', 'de') ||
    runA.machine.name.localeCompare(runB.machine.name, 'de') ||
    (runA.dates[0]! < runB.dates[0]! ? -1 : 1),
  maschine: (runA, runB) =>
    runA.machine.name.localeCompare(runB.machine.name, 'de') ||
    (runA.dates[0]! < runB.dates[0]! ? -1 : 1),
};

/**
 * Filters and sorts the runs for the list — a generic over any {@link FilterableRun}, so it
 * works equally on the frozen `BookingRun[]` and the modal's own live-day-filtered run shape.
 * Machine is a case-insensitive substring match; the date window keeps runs that overlap
 * `[from, to]`; an unknown sort key falls back to `termin`.
 */
export function filterMyRuns<T extends FilterableRun>(
  runs: readonly T[],
  filter: MyBookingsFilter,
): T[] {
  const lowercaseMachine = filter.mach.trim().toLowerCase();
  return runs
    .filter(
      (run) =>
        (!lowercaseMachine || run.machine.name.toLowerCase().includes(lowercaseMachine)) &&
        (!filter.group || matchesGroupFilter(run.machine, filter.group)) &&
        (!filter.from || run.dates[run.dates.length - 1]! >= filter.from) &&
        (!filter.to || run.dates[0]! <= filter.to),
    )
    .sort(sorters[filter.sort] || sorters.termin);
}
