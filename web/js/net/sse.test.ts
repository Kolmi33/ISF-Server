import { describe, it, expect } from 'vitest';
import type { Bookings } from '../../../shared/types.ts';
import { applyUpdate, presenceInfo, isForeign, formatDayMonth, remoteMessage } from './sse.ts';

describe('applyUpdate', () => {
  it('sets cells for truthy vals and reports the patch', () => {
    const bookings: Bookings = {};
    const res = applyUpdate(
      { rev: 24, changes: [{ machineId: 'M1', day: '2021-01-11', val: { name: 'anna' } }] },
      bookings,
    );
    expect(bookings.M1!['2021-01-11']).toEqual({ name: 'anna' });
    expect(res).toEqual({ rev: 24, patch: [{ machineId: 'M1', date: '2021-01-11' }] });
  });

  it('deletes cells for falsy vals, leaving other days intact', () => {
    const bookings: Bookings = {
      M1: { '2021-01-11': { name: 'anna' }, '2021-01-12': { name: 'b' } },
    };
    const res = applyUpdate(
      { changes: [{ machineId: 'M1', day: '2021-01-11', val: null }] },
      bookings,
    );
    expect(bookings.M1!['2021-01-11']).toBeUndefined();
    expect(bookings.M1!['2021-01-12']).toEqual({ name: 'b' });
    expect(res.patch).toEqual([{ machineId: 'M1', date: '2021-01-11' }]);
  });

  it('creates the machine row on first change and handles multiple changes', () => {
    const bookings: Bookings = {};
    const res = applyUpdate(
      {
        changes: [
          { machineId: 'M1', day: 'd1', val: { name: 'x' } },
          { machineId: 'M2', day: 'd2', val: { name: 'y' } },
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

describe('formatDayMonth', () => {
  it('abbreviates a plain ISO date to DD.MM.', () => {
    expect(formatDayMonth('2021-03-04')).toBe('04.03.');
  });
  it('falls back to the raw string for anything else', () => {
    expect(formatDayMonth('2021-03-04T10:00')).toBe('2021-03-04T10:00');
    expect(formatDayMonth('n/a')).toBe('n/a');
  });
});

describe('remoteMessage', () => {
  it('formats a booking action, with correct singular/plural machine count', () => {
    expect(
      remoteMessage({ user: 'bob', action: 'Buchung: Bob, 1 Maschine, 2021-01-04 bis 2021-01-04' }),
    ).toBe('Bob hat 1 Maschine gebucht (04.01.–04.01.)');
    expect(
      remoteMessage({
        user: 'bob',
        action: 'Buchung: Bob, 3 Maschinen, 2021-01-04 bis 2021-01-06',
      }),
    ).toBe('Bob hat 3 Maschinen gebucht (04.01.–06.01.)');
  });

  it('formats a delete action', () => {
    expect(remoteMessage({ user: 'bob', action: 'Gelöscht: Bob auf Fräse, 2 Tag(e)' })).toBe(
      'bob hat 2 Tag(e) von „Bob" auf Fräse gelöscht',
    );
  });

  it('formats an area-delete action, ignoring its details', () => {
    expect(remoteMessage({ user: 'bob', action: 'Bereich gelöscht: Halle 1' })).toBe(
      'bob hat einen Buchungsbereich gelöscht',
    );
  });

  it('formats a machine action verbatim, prefixed with the user', () => {
    expect(remoteMessage({ user: 'bob', action: 'Maschine angelegt: Fräse' })).toBe(
      'bob: Maschine angelegt: Fräse',
    );
  });

  it('falls back to "<user>: <action>" for anything unrecognized', () => {
    expect(remoteMessage({ user: 'bob', action: 'Reihenfolge geändert' })).toBe(
      'bob: Reihenfolge geändert',
    );
  });
});
