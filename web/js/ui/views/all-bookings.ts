// =======================================================================================
// ALL BOOKINGS VIEW MODEL MODULE (web/js/ui/views/all-bookings.ts)
// =======================================================================================
//
// The "All bookings" view model's two pure kernels: grouping every future booking into
// per-person consecutive-workday runs (`computeAllRuns`), and the filter/sort/cap that the
// list controls drive (`filterAllRuns`).
//
// =======================================================================================

import type { Machine, Bookings } from '../../../../shared/types.ts';
import { parseIsoDateString, isWeekend, nextWeekday } from '../../../../shared/dates.ts';
import { getMachineCategory } from '../../core/machines.ts';

/** A booking run: consecutive workdays booked by one person on one machine, with the earliest ts. */
export interface AllRun {
  machine: Machine;
  name: string;
  dates: string[];
  ts: string;
}

/**
 * Groups every future booking (from `today`, weekdays only) into runs that break on a
 * change of person or a non-consecutive workday. Each run carries the earliest creation
 * timestamp of its days. Runs are returned sorted by first date.
 */
export function computeAllRuns(
  machines: readonly Machine[],
  bookings: Bookings,
  today: string,
): AllRun[] {
  const runs: AllRun[] = [];
  for (const machine of machines) {
    const machineBookings = bookings[machine.id] || {};
    const bookedWorkdays = Object.keys(machineBookings)
      .filter((date) => date >= today && !isWeekend(parseIsoDateString(date)))
      .sort();
    // The earliest creation timestamp among a run's days (empty string if none have one).
    const earliestTimestamp = (runDates: string[]): string =>
      runDates
        .map((date) => machineBookings[date]!.ts || '') // date is always a key of machineBookings here
        .filter(Boolean)
        .sort()[0] || '';
    let currentRunDates: string[] = [];
    let currentRunName: string | null = null;
    for (const date of bookedWorkdays) {
      const bookedByName = machineBookings[date]!.name;
      const continuesCurrentRun =
        currentRunDates.length &&
        currentRunName === bookedByName &&
        nextWeekday(currentRunDates[currentRunDates.length - 1]!) === date;
      if (continuesCurrentRun) {
        currentRunDates.push(date);
      } else {
        if (currentRunDates.length) {
          runs.push({
            machine,
            name: currentRunName!,
            dates: currentRunDates,
            ts: earliestTimestamp(currentRunDates),
          });
        }
        currentRunDates = [date];
        currentRunName = bookedByName;
      }
    }
    if (currentRunDates.length) {
      runs.push({
        machine,
        name: currentRunName!,
        dates: currentRunDates,
        ts: earliestTimestamp(currentRunDates),
      });
    }
  }
  runs.sort((runA, runB) => (runA.dates[0]! < runB.dates[0]! ? -1 : 1));
  return runs;
}

/** The list controls: free-text person/machine, a group, a date window, and a sort key. */
export interface AllBookingsFilter {
  person: string;
  mach: string;
  /** An exact department-group name (e.g. `"Halle 1"`), OR a whole top-level category
   *  selection encoded as `"cat:<categoryId>"` (e.g. `"cat:messtechnik"`) — the "Bereich"
   *  dropdown's own category-level options (`AllBookingsModal.tsx`) use this prefix so one
   *  select can offer both "just this department" and "every department in this category"
   *  without a second field. Empty string matches everything. */
  group: string;
  from: string;
  to: string;
  sort: string;
}

/** The `group` filter's prefix for a whole-category selection — see `AllBookingsFilter.group`. */
export const CATEGORY_FILTER_PREFIX = 'cat:';

/** Whether `machine` matches the "Bereich" filter value: an exact group name, or (given the
 *  `cat:` prefix) membership in that whole category regardless of department group. */
function matchesGroupFilter(machine: Machine, groupFilter: string): boolean {
  if (groupFilter.startsWith(CATEGORY_FILTER_PREFIX)) {
    return getMachineCategory(machine) === groupFilter.slice(CATEGORY_FILTER_PREFIX.length);
  }
  return machine.group === groupFilter;
}

/** The sort comparators, keyed by the modal's sort dropdown values. */
const sorters: Record<string, (runA: AllRun, runB: AllRun) => number> = {
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
  person: (runA, runB) =>
    (runA.name || '').localeCompare(runB.name || '', 'de') ||
    (runA.dates[0]! < runB.dates[0]! ? -1 : 1),
};

/**
 * Filters, sorts and caps (300) the runs for the list. Person/machine are case-insensitive
 * substring matches; the date window keeps runs that overlap `[from, to]`; an unknown sort
 * key falls back to `termin`.
 */
export function filterAllRuns(
  runs: readonly AllRun[],
  filterCriteria: AllBookingsFilter,
): AllRun[] {
  const lowercasePerson = filterCriteria.person.trim().toLowerCase();
  const lowercaseMachine = filterCriteria.mach.trim().toLowerCase();
  return runs
    .filter(
      (run) =>
        (!lowercasePerson || run.name.toLowerCase().includes(lowercasePerson)) &&
        (!lowercaseMachine || run.machine.name.toLowerCase().includes(lowercaseMachine)) &&
        (!filterCriteria.group || matchesGroupFilter(run.machine, filterCriteria.group)) &&
        (!filterCriteria.from || run.dates[run.dates.length - 1]! >= filterCriteria.from) &&
        (!filterCriteria.to || run.dates[0]! <= filterCriteria.to),
    )
    .sort(sorters[filterCriteria.sort] || sorters.termin)
    .slice(0, 300);
}
