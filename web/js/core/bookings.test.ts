import { describe, it, expect } from 'vitest';
import type { Booking, Bookings, BookingData, Machine } from '../../../shared/types.ts';
import {
  getBooking,
  findSameNameWorkdayRun,
  findBookingGroup,
  bookCells,
  sweepWeekends,
  deleteCells,
  deleteOwnCells,
  deleteSelectedCells,
  deleteGroup,
} from './bookings.ts';

// Moved here from ui/grid.test.ts when getBooking moved out of ui/grid.ts (a rendering
// module) into this file, its actual home as a plain booking lookup (ARCHITECTURE_AUDIT.md F6).
describe('getBooking', () => {
  const bk: Booking = { name: 'anna' };

  // What: getBooking returns the exact booking object stored at a machine/date cell.
  // How: builds a bookings map with one cell and checks the lookup returns that same reference.
  it('returns the booking when the cell is occupied', () => {
    const bookings = { m1: { '2021-01-04': bk } };
    expect(getBooking(bookings, 'm1', '2021-01-04')).toBe(bk);
  });
  // What: an unknown machine id or a free day both look up as undefined, not an error.
  // How: checks an empty bookings map and a machine present but with no cells for that day.
  it('is undefined for an unknown machine or an empty day', () => {
    expect(getBooking({}, 'm1', '2021-01-04')).toBeUndefined();
    expect(getBooking({ m1: {} }, 'm1', '2021-01-04')).toBeUndefined();
  });
});

describe('findSameNameWorkdayRun', () => {
  // What: with no adjacent same-name bookings, the run is just the one date given.
  // How: books a single Wednesday and checks the run is that one date alone.
  it('is just the one date when neighbors are empty', () => {
    const bookings: Bookings = { m1: { '2021-01-06': { name: 'anna' } } }; // a Wednesday
    expect(findSameNameWorkdayRun(bookings, 'm1', '2021-01-06', 'anna')).toEqual(['2021-01-06']);
  });

  // What: the run extends in both directions across consecutive same-name workdays.
  // How: books four consecutive weekdays under the same name, starts the search from the
  // middle day, and checks the run covers all four in order.
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

  // What: a different booker's name or a free day both break the run, so it doesn't extend past them.
  // How: places a different-name day before and a free (unbooked) day after the search date,
  // and checks the run stops at just that one date.
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

  // What: a weekend gap between two same-name workdays doesn't break the run (Fri and the
  // following Mon count as adjacent, since the weekend was never bookable in the first place).
  // How: books a Friday and the following Monday only (no weekend cells at all) and checks
  // the run spans both.
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

  // What: a machine with no bookings at all still yields a valid one-date run, not a crash.
  // How: calls with an empty bookings map and checks the result is just the search date.
  it('treats a machine with no bookings at all as an empty neighborhood', () => {
    expect(findSameNameWorkdayRun({}, 'm1', '2021-01-06', 'anna')).toEqual(['2021-01-06']);
  });
});

describe('findBookingGroup', () => {
  // What: collects every cell sharing one gid across multiple machines, sorted by date, and
  // excludes cells with a different gid even on the same machine.
  // How: spreads three cells with gid 'g1' across two machines (out of date order) plus one
  // decoy cell with a different gid, then checks the collected machine ids and sorted dates.
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

  // What: a gid nothing belongs to yields an empty group, not an error.
  // How: looks up a gid that doesn't appear anywhere in the bookings map.
  it('is empty for a gid nothing belongs to', () => {
    const group = findBookingGroup({ m1: { '2021-01-04': { name: 'anna' } } }, 'nope');
    expect(group.machineIds.size).toBe(0);
    expect(group.dates).toEqual([]);
  });
});

// Deterministic anchors (TZ=UTC): 2021-01-04 Mon … 08 Fri, 09 Sat, 10 Sun, 11 Mon.
const TS = '2021-01-04T10:00:00.000Z';
const gid = () => 'g_fixed';

