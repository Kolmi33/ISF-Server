import { describe, it, expect } from 'vitest';
import type { Machine, Bookings } from '../../../../shared/types.ts';
import { computeMyRuns } from './my-bookings.ts';

const mach = (id: string): Machine => ({ id, name: id.toUpperCase(), group: 'g' });
const m1 = mach('m1');
const m2 = mach('m2');
const bk = (name: string) => ({ name });

// Anchors (TZ=UTC pinned): 2021-01-04 Mon … 08 Fri, 09 Sat, 10 Sun, 11 Mon.
const today = '2021-01-04';

describe('computeMyRuns', () => {
  it('groups consecutive workdays into runs and splits on gaps', () => {
    const bookings: Bookings = {
      m1: {
        '2021-01-04': bk('anna'),
        '2021-01-05': bk('anna'),
        '2021-01-07': bk('anna'), // gap: 06 missing → new run
      },
    };
    const runs = computeMyRuns([m1], bookings, 'anna', today);
    expect(runs).toEqual([
      { machine: m1, dates: ['2021-01-04', '2021-01-05'] },
      { machine: m1, dates: ['2021-01-07'] },
    ]);
  });

  it('treats Fri→Mon as one run (weekend skipped)', () => {
    const bookings: Bookings = { m1: { '2021-01-08': bk('anna'), '2021-01-11': bk('anna') } };
    const runs = computeMyRuns([m1], bookings, 'anna', today);
    expect(runs).toEqual([{ machine: m1, dates: ['2021-01-08', '2021-01-11'] }]);
  });

  it('drops past days, weekend bookings, and other users; matches case-insensitively', () => {
    const bookings: Bookings = {
      m1: {
        '2021-01-01': bk('anna'), // before today
        '2021-01-09': bk('anna'), // Saturday
        '2021-01-06': bk('bob'), // someone else
        '2021-01-05': bk('ANNA'), // case-insensitive match, kept
      },
    };
    const runs = computeMyRuns([m1], bookings, 'anna', today);
    expect(runs).toEqual([{ machine: m1, dates: ['2021-01-05'] }]);
  });

  it('sorts runs across machines by their first date', () => {
    const bookings: Bookings = {
      m1: { '2021-01-04': bk('anna'), '2021-01-07': bk('anna') },
      m2: { '2021-01-06': bk('anna') },
    };
    // machine order [m1, m2], but result is date-sorted: 04(m1), 06(m2), 07(m1)
    const runs = computeMyRuns([m1, m2], bookings, 'anna', today);
    expect(runs.map((r) => ({ id: r.machine.id, first: r.dates[0] }))).toEqual([
      { id: 'm1', first: '2021-01-04' },
      { id: 'm2', first: '2021-01-06' },
      { id: 'm1', first: '2021-01-07' },
    ]);
  });

  it('is empty when the machine has no matching bookings', () => {
    expect(computeMyRuns([m1], { m1: {} }, 'anna', today)).toEqual([]);
    expect(computeMyRuns([m1], {}, 'anna', today)).toEqual([]); // no entry for the machine
  });
});
