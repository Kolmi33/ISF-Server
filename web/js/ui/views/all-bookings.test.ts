import { describe, it, expect } from 'vitest';
import type { Machine, Bookings } from '../../../../shared/types.ts';
import { computeAllRuns, filterAllRuns, type AllRun } from './all-bookings.ts';

const mach = (id: string, name: string, group: string): Machine => ({ id, name, group });
const m1 = mach('m1', 'M1', 'Halle');
const m2 = mach('m2', 'M2', 'Labor');

describe('computeAllRuns', () => {
  const bookings: Bookings = {
    m1: {
      '2021-01-01': { name: 'anna' }, // past → dropped
      '2021-01-04': { name: 'anna', ts: '2021-01-03T10:00' },
      '2021-01-05': { name: 'anna', ts: '2021-01-02T09:00' }, // earlier ts → run ts
      '2021-01-06': { name: 'bob' }, // person change → breaks the run
      '2021-01-08': { name: 'anna' }, // person change back → new run
      '2021-01-09': { name: 'anna' }, // Saturday → dropped
      '2021-01-11': { name: 'anna' }, // nextWd(08 Fri) = 11 Mon → consecutive
    },
    m2: {
      '2021-01-07': { name: 'carol' },
      '2021-01-12': { name: 'carol' }, // gap from 07 (same person, non-consecutive) → breaks
    },
  };
  const runs = computeAllRuns([m1, m2], bookings, '2021-01-04');

  // What: runs split whenever the booker changes or a genuine (non-weekend) gap appears, but
  // stay joined across a Fri→Mon weekend; the full result list is sorted by each run's first date.
  // How: builds one machine's bookings covering a past day (dropped), a same-person run, a
  // person-change break, another person-change back, a dropped Saturday, and a Fri→Mon
  // continuation, plus a second machine's separate run — and checks the exact split/order result.
  it('splits on person change, gaps, and keeps consecutive workdays; sorts by first date', () => {
    expect(runs.map((r) => ({ id: r.machine.id, name: r.name, dates: r.dates }))).toEqual([
      { id: 'm1', name: 'anna', dates: ['2021-01-04', '2021-01-05'] },
      { id: 'm1', name: 'bob', dates: ['2021-01-06'] },
      { id: 'm2', name: 'carol', dates: ['2021-01-07'] },
      { id: 'm1', name: 'anna', dates: ['2021-01-08', '2021-01-11'] },
      { id: 'm2', name: 'carol', dates: ['2021-01-12'] },
    ]);
  });

  // What: a run's `ts` is the earliest creation timestamp among its days (blank/missing
  // timestamps don't count), or an empty string if none of its days have one at all.
  // How: checks the anna run picks the earlier of its two days' timestamps, and the bob run
  // (whose one day has no ts) reports an empty string.
  it('carries the earliest creation timestamp of a run (blanks ignored)', () => {
    expect(runs[0]!.ts).toBe('2021-01-02T09:00'); // min of the two anna ts
    expect(runs[1]!.ts).toBe(''); // bob day has no ts
  });

  // What: machines with no future bookings — whether an empty bucket, no bucket, or no
  // machines at all — all yield an empty run list.
  // How: checks an empty bookings bucket, a missing bucket, and an empty machine list.
  it('is empty for machines with no future bookings', () => {
    expect(computeAllRuns([m1], { m1: {} }, '2021-01-04')).toEqual([]);
    expect(computeAllRuns([m1], {}, '2021-01-04')).toEqual([]); // machine absent from bookings map
    expect(computeAllRuns([], {}, '2021-01-04')).toEqual([]);
  });
});

