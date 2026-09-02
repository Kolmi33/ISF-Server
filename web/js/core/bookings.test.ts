import { describe, it, expect } from 'vitest';
import type { Booking, Bookings, BookingData, Machine } from '../../../shared/types.ts';
import {
  getBooking,
  findSameNameWorkdayRun,
  findBookingGroup,
  bookCells,
  deleteCells,
  deleteOwnCells,
  deleteSelectedCells,
  deleteGroup,
} from './bookings.ts';

// Moved here from ui/grid.test.ts when getBooking moved out of ui/grid.ts (a rendering
// module) into this file, its actual home as a plain booking lookup (ARCHITECTURE_AUDIT.md F6).
describe('getBooking', () => {
  const bk: Booking = { name: 'anna' };

  it('returns the booking when the cell is occupied', () => {
    const bookings = { m1: { '2021-01-04': bk } };
    expect(getBooking(bookings, 'm1', '2021-01-04')).toBe(bk);
  });
  it('is undefined for an unknown machine or an empty day', () => {
    expect(getBooking({}, 'm1', '2021-01-04')).toBeUndefined();
    expect(getBooking({ m1: {} }, 'm1', '2021-01-04')).toBeUndefined();
  });
});

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
  it('aborts with the conflict list when a day is already booked', () => {
    const d = data([M()], { m1: { '2021-01-04': { name: 'Bob' } } });
    const res = bookCells(d, ['m1'], ['2021-01-04'], opts());
    expect(res.abort).toBe(true);
    expect(res.conflicts).toEqual([{ machineId: 'm1', date: '2021-01-04', by: 'Bob' }]);
    expect(d.bookings.m1!['2021-01-04']!.name).toBe('Bob'); // nothing written
  });

  it('reports blocked days as gesperrt with the slot type', () => {
    const d = data([M({ maint: [{ type: 'defekt', from: '2021-01-01', until: '2021-12-31' }] })]);
    const res = bookCells(d, ['m1'], ['2021-01-04'], opts());
    expect(res.conflicts).toEqual([
      { machineId: 'm1', date: '2021-01-04', by: 'gesperrt (defekt)' },
    ]);
  });

  it('falls back to "Wartung" when the blocking slot has an empty type', () => {
    const d = data([M({ maint: [{ type: '', from: '2021-01-01', until: '2021-12-31' }] })]);
    const res = bookCells(d, ['m1'], ['2021-01-04'], opts());
    expect(res.conflicts![0]!.by).toBe('gesperrt (Wartung)');
  });

  it('skips machines absent from the fresh data and unavailable weekdays', () => {
    // m1 unavailable Mondays (mask Mo=0); ghost id has no machine → both produce no conflict
    const d = data([M({ days: '0111100' })]);
    const res = bookCells(d, ['m1', 'ghost'], ['2021-01-04'], opts());
    expect(res.conflicts).toBeUndefined();
    expect(res.count).toBe(0); // Monday unavailable → not booked
  });

  it('books free days and skips conflicts when skipConflicts is set', () => {
    const d = data([M()], { m1: { '2021-01-04': { name: 'Bob' } } });
    const res = bookCells(d, ['m1'], ['2021-01-04', '2021-01-05'], opts({ skipConflicts: true }));
    expect(res.count).toBe(1);
    expect(d.bookings.m1!['2021-01-05']!.name).toBe('Alice');
    expect(d.bookings.m1!['2021-01-04']!.name).toBe('Bob'); // conflict untouched
  });
});

describe('bookCells — apply', () => {
  it('books a single free cell without a group id', () => {
    const d = data([M()]);
    const res = bookCells(d, ['m1'], ['2021-01-04'], opts({ note: 'hi' }));
    expect(res.count).toBe(1);
    expect(res.undo).toEqual([{ machineId: 'm1', date: '2021-01-04', prev: null }]);
    expect(d.bookings.m1!['2021-01-04']).toEqual({ name: 'Alice', note: 'hi', ts: TS });
  });

  it('assigns a shared gid across multiple days (no title → no gtitle)', () => {
    const d = data([M()]);
    bookCells(d, ['m1'], ['2021-01-04', '2021-01-05'], opts());
    expect(d.bookings.m1!['2021-01-04']!.gid).toBe('g_fixed');
    expect(d.bookings.m1!['2021-01-05']!.gid).toBe('g_fixed');
    expect(d.bookings.m1!['2021-01-04']!.gtitle).toBeUndefined();
  });

  it('carries the title as gtitle when a single cell is titled (title forces a group)', () => {
    const d = data([M()]);
    bookCells(d, ['m1'], ['2021-01-04'], opts({ title: 'Projekt X' }));
    expect(d.bookings.m1!['2021-01-04']!.gid).toBe('g_fixed');
    expect(d.bookings.m1!['2021-01-04']!.gtitle).toBe('Projekt X');
  });

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

describe('deleteCells', () => {
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

  it('is a no-op (n=0) when the machine has no bookings bucket', () => {
    const d = data([M()]);
    const res = deleteCells(d, 'm1', 'Alice', ['2021-01-04']);
    expect(res).toEqual({ deletedCount: 0, undo: [] });
  });

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
  it('deletes the user’s own days case-insensitively and skips others', () => {
    const d = data([M()], {
      m1: { '2021-01-04': { name: 'Alice' }, '2021-01-05': { name: 'Bob' } },
    });
    const res = deleteOwnCells(d, 'm1', 'ALICE', ['2021-01-04', '2021-01-05']);
    expect(res.deletedCount).toBe(1);
    expect(d.bookings.m1!['2021-01-04']).toBeUndefined();
    expect(d.bookings.m1!['2021-01-05']!.name).toBe('Bob'); // not the user
  });

  it('is a no-op when the machine has no bookings bucket', () => {
    expect(deleteOwnCells(data([M()]), 'm1', 'Alice', ['2021-01-04'])).toEqual({
      deletedCount: 0,
      undo: [],
    });
  });

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