function data(machines: Machine[], bookings: BookingData['bookings'] = {}): BookingData {
  return { machines, bookings };
}
const M = (over: Partial<Machine> = {}): Machine => ({ id: 'm1', name: 'M1', group: 'A', ...over });
const opts = (over: Partial<Parameters<typeof bookCells>[3]> = {}) => ({
  name: 'Alice',
  note: '',
  title: '',
  skipConflicts: false,
  ts: TS,
  newGid: gid,
  ...over,
});

describe('bookCells — conflicts', () => {
  // What: booking an already-taken day aborts the whole call and writes nothing.
  // How: pre-books a day under a different name, attempts to book it, and checks both the
  // conflict list and that the original booking is untouched.
  it('aborts with the conflict list when a day is already booked', () => {
    const d = data([M()], { m1: { '2021-01-04': { name: 'Bob' } } });
    const res = bookCells(d, ['m1'], ['2021-01-04'], opts());
    expect(res.abort).toBe(true);
    expect(res.conflicts).toEqual([{ machineId: 'm1', date: '2021-01-04', by: 'Bob' }]);
    expect(d.bookings.m1!['2021-01-04']!.name).toBe('Bob'); // nothing written
  });

  // What: a day blocked by maintenance/defect is reported as a conflict labeled with the slot type.
  // How: gives the machine a 'defekt' maintenance slot covering the target date and checks the
  // conflict's `by` text names that reason.
  it('reports blocked days as gesperrt with the slot type', () => {
    const d = data([M({ maint: [{ type: 'defekt', from: '2021-01-01', until: '2021-12-31' }] })]);
    const res = bookCells(d, ['m1'], ['2021-01-04'], opts());
    expect(res.conflicts).toEqual([
      { machineId: 'm1', date: '2021-01-04', by: 'gesperrt (defekt)' },
    ]);
  });

  // What: a blocking slot with no `type` set still produces a readable conflict, defaulting
  // its label to "Wartung" rather than showing a blank reason.
  // How: gives the machine a maintenance slot with an empty-string type and checks the fallback label.
  it('falls back to "Wartung" when the blocking slot has an empty type', () => {
    const d = data([M({ maint: [{ type: '', from: '2021-01-01', until: '2021-12-31' }] })]);
    const res = bookCells(d, ['m1'], ['2021-01-04'], opts());
    expect(res.conflicts![0]!.by).toBe('gesperrt (Wartung)');
  });

  // What: a machine id absent from the fresh data, and a weekday the machine doesn't work,
  // are both silently skipped — neither counts as a conflict nor gets booked.
  // How: gives the one real machine a days-mask with Monday off, requests both it and a
  // nonexistent 'ghost' id for a Monday, and checks no conflicts and nothing booked.
  it('skips machines absent from the fresh data and unavailable weekdays', () => {
    // m1 unavailable Mondays (mask Mo=0); ghost id has no machine → both produce no conflict
    const d = data([M({ days: '0111100' })]);
    const res = bookCells(d, ['m1', 'ghost'], ['2021-01-04'], opts());
    expect(res.conflicts).toBeUndefined();
    expect(res.count).toBe(0); // Monday unavailable → not booked
  });

  // What: with skipConflicts on, free days still get booked while conflicting ones are left alone.
  // How: pre-books one day under a different name, requests that day plus a free one with
  // skipConflicts:true, and checks only the free day was written.
  it('books free days and skips conflicts when skipConflicts is set', () => {
    const d = data([M()], { m1: { '2021-01-04': { name: 'Bob' } } });
    const res = bookCells(d, ['m1'], ['2021-01-04', '2021-01-05'], opts({ skipConflicts: true }));
    expect(res.count).toBe(1);
    expect(d.bookings.m1!['2021-01-05']!.name).toBe('Alice');
    expect(d.bookings.m1!['2021-01-04']!.name).toBe('Bob'); // conflict untouched
  });
});

