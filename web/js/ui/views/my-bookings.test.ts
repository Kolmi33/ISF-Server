import { describe, it, expect } from 'vitest';
import type { Machine, Bookings } from '../../../../shared/types.ts';
import { computeMyRuns, filterMyRuns, type BookingRun } from './my-bookings.ts';

const mach = (id: string): Machine => ({ id, name: id.toUpperCase(), group: 'g' });
const m1 = mach('m1');
const m2 = mach('m2');
const bk = (name: string) => ({ name });

// Anchors (TZ=UTC pinned): 2021-01-04 Mon … 08 Fri, 09 Sat, 10 Sun, 11 Mon.
const today = '2021-01-04';

describe('computeMyRuns', () => {
  // What: consecutive booked workdays group into one run, and a genuine gap (a missing day,
  // not a weekend) starts a new run.
  // How: books three days with a one-day gap in the middle and checks the result splits into
  // two runs at that gap.
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
      { machine: m1, dates: ['2021-01-04', '2021-01-05'], ts: '' },
      { machine: m1, dates: ['2021-01-07'], ts: '' },
    ]);
  });

  // What: a Friday followed by the next Monday counts as one continuous run — the weekend
  // gap between them doesn't split it, since the weekend was never bookable in the first place.
  // How: books a Friday and the following Monday only and checks they form a single run.
  it('treats Fri→Mon as one run (weekend skipped)', () => {
    const bookings: Bookings = { m1: { '2021-01-08': bk('anna'), '2021-01-11': bk('anna') } };
    const runs = computeMyRuns([m1], bookings, 'anna', today);
    expect(runs).toEqual([{ machine: m1, dates: ['2021-01-08', '2021-01-11'], ts: '' }]);
  });

  // What: only future workdays booked by THIS user (matched case-insensitively) count — past
  // days, weekend bookings, and other people's bookings are all excluded.
  // How: seeds one booking of each excluded kind plus one legitimately-matching (different
  // case) booking, and checks only the matching one survives.
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
    expect(runs).toEqual([{ machine: m1, dates: ['2021-01-05'], ts: '' }]);
  });

  // What: runs from different machines are all merged into one list, sorted by each run's own
  // first date — not grouped by machine first.
  // How: books runs on two machines with interleaved dates and checks the result is ordered
  // purely by date, crossing back and forth between machines.
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

  // What: a machine with no matching bookings at all — whether it has an empty bookings
  // bucket or no bucket at all — yields no runs.
  // How: checks both an explicitly-empty bookings object and a completely absent entry for
  // the machine both produce an empty result.
  it('is empty when the machine has no matching bookings', () => {
    expect(computeMyRuns([m1], { m1: {} }, 'anna', today)).toEqual([]);
    expect(computeMyRuns([m1], {}, 'anna', today)).toEqual([]); // no entry for the machine
  });

  // What: a run's `ts` is the earliest creation timestamp among its days (blank/missing
  // timestamps don't count), mirroring `computeAllRuns`'s identical rule.
  // How: books two consecutive days with out-of-order timestamps and checks the run reports
  // the earlier one.
  it('carries the earliest creation timestamp of a run (blanks ignored)', () => {
    const bookings: Bookings = {
      m1: {
        '2021-01-04': { name: 'anna', ts: '2021-01-03T10:00' },
        '2021-01-05': { name: 'anna', ts: '2021-01-02T09:00' }, // earlier → run ts
      },
    };
    expect(computeMyRuns([m1], bookings, 'anna', today)[0]!.ts).toBe('2021-01-02T09:00');
  });

  // What: a run whose first day carries a booking-group id/title is detected as grouped —
  // the id/title of that first day, so a caller can look up the full group (across whatever
  // other machines it also spans) via `core/bookings.ts`'s `findBookingGroup`.
  // How: books a run whose first day has a gid/gtitle and checks both come through on the run.
  it("detects a booking group from the run's first day", () => {
    const bookings: Bookings = {
      m1: {
        '2021-01-04': { name: 'anna', gid: 'g1', gtitle: 'Projekt X' },
        '2021-01-05': { name: 'anna', gid: 'g1' },
      },
    };
    const run = computeMyRuns([m1], bookings, 'anna', today)[0]!;
    expect(run.groupId).toBe('g1');
    expect(run.groupTitle).toBe('Projekt X');
  });

  // What: a plain, ungrouped run reports no group id/title at all.
  // How: books a run with no gid and checks both fields are undefined.
  it('reports no group for a plain (ungrouped) run', () => {
    const run = computeMyRuns([m1], { m1: { '2021-01-04': bk('anna') } }, 'anna', today)[0]!;
    expect(run.groupId).toBeUndefined();
    expect(run.groupTitle).toBeUndefined();
  });
});

