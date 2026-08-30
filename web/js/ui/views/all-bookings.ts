// The "All bookings" view model (Phase 4.3). The modal's inputs, the go-to wiring and the row
// markup stay in the legacy adapter; the two pure kernels move here: grouping every future booking
// into per-person consecutive-workday runs (`computeAllRuns`), and the filter/sort/cap that the
// list controls drive (`filterAllRuns`). Pure over `core/dates`; machines, bookings, today and the
// filter criteria are injected (E4). Faithful port of legacy `computeAllRuns` + the list `renderList`.

import type { Machine, Bookings } from '../../../../shared/types.ts';
import { parseIsoDateString, addDays, isWeekend, formatDateAsIsoString } from '../../core/dates.ts';

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
  const nextWorkday = (isoDateString: string): string => {
    let candidateDate = addDays(parseIsoDateString(isoDateString), 1);
    while (isWeekend(candidateDate)) {
      candidateDate = addDays(candidateDate, 1);
    }
    return formatDateAsIsoString(candidateDate);
  };
  const runs: AllRun[] = [];
  for (const m of machines) {
    const mb = bookings[m.id] || {};
    const ds = Object.keys(mb)
      .filter((d) => d >= today && !isWeekend(parseIsoDateString(d)))
      .sort();
    const runTs = (arr: string[]): string =>
      arr
        .map((d) => mb[d]!.ts || '') // d is always a key of mb here
        .filter(Boolean)
        .sort()[0] || '';
    let cur: string[] = [];
    let curName: string | null = null;
    for (const d of ds) {
      const nm = mb[d]!.name;
      if (cur.length && curName === nm && nextWorkday(cur[cur.length - 1]!) === d) cur.push(d);
      else {
        if (cur.length) runs.push({ m, name: curName!, dates: cur, ts: runTs(cur) });
        cur = [d];
        curName = nm;
      }
    }
    if (cur.length) runs.push({ m, name: curName!, dates: cur, ts: runTs(cur) });
  }
  runs.sort((a, b) => (a.dates[0]! < b.dates[0]! ? -1 : 1));
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
const sorters: Record<string, (a: AllRun, b: AllRun) => number> = {
  termin: (a, b) => (a.dates[0]! < b.dates[0]! ? -1 : a.dates[0]! > b.dates[0]! ? 1 : 0),
  erstellt: (a, b) => (b.ts || '').localeCompare(a.ts || ''),
  bereich: (a, b) =>
    (a.m.group || '').localeCompare(b.m.group || '', 'de') ||
    a.m.name.localeCompare(b.m.name, 'de') ||
    (a.dates[0]! < b.dates[0]! ? -1 : 1),
  maschine: (a, b) =>
    a.m.name.localeCompare(b.m.name, 'de') || (a.dates[0]! < b.dates[0]! ? -1 : 1),
  person: (a, b) =>
    (a.name || '').localeCompare(b.name || '', 'de') || (a.dates[0]! < b.dates[0]! ? -1 : 1),
};

/**
 * Filter, sort and cap (300) the runs for the list. Person/machine are case-insensitive substring
 * matches; the date window keeps runs that overlap `[from, to]`; an unknown sort key falls back to
 * `termin`. Faithful port of the filter+sort+slice in legacy `renderList`.
 */
export function filterAllRuns(runs: readonly AllRun[], f: AllBookingsFilter): AllRun[] {
  const p = f.person.trim().toLowerCase();
  const mq = f.mach.trim().toLowerCase();
  return runs
    .filter(
      (r) =>
        (!p || r.name.toLowerCase().includes(p)) &&
        (!mq || r.m.name.toLowerCase().includes(mq)) &&
        (!f.group || r.m.group === f.group) &&
        (!f.from || r.dates[r.dates.length - 1]! >= f.from) &&
        (!f.to || r.dates[0]! <= f.to),
    )
    .sort(sorters[f.sort] || sorters.termin)
    .slice(0, 300);
}