describe('bookCells — apply', () => {
  // What: even one machine on one day is represented as a one-member booking group.
  // How: books a single free cell and checks its generated gid plus the remaining metadata.
  it('books a single free cell as a booking group', () => {
    const d = data([M()]);
    const res = bookCells(d, ['m1'], ['2021-01-04'], opts({ note: 'hi' }));
    expect(res.count).toBe(1);
    expect(res.undo).toEqual([{ machineId: 'm1', date: '2021-01-04', prev: null }]);
    expect(d.bookings.m1!['2021-01-04']).toEqual({
      name: 'Alice',
      note: 'hi',
      ts: TS,
      gid: 'g_fixed',
    });
  });

  // What: booking more than one day forms a group (shared gid), but with no title given the
  // cells don't carry a group title.
  // How: books two days on one machine with no title and checks both cells share the same
  // injected gid while gtitle stays unset.
  it('assigns a shared gid across multiple days (no title → no gtitle)', () => {
    const d = data([M()]);
    bookCells(d, ['m1'], ['2021-01-04', '2021-01-05'], opts());
    expect(d.bookings.m1!['2021-01-04']!.gid).toBe('g_fixed');
    expect(d.bookings.m1!['2021-01-05']!.gid).toBe('g_fixed');
    expect(d.bookings.m1!['2021-01-04']!.gtitle).toBeUndefined();
  });

  // What: an explicit title is stored as the group's display title.
  // How: books exactly one day with a title and checks the cell got both gid and gtitle.
  it('carries the title as gtitle when a single-cell group is titled', () => {
    const d = data([M()]);
    bookCells(d, ['m1'], ['2021-01-04'], opts({ title: 'Projekt X' }));
    expect(d.bookings.m1!['2021-01-04']!.gid).toBe('g_fixed');
    expect(d.bookings.m1!['2021-01-04']!.gtitle).toBe('Projekt X');
  });

  // What: booking across several machines at once creates each machine's bookings bucket on
  // demand and independently skips whichever of blocked/already-booked/unavailable applies to it.
  // How: sets up three machines (one free, one under maintenance, one only there as a decoy)
  // plus a nonexistent id, requests two days with skipConflicts, and checks only the one
  // genuinely free cell was written while the blocked machine's bucket exists but stays empty.
  it('creates the per-machine bookings bucket, skips blocked/booked/unavailable', () => {
    const d = data(
      [
        M({ id: 'm1' }),
        M({ id: 'm2', maint: [{ type: 'wartung', from: '2021-01-01', until: '2021-12-31' }] }),
        M({ id: 'ghost-skip' }), // present, but we pass a non-existent id below
      ],
      { m1: { '2021-01-05': { name: 'Bob' } } },
    );
    const res = bookCells(
      d,
      ['m1', 'm2', 'nope'],
      ['2021-01-04', '2021-01-05'],
      opts({ skipConflicts: true }),
    );
    // m1: 04 free (booked), 05 already Bob (skip); m2: both blocked (skip); nope: no machine
    expect(res.count).toBe(1);
    expect(d.bookings.m1!['2021-01-04']!.name).toBe('Alice');
    expect(d.bookings.m2).toEqual({}); // bucket created, nothing written
  });
});

// Anchor series for the weekend-bridge tests below: 2021-01-08 Fri, -09 Sat, -10 Sun, -11 Mon.
const BRIDGE_FRI = '2021-01-08';
const BRIDGE_SAT = '2021-01-09';
const BRIDGE_SUN = '2021-01-10';
const BRIDGE_MON = '2021-01-11';