describe('filterMyRuns', () => {
  const mA: Machine = { id: 'a', name: 'Fräse', group: 'Halle' };
  const mB: Machine = { id: 'b', name: 'Presse', group: 'Labor' };
  const A: BookingRun = { machine: mA, dates: ['2021-01-04', '2021-01-05'], ts: '2021-01-03' };
  const B: BookingRun = { machine: mB, dates: ['2021-01-10'], ts: '2021-01-01' };
  const all = [A, B];
  const base: Parameters<typeof filterMyRuns>[1] = {
    mach: '',
    group: '',
    from: '',
    to: '',
    sort: 'termin',
  };
  const ids = (runs: BookingRun[]) => runs.map((r) => r.machine.id);

  // What: with every filter field empty, all runs pass through, sorted by the default
  // 'termin' (date) key.
  // How: calls with the base (all-empty) filter and checks both runs come back in date order.
  it('passes everything through with empty filters (default termin sort)', () => {
    expect(ids(filterMyRuns(all, base))).toEqual(['a', 'b']);
  });

  // What: the machine-name filter matches a case-insensitive substring.
  // How: checks a partial, differently-cased match finds only that one machine's run.
  it('filters by machine name (case-insensitive substring)', () => {
    expect(ids(filterMyRuns(all, { ...base, mach: 'frä' }))).toEqual(['a']);
  });

  // What: the Bereich filter matches an exact department group, and (via the shared "cat:"
  // encoding) a whole category too — same rule `filterAllRuns` uses.
  // How: filters by an exact group name, then by a category prefix covering both machines.
  it('filters by an exact group, and by a whole category via the "cat:" prefix', () => {
    expect(ids(filterMyRuns(all, { ...base, group: 'Labor' }))).toEqual(['b']);
    expect(ids(filterMyRuns(all, { ...base, group: 'cat:maschine' }))).toEqual(['a', 'b']); // neither machine sets cat, both default to 'maschine'
  });

  // What: the date-window filter keeps a run when it overlaps [from, to].
  // How: checks a late `from` only catches the run reaching that far.
  it('keeps runs overlapping the [from, to] window', () => {
    expect(ids(filterMyRuns(all, { ...base, from: '2021-01-08' }))).toEqual(['b']);
  });

  // What: each sort key (minus 'person', which doesn't exist here) produces the expected order.
  // How: applies 'maschine', 'bereich', and 'erstellt' to the two-run fixture.
  it('applies each sort key', () => {
    expect(ids(filterMyRuns(all, { ...base, sort: 'maschine' }))).toEqual(['a', 'b']); // Fräse, Presse
    expect(ids(filterMyRuns(all, { ...base, sort: 'bereich' }))).toEqual(['a', 'b']); // Halle, Labor
    expect(ids(filterMyRuns(all, { ...base, sort: 'erstellt' }))).toEqual(['a', 'b']); // ts desc
  });

  // What: an unrecognized sort key falls back to 'termin' rather than throwing.
  // How: passes a nonsense sort string and checks the result still matches termin order.
  it('falls back to termin for an unknown sort key', () => {
    expect(ids(filterMyRuns(all, { ...base, sort: 'nonsense' }))).toEqual(['a', 'b']);
  });
});
