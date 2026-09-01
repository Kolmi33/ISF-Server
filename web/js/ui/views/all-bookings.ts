// The "All bookings" view model (Phase 4.3). The modal's inputs, the go-to wiring and the row
// markup stay in the legacy adapter; the two pure kernels move here: grouping every future booking
// into per-person consecutive-workday runs (`computeAllRuns`), and the filter/sort/cap that the
// list controls drive (`filterAllRuns`). Pure over `core/dates`; machines, bookings, today and the
// filter criteria are injected (E4). Faithful port of legacy `computeAllRuns` + the list `renderList`.

import type { Machine, Bookings } from '../../../../shared/types.ts';
import { parseIsoDateString, isWeekend, nextWeekday } from '../../core/dates.ts';

/** A booking run: consecutive workdays booked by one person on one machine, with the earliest ts. */
export interface AllRun {
  m: Machine;
  name: string;
  dates: string[];
  ts: string;
}

/**
 * Group every future booking (from `today`, weekdays only) into runs that break on a change of
 * person or a non-consecutive workday. Each run carries the earliest creation timestamp of its
 * days. Runs are returned sorted by first date. Faithful port of legacy `computeAllRuns`.
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
            m: machine,
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
        m: machine,
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
  group: string;
  from: string;
  to: string;
  sort: string;
}

/** The sort comparators, keyed by the modal's sort dropdown values. Faithful to legacy `sorters`. */
const sorters: Record<string, (runA: AllRun, runB: AllRun) => number> = {
  termin: (runA, runB) =>
    runA.dates[0]! < runB.dates[0]! ? -1 : runA.dates[0]! > runB.dates[0]! ? 1 : 0,
  erstellt: (runA, runB) => (runB.ts || '').localeCompare(runA.ts || ''),
  bereich: (runA, runB) =>
    (runA.m.group || '').localeCompare(runB.m.group || '', 'de') ||
    runA.m.name.localeCompare(runB.m.name, 'de') ||
    (runA.dates[0]! < runB.dates[0]! ? -1 : 1),
  maschine: (runA, runB) =>
    runA.m.name.localeCompare(runB.m.name, 'de') || (runA.dates[0]! < runB.dates[0]! ? -1 : 1),
  person: (runA, runB) =>
    (runA.name || '').localeCompare(runB.name || '', 'de') ||
    (runA.dates[0]! < runB.dates[0]! ? -1 : 1),
};

/**
 * Filter, sort and cap (300) the runs for the list. Person/machine are case-insensitive substring
 * matches; the date window keeps runs that overlap `[from, to]`; an unknown sort key falls back to
 * `termin`. Faithful port of the filter+sort+slice in legacy `renderList`.
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
        (!lowercaseMachine || run.m.name.toLowerCase().includes(lowercaseMachine)) &&
        (!filterCriteria.group || run.m.group === filterCriteria.group) &&
        (!filterCriteria.from || run.dates[run.dates.length - 1]! >= filterCriteria.from) &&
        (!filterCriteria.to || run.dates[0]! <= filterCriteria.to),
    )
    .sort(sorters[filterCriteria.sort] || sorters.termin)
    .slice(0, 300);
}