describe('filterAllRuns', () => {
  const mA = mach('a', 'Alpha', 'Halle');
  const mB = mach('b', 'Beta', 'Labor');
  const mC = mach('c', 'Gamma', 'Halle');
  const A: AllRun = {
    machine: mA,
    name: 'Anna',
    dates: ['2021-01-04', '2021-01-05'],
    ts: '2021-01-03',
  };
  const B: AllRun = { machine: mB, name: 'Bob', dates: ['2021-01-10'], ts: '2021-01-01' };
  const C: AllRun = { machine: mC, name: 'Carla', dates: ['2021-01-20'], ts: '' };
  const all = [A, B, C];
  const base = { person: '', mach: '', group: '', from: '', to: '', sort: 'termin' };
  const ids = (rs: AllRun[]) => rs.map((r) => r.name);

  // What: with every filter field empty, all runs pass through, sorted by the default
  // 'termin' (date) key.
  // How: calls with the base (all-empty) filter and checks all three runs come back in date order.
  it('passes everything through with empty filters (default termin sort)', () => {
    expect(ids(filterAllRuns(all, base))).toEqual(['Anna', 'Bob', 'Carla']);
  });

  // What: the person filter matches a case-insensitive substring; a non-matching query yields
  // nothing.
  // How: checks a partial, differently-cased match and a query matching nobody.
  it('filters by person (case-insensitive substring)', () => {
    expect(ids(filterAllRuns(all, { ...base, person: 'ANN' }))).toEqual(['Anna']);
    expect(filterAllRuns(all, { ...base, person: 'zzz' })).toEqual([]);
  });

  // What: the machine-name filter and the group filter each independently narrow the list.
  // How: checks a machine-name substring match and an exact group match each find the same
  // single run they're expected to.
  it('filters by machine name and by group', () => {
    expect(ids(filterAllRuns(all, { ...base, mach: 'bet' }))).toEqual(['Bob']);
    expect(ids(filterAllRuns(all, { ...base, group: 'Labor' }))).toEqual(['Bob']);
  });

  // What: the date-window filter keeps a run when it OVERLAPS [from, to] — a run only needs
  // its last date >= from, or its first date <= to, not both bounds fully inside the window.
  // How: checks a late `from` still catches a run whose last date reaches that far, and an
  // early `to` still catches a run whose first date is within it.
  it('keeps runs overlapping the [from, to] window', () => {
    expect(ids(filterAllRuns(all, { ...base, from: '2021-01-15' }))).toEqual(['Carla']); // last >= from
    expect(ids(filterAllRuns(all, { ...base, to: '2021-01-06' }))).toEqual(['Anna']); // first <= to
  });

  // What: each of the four named sort keys produces a distinct, correct order (person
  // alphabetical, creation time newest-first, area/group then machine name, machine name).
  // How: applies each sort key to the same three-run fixture and checks the resulting order
  // matches what that key should produce.
  it('applies each sort key', () => {
    expect(ids(filterAllRuns(all, { ...base, sort: 'person' }))).toEqual(['Anna', 'Bob', 'Carla']);
    expect(ids(filterAllRuns(all, { ...base, sort: 'erstellt' }))).toEqual([
      'Anna',
      'Bob',
      'Carla',
    ]); // ts desc
    expect(ids(filterAllRuns(all, { ...base, sort: 'bereich' }))).toEqual(['Anna', 'Carla', 'Bob']); // Halle then Labor
    expect(ids(filterAllRuns(all, { ...base, sort: 'maschine' }))).toEqual([
      'Anna',
      'Bob',
      'Carla',
    ]); // Alpha,Beta,Gamma
  });

  // What: an unrecognized sort key falls back to the default 'termin' (date) sort rather
  // than throwing or leaving the list unsorted.
  // How: passes a nonsense sort string and checks the result matches the same order termin
  // sort would produce.
  it('falls back to termin for an unknown sort key', () => {
    expect(ids(filterAllRuns(all, { ...base, sort: 'nonsense' }))).toEqual([
      'Anna',
      'Bob',
      'Carla',
    ]);
  });

  // What: when the bereich/maschine/person sort keys' own primary criteria are equal between
  // two runs (same group+machine, same person), each one falls back to the run's first date
  // as a tiebreak, and this holds regardless of which order the equal runs were given in.
  // How: builds two runs on the same machine by the same person differing only in date, and
  // for each of the three sort keys, checks both possible input orderings produce the same
  // date-ascending output.
  it('breaks group/machine/person ties by first date (both input orders)', () => {
    // same machine (group+name) and same person → all three sorters fall to the date tiebreak
    const early: AllRun = { machine: mA, name: 'Anna', dates: ['2021-01-04'], ts: '' };
    const late: AllRun = { machine: mA, name: 'Anna', dates: ['2021-01-08'], ts: '' };
    const d = (rs: AllRun[]) => rs.map((r) => r.dates[0]);
    for (const sort of ['bereich', 'maschine', 'person']) {
      expect(d(filterAllRuns([late, early], { ...base, sort }))).toEqual([
        '2021-01-04',
        '2021-01-08',
      ]);
      expect(d(filterAllRuns([early, late], { ...base, sort }))).toEqual([
        '2021-01-04',
        '2021-01-08',
      ]);
    }
  });

  // What: 'termin' sorts strictly ascending by first date regardless of input order, and two
  // runs sharing the exact same first date keep their original relative order (a stable sort,
  // not an arbitrary tiebreak).
  // How: checks reversed input sorts back to ascending, and two same-date runs (from
  // different machines) keep their given order.
  it('termin: sorts out-of-order input ascending and ties equal first dates (stable)', () => {
    const x04: AllRun = { machine: mA, name: 'X', dates: ['2021-01-04'], ts: '' };
    const x08: AllRun = { machine: mA, name: 'Y', dates: ['2021-01-08'], ts: '' };
    const y04: AllRun = { machine: mB, name: 'Z', dates: ['2021-01-04'], ts: '' };
    expect(filterAllRuns([x08, x04], { ...base, sort: 'termin' }).map((r) => r.dates[0])).toEqual([
      '2021-01-04',
      '2021-01-08',
    ]);
    expect(filterAllRuns([x04, y04], { ...base, sort: 'termin' }).map((r) => r.name)).toEqual([
      'X',
      'Z',
    ]);
  });

  // What: each sort comparator tolerates a run whose sorted-on field is empty (an empty
  // group, an empty person name, a missing ts) without throwing, in either comparison
  // position — and an empty group specifically still sorts ahead of a real one under 'bereich'.
  // How: builds one run of each "empty field" kind, runs each through its relevant
  // comparator in both operand orders checking none throw, then checks the actual sort
  // order places the empty-group run first.
  it('handles empty group / name / ts in the comparators (both operand positions)', () => {
    const eGroup: AllRun = {
      machine: mach('e', 'E', ''),
      name: 'Zed',
      dates: ['2021-01-05'],
      ts: '',
    };
    const eName: AllRun = { machine: mA, name: '', dates: ['2021-01-05'], ts: '' };
    const noTs: AllRun = { machine: mB, name: 'Bob', dates: ['2021-01-05'], ts: '' };
    // each call runs the comparator once as (arr[0], arr[1]); both orders cover a-side and b-side.
    for (const [x, y] of [
      [eGroup, A],
      [A, eGroup],
    ] as const)
      expect(() => filterAllRuns([x, y], { ...base, sort: 'bereich' })).not.toThrow();
    for (const [x, y] of [
      [eName, A],
      [A, eName],
    ] as const)
      expect(() => filterAllRuns([x, y], { ...base, sort: 'person' })).not.toThrow();
    for (const [x, y] of [
      [noTs, B],
      [B, noTs],
    ] as const)
      expect(() => filterAllRuns([x, y], { ...base, sort: 'erstellt' })).not.toThrow();
    // sanity: an empty-group run sorts ahead of a 'Halle' run under bereich
    expect(filterAllRuns([A, eGroup], { ...base, sort: 'bereich' })[0]!.machine.group).toBe('');
  });
});
