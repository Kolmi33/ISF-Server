import { describe, it, expect } from 'vitest';
import type { Bookings } from '../../../shared/types.ts';
import { applyUpdate, presenceInfo, isForeign, formatDayMonth, remoteMessage } from './sse.ts';

describe('applyUpdate', () => {
  // What: an SSE update event with a real cell value writes that cell into the bookings map
  // and reports it in the returned repaint patch.
  // How: applies one change with a truthy val and checks both the mutated bookings map and
  // the returned rev+patch shape.
  it('sets cells for truthy vals and reports the patch', () => {
    const bookings: Bookings = {};
    const res = applyUpdate(
      { rev: 24, changes: [{ machineId: 'M1', day: '2021-01-11', val: { name: 'anna' } }] },
      bookings,
    );
    expect(bookings.M1!['2021-01-11']).toEqual({ name: 'anna' });
    expect(res).toEqual({ rev: 24, patch: [{ machineId: 'M1', date: '2021-01-11' }] });
  });

  // What: a falsy val (a deletion event) removes that one cell, leaving the machine's other
  // booked days untouched.
  // How: pre-seeds two booked days on one machine, applies a delete change for one of them,
  // and checks that day is gone while the other survives.
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

  // What: applyUpdate creates a machine's bookings bucket on demand (no pre-existing entry
  // needed) and correctly handles several changes across different machines in one event.
  // How: applies two changes to two machines neither of which has an existing bookings
  // bucket, and checks both cells were written and the patch has two entries.
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

  // What: an event with no numeric `rev` reports rev:null rather than a wrong/guessed number
  // (so the caller knows not to adopt it), but a real numeric rev of 0 is still adopted (0 is
  // a valid revision, not "missing").
  // How: checks an empty event yields {rev: null, patch: []}, and an event with rev:0 and no
  // changes has its rev read back as 0, not null.
  it('returns rev=null when the event carries no numeric rev, and empty patch for no changes', () => {
    const bookings: Bookings = {};
    expect(applyUpdate({}, bookings)).toEqual({ rev: null, patch: [] });
    expect(applyUpdate({ rev: 0, changes: [] }, bookings).rev).toBe(0); // 0 is numeric → adopted
  });
});

describe('presenceInfo', () => {
  // What: a non-empty user list renders as a count string plus a German "currently active" label.
  // How: checks the exact list/count/label shape for two present users.
  it('formats a non-empty list', () => {
    expect(presenceInfo(['anna', 'bob'])).toEqual({
      list: ['anna', 'bob'],
      count: '2',
      label: 'Gerade aktiv: anna, bob',
    });
  });
  // What: empty-string, null, and undefined entries in the raw list are all filtered out
  // before building the presence display.
  // How: passes a list mixing real names with each of those three falsy forms and checks
  // only the real names survive.
  it('drops falsy entries', () => {
    expect(presenceInfo(['anna', '', null, undefined, 'bob']).list).toEqual(['anna', 'bob']);
  });
  // What: with nobody present (an empty list, or the list itself missing/undefined), the
  // badge shows a dash and the label reads "nobody active" rather than an empty string.
  // How: checks both an empty array and `undefined` produce the same dash/"Niemand aktiv" shape.
  it('uses the dash badge and "Niemand aktiv" when empty or undefined', () => {
    expect(presenceInfo([])).toEqual({ list: [], count: '–', label: 'Niemand aktiv' });
    expect(presenceInfo(undefined)).toEqual({ list: [], count: '–', label: 'Niemand aktiv' });
  });
});

describe('isForeign', () => {
  // What: a change is "foreign" (from someone else) only when an author name is present AND
  // doesn't match the local user, case-insensitively — the local user's own echoed changes,
  // and an author-less event, are never treated as foreign.
  // How: checks a different name (foreign), the same name in different case (not foreign,
  // since names are compared case-insensitively), an empty author, and an undefined author.
  it('is true only for a present author different from me (case-insensitive)', () => {
    expect(isForeign('Bob', 'anna')).toBe(true);
    expect(isForeign('ANNA', 'anna')).toBe(false); // same person, different case
    expect(isForeign('', 'anna')).toBe(false); // no author
    expect(isForeign(undefined, 'anna')).toBe(false);
  });
});

describe('formatDayMonth', () => {
  // What: a well-formed ISO date abbreviates to the German "DD.MM." short form.
  // How: checks a known ISO date formats to its expected short label.
  it('abbreviates a plain ISO date to DD.MM.', () => {
    expect(formatDayMonth('2021-03-04')).toBe('04.03.');
  });
  // What: anything that isn't a plain ISO date (a timestamp, an arbitrary string) is returned
  // unchanged rather than mis-parsed into a wrong label.
  // How: checks a full ISO timestamp and a non-date placeholder string both pass through as-is.
  it('falls back to the raw string for anything else', () => {
    expect(formatDayMonth('2021-03-04T10:00')).toBe('2021-03-04T10:00');
    expect(formatDayMonth('n/a')).toBe('n/a');
  });
});

describe('remoteMessage', () => {
  // What: a booking-action log line is turned into a German toast message, correctly
  // pluralizing "Maschine"/"Maschinen" based on the count embedded in the log text.
  // How: checks a 1-machine action uses the singular form and a 3-machine action uses the
  // plural, both with the date range rendered as short DD.MM. labels.
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

  // What: a delete-action log line renders as a distinct German sentence naming the day count
  // and the deleted owner's name.
  // How: checks a known delete log line's exact rendered message.
  it('formats a delete action', () => {
    expect(remoteMessage({ user: 'bob', action: 'Gelöscht: Bob auf Fräse, 2 Tag(e)' })).toBe(
      'bob hat 2 Tag(e) von „Bob" auf Fräse gelöscht',
    );
  });

  // What: an area-delete log line collapses to a generic "deleted a booking area" message,
  // deliberately dropping the specific area name from the log text.
  // How: checks a known area-delete log line's rendered message omits the area name entirely.
  it('formats an area-delete action, ignoring its details', () => {
    expect(remoteMessage({ user: 'bob', action: 'Bereich gelöscht: Halle 1' })).toBe(
      'bob hat einen Buchungsbereich gelöscht',
    );
  });

  // What: a machine-management action (create/edit/etc.) is shown verbatim, just prefixed
  // with who did it — no reformatting of the action text itself.
  // How: checks a "Maschine angelegt: ..." log line renders as "<user>: <that same text>".
  it('formats a machine action verbatim, prefixed with the user', () => {
    expect(remoteMessage({ user: 'bob', action: 'Maschine angelegt: Fräse' })).toBe(
      'bob: Maschine angelegt: Fräse',
    );
  });

  // What: any log action text that doesn't match a known pattern falls back to the same
  // generic "<user>: <action>" format, so an unrecognized message is still readable rather
  // than silently dropped.
  // How: checks an arbitrary action string ("Reihenfolge geändert") renders with the generic fallback.
  it('falls back to "<user>: <action>" for anything unrecognized', () => {
    expect(remoteMessage({ user: 'bob', action: 'Reihenfolge geändert' })).toBe(
      'bob: Reihenfolge geändert',
    );
  });
});
