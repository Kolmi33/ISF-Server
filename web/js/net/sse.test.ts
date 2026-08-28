import { describe, it, expect } from 'vitest';
import type { Bookings } from '../../../shared/types.ts';
import { applyUpdate, presenceInfo, isForeign } from './sse.ts';

describe('applyUpdate', () => {
  it('sets cells for truthy vals and reports the patch', () => {
    const bookings: Bookings = {};
    const res = applyUpdate(
      { rev: 24, changes: [{ mid: 'M1', day: '2021-01-11', val: { name: 'anna' } }] },
      bookings,
    );
    expect(bookings.M1!['2021-01-11']).toEqual({ name: 'anna' });
    expect(res).toEqual({ rev: 24, patch: [{ mid: 'M1', date: '2021-01-11' }] });
  });

  it('deletes cells for falsy vals, leaving other days intact', () => {
    const bookings: Bookings = {
      M1: { '2021-01-11': { name: 'anna' }, '2021-01-12': { name: 'b' } },
    };
    const res = applyUpdate({ changes: [{ mid: 'M1', day: '2021-01-11', val: null }] }, bookings);
    expect(bookings.M1!['2021-01-11']).toBeUndefined();
    expect(bookings.M1!['2021-01-12']).toEqual({ name: 'b' });
    expect(res.patch).toEqual([{ mid: 'M1', date: '2021-01-11' }]);
  });

  it('creates the machine row on first change and handles multiple changes', () => {
    const bookings: Bookings = {};
    const res = applyUpdate(
      {
        changes: [
          { mid: 'M1', day: 'd1', val: { name: 'x' } },
          { mid: 'M2', day: 'd2', val: { name: 'y' } },
        ],
      },
      bookings,
    );
    expect(bookings.M1!.d1).toEqual({ name: 'x' });
    expect(bookings.M2!.d2).toEqual({ name: 'y' });
    expect(res.patch).toHaveLength(2);
  });

  it('returns rev=null when the event carries no numeric rev, and empty patch for no changes', () => {
    const bookings: Bookings = {};
    expect(applyUpdate({}, bookings)).toEqual({ rev: null, patch: [] });
    expect(applyUpdate({ rev: 0, changes: [] }, bookings).rev).toBe(0); // 0 is numeric → adopted
  });
});

describe('presenceInfo', () => {
  it('formats a non-empty list', () => {
    expect(presenceInfo(['anna', 'bob'])).toEqual({
      list: ['anna', 'bob'],
      count: '2',
      label: 'Gerade aktiv: anna, bob',
    });
  });
  it('drops falsy entries', () => {
    expect(presenceInfo(['anna', '', null, undefined, 'bob']).list).toEqual(['anna', 'bob']);
  });
  it('uses the dash badge and "Niemand aktiv" when empty or undefined', () => {
    expect(presenceInfo([])).toEqual({ list: [], count: '–', label: 'Niemand aktiv' });
    expect(presenceInfo(undefined)).toEqual({ list: [], count: '–', label: 'Niemand aktiv' });
  });
});

describe('isForeign', () => {
  it('is true only for a present author different from me (case-insensitive)', () => {
    expect(isForeign('Bob', 'anna')).toBe(true);
    expect(isForeign('ANNA', 'anna')).toBe(false); // same person, different case
    expect(isForeign('', 'anna')).toBe(false); // no author
    expect(isForeign(undefined, 'anna')).toBe(false);
  });
});
