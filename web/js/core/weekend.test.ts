import { describe, it, expect } from 'vitest';
import type { BookingData } from '../../../shared/types.ts';
import { sweepWeekends } from './weekend.ts';

// Anchor series: 2021-01-08 Fri, -09 Sat, -10 Sun, -11 Mon.
const FRI = '2021-01-08';
const SAT = '2021-01-09';
const SUN = '2021-01-10';
const MON = '2021-01-11';

function data(bookings: BookingData['bookings']): BookingData {
  const ids = Object.keys(bookings);
  return { machines: ids.map((id) => ({ id, name: id, group: 'g' })), bookings };
}

describe('sweepWeekends', () => {
  it('keeps a weekend day that is bridged on both sides', () => {
    const d = data({ m1: { [FRI]: { name: 'A' }, [SAT]: { name: 'A' }, [MON]: { name: 'A' } } });
    expect(sweepWeekends(d, 'm1')).toEqual([]);
    expect(d.bookings.m1?.[SAT]).toBeDefined();
  });
  it('keeps a bridged Sunday too (Fri before + Mon after)', () => {
    const d = data({ m1: { [FRI]: { name: 'A' }, [SUN]: { name: 'A' }, [MON]: { name: 'A' } } });
    expect(sweepWeekends(d, 'm1')).toEqual([]);
    expect(d.bookings.m1?.[SUN]).toBeDefined();
  });
  it('removes an orphaned Saturday and returns its undo record', () => {
    const d = data({ m1: { [SAT]: { name: 'A', ts: 't1' } } });
    expect(sweepWeekends(d, 'm1')).toEqual([
      { machineId: 'm1', date: SAT, prev: { name: 'A', ts: 't1' } },
    ]);
    expect(d.bookings.m1?.[SAT]).toBeUndefined(); // mutated in place
  });
  it('removes an orphaned Sunday (missing Friday)', () => {
    const d = data({ m1: { [SUN]: { name: 'A' }, [MON]: { name: 'A' } } });
    expect(sweepWeekends(d, 'm1')).toEqual([{ machineId: 'm1', date: SUN, prev: { name: 'A' } }]);
    expect(d.bookings.m1?.[SUN]).toBeUndefined();
  });
  it('leaves weekdays untouched', () => {
    const d = data({ m1: { [FRI]: { name: 'A' } } });
    expect(sweepWeekends(d, 'm1')).toEqual([]);
    expect(d.bookings.m1?.[FRI]).toBeDefined();
  });
  it('returns [] for a machine with no bookings', () => {
    expect(sweepWeekends(data({ m1: {} }), 'unknown')).toEqual([]);
  });
});