// Merged from the former weekend.ts/weekend.test.ts (PRINCIPLES.md E10 — sweepWeekends has
// no consumer outside this file's own delete reducers, so it moved in with them).
describe('sweepWeekends', () => {
  // What: a Saturday booked with both its Friday and Monday also booked stays — the bridge holds.
  // How: books Fri/Sat/Mon (Sunday left free) and checks sweepWeekends removes nothing and the
  // Saturday cell is still there.
  it('keeps a weekend day that is bridged on both sides', () => {
    const d = data([M()], {
      m1: { [BRIDGE_FRI]: { name: 'A' }, [BRIDGE_SAT]: { name: 'A' }, [BRIDGE_MON]: { name: 'A' } },
    });
    expect(sweepWeekends(d, 'm1')).toEqual([]);
    expect(d.bookings.m1?.[BRIDGE_SAT]).toBeDefined();
  });
  // What: the same bridging rule holds for Sunday, not just Saturday.
  // How: books Fri/Sun/Mon (Saturday left free) and checks the Sunday cell survives the sweep.
  it('keeps a bridged Sunday too (Fri before + Mon after)', () => {
    const d = data([M()], {
      m1: { [BRIDGE_FRI]: { name: 'A' }, [BRIDGE_SUN]: { name: 'A' }, [BRIDGE_MON]: { name: 'A' } },
    });
    expect(sweepWeekends(d, 'm1')).toEqual([]);
    expect(d.bookings.m1?.[BRIDGE_SUN]).toBeDefined();
  });
  // What: a Saturday with no bridging Friday/Monday booked is removed, and its prior value is
  // captured in the returned undo record.
  // How: books only the Saturday (with a ts, to check it round-trips into the undo record) and
  // checks both the returned undo entry and that the cell is gone afterward.
  it('removes an orphaned Saturday and returns its undo record', () => {
    const d = data([M()], { m1: { [BRIDGE_SAT]: { name: 'A', ts: 't1' } } });
    expect(sweepWeekends(d, 'm1')).toEqual([
      { machineId: 'm1', date: BRIDGE_SAT, prev: { name: 'A', ts: 't1' } },
    ]);
    expect(d.bookings.m1?.[BRIDGE_SAT]).toBeUndefined(); // mutated in place
  });
  // What: a Sunday missing its bridging Friday (even with Monday booked) is also removed —
  // both bridging days must hold, not just one.
  // How: books Sunday and Monday but not Friday, and checks the Sunday cell is swept.
  it('removes an orphaned Sunday (missing Friday)', () => {
    const d = data([M()], { m1: { [BRIDGE_SUN]: { name: 'A' }, [BRIDGE_MON]: { name: 'A' } } });
    expect(sweepWeekends(d, 'm1')).toEqual([
      { machineId: 'm1', date: BRIDGE_SUN, prev: { name: 'A' } },
    ]);
    expect(d.bookings.m1?.[BRIDGE_SUN]).toBeUndefined();
  });
  // What: an ordinary weekday booking is never touched by the weekend sweep, even though it
  // has no bridging days either (the rule only ever applies to Sat/Sun).
  // How: books only a Friday (a weekday) and checks the sweep leaves it in place.
  it('leaves weekdays untouched', () => {
    const d = data([M()], { m1: { [BRIDGE_FRI]: { name: 'A' } } });
    expect(sweepWeekends(d, 'm1')).toEqual([]);
    expect(d.bookings.m1?.[BRIDGE_FRI]).toBeDefined();
  });
  // What: a machine with no bookings bucket at all sweeps cleanly to an empty result, not a crash.
  // How: calls sweepWeekends with a machine id that has no entry in the bookings map.
  it('returns [] for a machine with no bookings', () => {
    expect(sweepWeekends(data([M()], { m1: {} }), 'unknown')).toEqual([]);
  });
});

