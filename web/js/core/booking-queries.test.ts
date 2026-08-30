import { describe, it, expect } from 'vitest';
import type { Bookings } from '../../../shared/types.ts';
import { findSameNameWorkdayRun, findBookingGroup } from './booking-queries.ts';

describe('findSameNameWorkdayRun', () => {
  it('is just the one date when neighbors are empty', () => {
    const bookings: Bookings = { m1: { '2021-01-06': { name: 'anna' } } }; // a Wednesday
    expect(findSameNameWorkdayRun(bookings, 'm1', '2021-01-06', 'anna')).toEqual(['2021-01-06']);
  });

  it('extends backward and forward across consecutive same-name workdays', () => {
    const bookings: Bookings = {
      m1: {
        '2021-01-04': { name: 'anna' },
        '2021-01-05': { name: 'anna' },
        '2021-01-06': { name: 'anna' },
        '2021-01-07': { name: 'anna' },
      },
    };
    expect(findSameNameWorkdayRun(bookings, 'm1', '2021-01-05', 'anna')).toEqual([
      '2021-01-04',
      '2021-01-05',
      '2021-01-06',
      '2021-01-07',
    ]);
  });

  it('stops at a different name, a gap, or a blocked/free day', () => {
    const bookings: Bookings = {
      m1: {
        '2021-01-04': { name: 'bob' },
        '2021-01-05': { name: 'anna' },
        // 2021-01-06 free — breaks the run
        '2021-01-07': { name: 'anna' },
      },
    };
    expect(findSameNameWorkdayRun(bookings, 'm1', '2021-01-05', 'anna')).toEqual(['2021-01-05']);
  });

  it('skips weekends without breaking the run (Fri→Mon counts as adjacent)', () => {
    // 2021-01-08 Fri, 2021-01-11 Mon (weekend between them has no cells at all).
    const bookings: Bookings = {
      m1: { '2021-01-08': { name: 'anna' }, '2021-01-11': { name: 'anna' } },
    };
    expect(findSameNameWorkdayRun(bookings, 'm1', '2021-01-08', 'anna')).toEqual([
      '2021-01-08',
      '2021-01-11',
    ]);
  });

  it('treats a machine with no bookings at all as an empty neighborhood', () => {
    expect(findSameNameWorkdayRun({}, 'm1', '2021-01-06', 'anna')).toEqual(['2021-01-06']);
  });
});

describe('findBookingGroup', () => {
  it('collects every cell sharing the gid, across machines, sorted by date', () => {
    const bookings: Bookings = {
      m1: {
        '2021-01-06': { name: 'anna', gid: 'g1' },
        '2021-01-04': { name: 'anna', gid: 'g1' },
      },
      m2: {
        '2021-01-05': { name: 'anna', gid: 'g1' },
        '2021-01-07': { name: 'anna', gid: 'other' }, // different group — excluded
      },
    };
    const group = findBookingGroup(bookings, 'g1');
    expect(group.machineIds).toEqual(new Set(['m1', 'm2']));
    expect(group.dates).toEqual(['2021-01-04', '2021-01-05', '2021-01-06']);
  });

  it('is empty for a gid nothing belongs to', () => {
    const group = findBookingGroup({ m1: { '2021-01-04': { name: 'anna' } } }, 'nope');
    expect(group.machineIds.size).toBe(0);
    expect(group.dates).toEqual([]);
  });
});
