import { describe, it, expect } from 'vitest';
import type { Machine, Bookings } from '../../../../shared/types.ts';
import { computeStats } from './stats.ts';

const bk = (name: string) => ({ name });
// m1: a machine with a 2-day maintenance slot; m2: a measurement device, no maintenance.
const m1: Machine = {
  id: 'm1',
  name: 'M1',
  group: 'Halle',
  maint: [{ type: 'wartung', from: '2021-01-05', until: '2021-01-06' }],
};
const m2: Machine = { id: 'm2', name: 'M2', group: 'Labor', cat: 'messtechnik' };

describe('computeStats', () => {
  // Range 2021-01-04 Mon … 2021-01-08 Fri: 5 weekdays, 5 calendar days.
  const bookings: Bookings = {
    m1: { '2021-01-04': bk('anna'), '2021-01-05': bk('Anna'), '2021-01-06': bk('bob') },
    m2: { '2021-01-04': bk('anna') },
  };
  const stats = computeStats([m1, m2], bookings, '2021-01-04', '2021-01-08');

  it('counts weekdays in the range as the utilisation denominator', () => {
    expect(stats.days).toEqual([
      '2021-01-04',
      '2021-01-05',
      '2021-01-06',
      '2021-01-07',
      '2021-01-08',
    ]);
  });

  it('builds per-machine rows with counts, percent, and a person breakdown', () => {
    const r1 = stats.machRows.find((r) => r.m.id === 'm1')!;
    expect(r1.n).toBe(3);
    expect(r1.pct).toBe(60); // 3 of 5 weekdays
    expect(r1.persons.get('anna')).toEqual({ name: 'Anna', days: 2 }); // case-folded key, kept display name
    expect(r1.persons.get('bob')).toEqual({ name: 'bob', days: 1 });
    const r2 = stats.machRows.find((r) => r.m.id === 'm2')!;
    expect(r2.n).toBe(1);
    expect(r2.pct).toBe(20);
  });

  it('indexes people across machines with a per-machine day breakdown', () => {
    const anna = stats.persons.get('anna')!;
    expect(anna.days).toBe(3); // 2 on M1 + 1 on M2
    expect(Object.fromEntries(anna.machines)).toEqual({ M1: 2, M2: 1 });
    const bob = stats.persons.get('bob')!;
    expect(bob.days).toBe(1);
    expect(Object.fromEntries(bob.machines)).toEqual({ M1: 1 });
  });

  it('tallies maintenance: intersecting slots (inst) and blocked calendar days', () => {
    expect(stats.maint.inst).toBe(1);
    expect(stats.maint.days).toBe(2); // 2021-01-05 and -06 blocked
    expect(stats.maint.rows).toEqual([{ m: m1, inst: 1, days: 2 }]); // m2 omitted (no maint, no block)
  });

  it('yields zero percent when the range has no weekdays', () => {
    const s = computeStats([m1], { m1: { '2021-01-09': bk('anna') } }, '2021-01-09', '2021-01-09');
    expect(s.days).toEqual([]); // Saturday only
    expect(s.machRows[0]!.n).toBe(0);
    expect(s.machRows[0]!.pct).toBe(0);
  });

  it('is empty when there are no machines', () => {
    const s = computeStats([], {}, '2021-01-04', '2021-01-08');
    expect(s.machRows).toEqual([]);
    expect(s.persons.size).toBe(0);
    expect(s.maint.rows).toEqual([]);
  });

  it('handles a machine with no bookings entry at all', () => {
    // m2 has no key in `bookings` → the `|| {}` fallback; no maint either → omitted from maint rows.
    const s = computeStats([m2], {}, '2021-01-04', '2021-01-08');
    expect(s.machRows[0]!.n).toBe(0);
    expect(s.machRows[0]!.persons.size).toBe(0);
    expect(s.persons.size).toBe(0);
    expect(s.maint.rows).toEqual([]);
  });
});
