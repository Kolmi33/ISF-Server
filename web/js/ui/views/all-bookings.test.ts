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

  it('splits on person change, gaps, and keeps consecutive workdays; sorts by first date', () => {
    expect(runs.map((r) => ({ id: r.machine.id, name: r.name, dates: r.dates }))).toEqual([
      { id: 'm1', name: 'anna', dates: ['2021-01-04', '2021-01-05'] },
      { id: 'm1', name: 'bob', dates: ['2021-01-06'] },
      { id: 'm2', name: 'carol', dates: ['2021-01-07'] },
      { id: 'm1', name: 'anna', dates: ['2021-01-08', '2021-01-11'] },
      { id: 'm2', name: 'carol', dates: ['2021-01-12'] },
    ]);
  });

  it('carries the earliest creation timestamp of a run (blanks ignored)', () => {
    expect(runs[0]!.ts).toBe('2021-01-02T09:00'); // min of the two anna ts
    expect(runs[1]!.ts).toBe(''); // bob day has no ts
  });

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

  it('passes everything through with empty filters (default termin sort)', () => {
    expect(ids(filterAllRuns(all, base))).toEqual(['Anna', 'Bob', 'Carla']);
  });

  it('filters by person (case-insensitive substring)', () => {
    expect(ids(filterAllRuns(all, { ...base, person: 'ANN' }))).toEqual(['Anna']);
    expect(filterAllRuns(all, { ...base, person: 'zzz' })).toEqual([]);
  });

  it('filters by machine name and by group', () => {
    expect(ids(filterAllRuns(all, { ...base, mach: 'bet' }))).toEqual(['Bob']);
    expect(ids(filterAllRuns(all, { ...base, group: 'Labor' }))).toEqual(['Bob']);
  });

  it('keeps runs overlapping the [from, to] window', () => {
    expect(ids(filterAllRuns(all, { ...base, from: '2021-01-15' }))).toEqual(['Carla']); // last >= from
    expect(ids(filterAllRuns(all, { ...base, to: '2021-01-06' }))).toEqual(['Anna']); // first <= to
  });

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

  it('falls back to termin for an unknown sort key', () => {
    expect(ids(filterAllRuns(all, { ...base, sort: 'nonsense' }))).toEqual([
      'Anna',
      'Bob',
      'Carla',
    ]);
  });

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
