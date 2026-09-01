import { describe, it, expect } from 'vitest';
import { openDb, setMeta, type Db } from './db.ts';
import {
  isBlocked,
  blockReason,
  isDayAvailable,
  machineOut,
  bookingOut,
  getState,
} from './model.ts';
import type { MachineRow } from './types.ts';

// A fresh in-memory DB per test (node:sqlite ':memory:').
function mem(): Db {
  return openDb(':memory:');
}

const ROW = (over: Partial<MachineRow> = {}): MachineRow => ({
  id: 'm1',
  name: 'M1',
  grp: 'A',
  cat: null,
  status: 'ok',
  statusNote: '',
  statusFrom: null,
  statusUntil: null,
  info: '',
  redu: null,
  days: null,
  maint: null,
  sort: 0,
  ...over,
});

function insertMachine(db: Db, r: MachineRow): void {
  db.prepare(
    `INSERT INTO machines(id,name,grp,cat,status,statusNote,statusFrom,statusUntil,info,redu,days,maint,sort)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    r.id,
    r.name,
    r.grp,
    r.cat,
    r.status,
    r.statusNote,
    r.statusFrom,
    r.statusUntil,
    r.info,
    r.redu,
    r.days,
    r.maint,
    r.sort,
  );
}

describe('isBlocked', () => {
  it('is false when status is ok or absent', () => {
    expect(isBlocked(ROW({ status: 'ok' }), '2021-06-01')).toBe(false);
    expect(isBlocked(ROW({ status: null }), '2021-06-01')).toBe(false);
  });
  it('is true within an open or bounded block window', () => {
    expect(isBlocked(ROW({ status: 'defekt' }), '2021-06-01')).toBe(true);
    expect(
      isBlocked(
        ROW({ status: 'wartung', statusFrom: '2021-05-01', statusUntil: '2021-06-30' }),
        '2021-06-01',
      ),
    ).toBe(true);
  });
  it('respects the from/until bounds', () => {
    const r = ROW({ status: 'wartung', statusFrom: '2021-06-10', statusUntil: '2021-06-20' });
    expect(isBlocked(r, '2021-06-01')).toBe(false); // before from
    expect(isBlocked(r, '2021-06-25')).toBe(false); // after until
    expect(isBlocked(r, '2021-06-15')).toBe(true); // inside
  });

  // Regression (ARCHITECTURE_AUDIT.md F1): this server-side check used to look only at the
  // legacy status fields, so a machine blocked solely via the newer `maint` slots — the
  // only form the current machine-edit UI ever writes — was silently accepted by a write.
  it('is true for a machine blocked only via `maint`, with status left at ok', () => {
    const r = ROW({
      status: 'ok',
      maint: JSON.stringify([{ type: 'defekt', from: '2021-06-10', until: '2021-06-20' }]),
    });
    expect(isBlocked(r, '2021-06-01')).toBe(false); // before the slot
    expect(isBlocked(r, '2021-06-15')).toBe(true); // inside the slot
    expect(isBlocked(r, '2021-06-25')).toBe(false); // after the slot
  });

  it('is false for an empty, non-array, or malformed `maint`, falling back to status', () => {
    expect(isBlocked(ROW({ status: 'ok', maint: '[]' }), '2021-06-15')).toBe(false);
    expect(isBlocked(ROW({ status: 'ok', maint: 'not json' }), '2021-06-15')).toBe(false);
    expect(isBlocked(ROW({ status: 'ok', maint: '{"not":"an array"}' }), '2021-06-15')).toBe(false);
    // malformed maint doesn't hide a real legacy-status block
    expect(isBlocked(ROW({ status: 'defekt', maint: 'not json' }), '2021-06-15')).toBe(true);
  });
});

describe('blockReason', () => {
  it('returns null when not blocked', () => {
    expect(blockReason(ROW({ status: 'ok' }), '2021-06-01')).toBeNull();
  });

  it('prefers a covering `maint` slot over the legacy status fields, using its own type', () => {
    const r = ROW({
      status: 'wartung', // present, but the maint slot should win
      maint: JSON.stringify([{ type: 'defekt', from: '2021-06-01', until: '2021-06-30' }]),
    });
    expect(blockReason(r, '2021-06-15')).toBe('gesperrt (defekt)');
  });

  it('falls back to the legacy status label when no maint slot covers the day', () => {
    expect(blockReason(ROW({ status: 'wartung' }), '2021-06-15')).toBe('gesperrt (wartung)');
  });

  it("labels a maint slot with no `type` as 'wartung'", () => {
    const r = ROW({ maint: JSON.stringify([{ from: '2021-06-01', until: '2021-06-30' }]) });
    expect(blockReason(r, '2021-06-15')).toBe('gesperrt (wartung)');
  });
});

describe('isDayAvailable', () => {
  it('is true when the machine has no days mask', () => {
    expect(isDayAvailable(ROW({ days: null }), '2021-01-04')).toBe(true); // a Monday
  });

  it('is true when the mask is malformed (wrong length)', () => {
    expect(isDayAvailable(ROW({ days: '111' }), '2021-01-04')).toBe(true);
  });

  it("reads the mask Mo..So, '0' unavailable", () => {
    const closedMondays = ROW({ days: '0111111' });
    expect(isDayAvailable(closedMondays, '2021-01-04')).toBe(false); // Monday
    expect(isDayAvailable(closedMondays, '2021-01-05')).toBe(true); // Tuesday
    expect(isDayAvailable(closedMondays, '2021-01-10')).toBe(true); // Sunday
  });
});

describe('machineOut', () => {
  it('maps the base fields and coalesces null status/note/info', () => {
    expect(machineOut(ROW({ grp: 'B', status: null, statusNote: null, info: null }))).toEqual({
      id: 'm1',
      name: 'M1',
      group: 'B',
      status: 'ok',
      statusNote: '',
      info: '',
    });
  });
  it('adds each optional field only when set', () => {
    const o = machineOut(
      ROW({
        cat: 'messtechnik',
        statusFrom: '2021-01-01',
        statusUntil: '2021-12-31',
        redu: 'r',
        days: '1111100',
        maint: JSON.stringify([{ type: 'wartung' }]),
      }),
    );
    expect(o).toMatchObject({
      cat: 'messtechnik',
      statusFrom: '2021-01-01',
      statusUntil: '2021-12-31',
      redu: 'r',
      days: '1111100',
      maint: [{ type: 'wartung' }],
    });
  });
  it('omits maint when the JSON is malformed or an empty array', () => {
    expect(machineOut(ROW({ maint: 'not json' })).maint).toBeUndefined();
    expect(machineOut(ROW({ maint: '[]' })).maint).toBeUndefined();
  });
});

describe('bookingOut', () => {
  it('maps name/ts and only present optionals', () => {
    expect(
      bookingOut({
        name: 'Alice',
        ts: '2021-01-04T00:00:00Z',
        note: null,
        gid: null,
        gtitle: null,
      }),
    ).toEqual({
      name: 'Alice',
      ts: '2021-01-04T00:00:00Z',
    });
    expect(bookingOut({ name: 'Bob', ts: null, note: 'n', gid: 'g', gtitle: 't' })).toEqual({
      name: 'Bob',
      ts: null,
      note: 'n',
      gid: 'g',
      gtitle: 't',
    });
  });
});

describe('getState', () => {
  it('returns rev/groups/machines(sorted)/bookings from the DB', () => {
    const db = mem();
    setMeta(db, 'revision', '7');
    setMeta(db, 'groups', JSON.stringify(['A', 'B']));
    insertMachine(db, ROW({ id: 'm2', name: 'Zed', sort: 1 }));
    insertMachine(db, ROW({ id: 'm1', name: 'Abe', sort: 0 }));
    db.prepare('INSERT INTO bookings(mid,day,name,ts) VALUES(?,?,?,?)').run(
      'm1',
      '2021-01-04',
      'Alice',
      '2021-01-04T00:00:00Z',
    );
    const st = getState(db);
    expect(st.rev).toBe(7);
    expect(st.groups).toEqual(['A', 'B']);
    expect(st.machines.map((m) => m.id)).toEqual(['m1', 'm2']); // ORDER BY sort, name
    expect(st.bookings.m1!['2021-01-04']!.name).toBe('Alice');
  });

  it('defaults rev to 0 and groups to [] when meta is absent', () => {
    const db = mem();
    db.prepare('DELETE FROM meta').run();
    const st = getState(db);
    expect(st.rev).toBe(0);
    expect(st.groups).toEqual([]);
    expect(st.machines).toEqual([]);
  });
});
