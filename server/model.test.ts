import { describe, it, expect } from 'vitest';
import { openDb, setMeta, type Db } from './db.ts';
import { isBlocked, machineOut, bookingOut, getState } from './model.ts';
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