describe('deleteCells', () => {
  // What: deleting only removes cells that match both the given dates AND the given name,
  // leaving a different owner's cell on the same machine untouched.
  // How: books one day under 'Alice' and another under 'Bob', deletes both dates as 'Alice',
  // and checks only the Alice day was removed (with its previous value in the undo record).
  it('deletes matching-name days and returns undo with the previous value', () => {
    const d = data([M()], {
      m1: { '2021-01-04': { name: 'Alice', ts: TS }, '2021-01-05': { name: 'Bob' } },
    });
    const res = deleteCells(d, 'm1', 'Alice', ['2021-01-04', '2021-01-05']);
    expect(res.deletedCount).toBe(1); // only the Alice day
    expect(res.undo).toContainEqual({
      machineId: 'm1',
      date: '2021-01-04',
      prev: { name: 'Alice', ts: TS },
    });
    expect(d.bookings.m1!['2021-01-04']).toBeUndefined();
    expect(d.bookings.m1!['2021-01-05']!.name).toBe('Bob'); // other owner untouched
  });

  // What: deleting from a machine with no bookings bucket at all is a clean no-op, not an error.
  // How: calls deleteCells on a machine with an empty bookings map and checks a zero-count,
  // empty-undo result.
  it('is a no-op (n=0) when the machine has no bookings bucket', () => {
    const d = data([M()]);
    const res = deleteCells(d, 'm1', 'Alice', ['2021-01-04']);
    expect(res).toEqual({ deletedCount: 0, undo: [] });
  });

  // What: deleting a Friday/Monday bridge endpoint also sweeps the now-orphaned Sat/Sun days,
  // and the swept days show up in the same undo record as the direct delete.
  // How: books a full Fri..Mon series by one person, deletes just the Monday, and checks the
  // weekend days are gone too and all three dates appear in the combined undo list.
  it('sweeps the weekend bridge day orphaned by the delete', () => {
    // Fri..Mon series by Alice; delete Monday → Sat+Sun lose the bridge and are swept.
    const d = data([M()], {
      m1: {
        '2021-01-08': { name: 'Alice' }, // Fri
        '2021-01-09': { name: 'Alice' }, // Sat (bridge)
        '2021-01-10': { name: 'Alice' }, // Sun (bridge)
        '2021-01-11': { name: 'Alice' }, // Mon
      },
    });
    const res = deleteCells(d, 'm1', 'Alice', ['2021-01-11']);
    expect(res.deletedCount).toBe(1);
    expect(d.bookings.m1!['2021-01-09']).toBeUndefined(); // Sat swept
    expect(d.bookings.m1!['2021-01-10']).toBeUndefined(); // Sun swept
    expect(res.undo.map((u) => u.date).sort()).toEqual(['2021-01-09', '2021-01-10', '2021-01-11']);
  });
});

describe('deleteOwnCells', () => {
  // What: matches the given user's name case-insensitively, and skips a different person's cell.
  // How: books one day as 'Alice' and another as 'Bob', deletes as user 'ALICE' (different
  // case), and checks only the Alice day was removed.
  it('deletes the user’s own days case-insensitively and skips others', () => {
    const d = data([M()], {
      m1: { '2021-01-04': { name: 'Alice' }, '2021-01-05': { name: 'Bob' } },
    });
    const res = deleteOwnCells(d, 'm1', 'ALICE', ['2021-01-04', '2021-01-05']);
    expect(res.deletedCount).toBe(1);
    expect(d.bookings.m1!['2021-01-04']).toBeUndefined();
    expect(d.bookings.m1!['2021-01-05']!.name).toBe('Bob'); // not the user
  });

  // What: a machine with no bookings bucket at all is a clean no-op for the own-cells delete too.
  // How: calls deleteOwnCells on a machine with an empty bookings map.
  it('is a no-op when the machine has no bookings bucket', () => {
    expect(deleteOwnCells(data([M()]), 'm1', 'Alice', ['2021-01-04'])).toEqual({
      deletedCount: 0,
      undo: [],
    });
  });

  // What: deleteOwnCells also sweeps orphaned weekend bridge days, same as deleteCells.
  // How: books a full Fri..Mon series and deletes just the Monday as that same user, checking
  // the weekend days are swept along with it.
  it('sweeps orphaned bridge days after deleting the user’s Monday', () => {
    const d = data([M()], {
      m1: {
        '2021-01-08': { name: 'alice' },
        '2021-01-09': { name: 'alice' },
        '2021-01-10': { name: 'alice' },
        '2021-01-11': { name: 'alice' },
      },
    });
    const res = deleteOwnCells(d, 'm1', 'Alice', ['2021-01-11']);
    expect(res.deletedCount).toBe(1);
    expect(d.bookings.m1!['2021-01-09']).toBeUndefined();
    expect(d.bookings.m1!['2021-01-10']).toBeUndefined();
  });
});

describe('deleteSelectedCells', () => {
  // What: deletes exactly the cells listed, with no name check — anyone's booking goes, since
  // the caller already explicitly selected each one (a marquee-selection bulk delete).
  // How: selects one cell on each of two machines and checks both are removed regardless of
  // who booked them.
  it('deletes the listed cells unconditionally and sweeps the given machines', () => {
    const d = data([M({ id: 'm1' }), M({ id: 'm2' })], {
      m1: { '2021-01-04': { name: 'Alice' } },
      m2: { '2021-01-04': { name: 'Bob' } },
    });
    const res = deleteSelectedCells(
      d,
      [
        { machineId: 'm1', date: '2021-01-04' },
        { machineId: 'm2', date: '2021-01-04' },
      ],
      ['m1', 'm2'],
    );
    expect(res.deletedCount).toBe(2);
    expect(d.bookings.m1!['2021-01-04']).toBeUndefined();
    expect(d.bookings.m2!['2021-01-04']).toBeUndefined();
  });

  // What: a cell whose machine bucket doesn't exist, or whose day was never booked, is silently
  // skipped rather than counted or erroring.
  // How: selects three cells — one on a nonexistent machine, one on a real machine's unbooked
  // day, and one real booked cell — and checks only the real one was deleted.
  it('skips cells whose machine bucket or day is missing', () => {
    const d = data([M()], { m1: { '2021-01-04': { name: 'Alice' } } });
    const res = deleteSelectedCells(
      d,
      [
        { machineId: 'ghost', date: '2021-01-04' }, // no bucket
        { machineId: 'm1', date: '2021-01-05' }, // no such day
        { machineId: 'm1', date: '2021-01-04' }, // real
      ],
      ['m1'],
    );
    expect(res.deletedCount).toBe(1);
    expect(d.bookings.m1!['2021-01-04']).toBeUndefined();
  });
});

describe('deleteGroup', () => {
  // What: removes every cell sharing one gid across all machines, leaving cells from a
  // different group (even on the same machine) untouched.
  // How: spreads two 'g1' cells across two machines plus one decoy cell tagged 'other', deletes
  // group 'g1', and checks both g1 cells are gone while the decoy survives.
  it('removes every cell with the gid across all machines and sweeps affected ones', () => {
    const d = data([M({ id: 'm1' }), M({ id: 'm2' })], {
      m1: {
        '2021-01-04': { name: 'Alice', gid: 'g1' },
        '2021-01-05': { name: 'Alice', gid: 'other' },
      },
      m2: { '2021-01-04': { name: 'Alice', gid: 'g1' } },
    });
    const res = deleteGroup(d, 'g1');
    expect(res.deletedCount).toBe(2);
    expect(d.bookings.m1!['2021-01-04']).toBeUndefined();
    expect(d.bookings.m2!['2021-01-04']).toBeUndefined();
    expect(d.bookings.m1!['2021-01-05']!.gid).toBe('other'); // different group untouched
  });

  // What: deleting a group also sweeps weekend bridge days orphaned by removing one of its cells.
  // How: books a Fri..Mon series where only the Monday belongs to group 'g1', deletes that
  // group, and checks the now-orphaned Sat/Sun bridge days are swept too.
  it('sweeps weekend bridges orphaned by removing a group’s Monday', () => {
    const d = data([M()], {
      m1: {
        '2021-01-08': { name: 'Alice' }, // Fri (no gid)
        '2021-01-09': { name: 'Alice' }, // Sat
        '2021-01-10': { name: 'Alice' }, // Sun
        '2021-01-11': { name: 'Alice', gid: 'g1' }, // Mon (grouped)
      },
    });
    const res = deleteGroup(d, 'g1');
    expect(res.deletedCount).toBe(1);
    expect(d.bookings.m1!['2021-01-09']).toBeUndefined(); // Sat swept
    expect(d.bookings.m1!['2021-01-10']).toBeUndefined(); // Sun swept
  });
});
