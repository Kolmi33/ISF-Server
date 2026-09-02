import { describe, it, expect } from 'vitest';
import { openDb, type Db } from './db.ts';
import { listMachineBookings, getMachineBooking, listBookingsByGroup } from './api-bookings.ts';

function mem(): Db {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO machines(id,name,grp,sort) VALUES(?,?,?,0)').run('m1', 'M1', 'A');
  db.prepare('INSERT INTO machines(id,name,grp,sort) VALUES(?,?,?,1)').run('m2', 'M2', 'A');
  return db;
}

function book(
  db: Db,
  machineId: string,
  day: string,
  name: string,
  over: { note?: string; gid?: string; gtitle?: string } = {},
): void {
  db.prepare('INSERT INTO bookings(mid,day,name,note,ts,gid,gtitle) VALUES(?,?,?,?,?,?,?)').run(
    machineId,
    day,
    name,
    over.note ?? null,
    't0',
    over.gid ?? null,
    over.gtitle ?? null,
  );
}

const url = (path: string): URL => new URL('http://x' + path);

describe('listMachineBookings', () => {
  it('requires from and to', () => {
    const db = mem();
    expect(listMachineBookings(db, 'm1', url('/x')).status).toBe(400);
    expect(listMachineBookings(db, 'm1', url('/x?from=2026-01-01')).status).toBe(400);
    expect(listMachineBookings(db, 'm1', url('/x?to=2026-01-31')).status).toBe(400);
  });

  it('rejects a malformed date or a from-after-to range', () => {
    const db = mem();
    expect(listMachineBookings(db, 'm1', url('/x?from=nope&to=2026-01-31')).status).toBe(400);
    expect(listMachineBookings(db, 'm1', url('/x?from=2026-02-01&to=2026-01-01')).status).toBe(400);
  });

  it('is a 404 when the machine does not exist', () => {
    const res = listMachineBookings(mem(), 'ghost', url('/x?from=2026-01-01&to=2026-01-31'));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns bookings within the range, sorted by date, empty when none', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Anna');
    book(db, 'm1', '2026-01-10', 'Bob');
    book(db, 'm1', '2026-02-01', 'Carla'); // outside range
    book(db, 'm2', '2026-01-06', 'Dana'); // different machine
    const res = listMachineBookings(db, 'm1', url('/x?from=2026-01-01&to=2026-01-31'));
    expect(res.status).toBe(200);
    const data = (res.body as { data: { date: string; name: string }[] }).data;
    expect(data.map((b) => [b.date, b.name])).toEqual([
      ['2026-01-05', 'Anna'],
      ['2026-01-10', 'Bob'],
    ]);
  });

  it('is an empty array, not an error, when the range has no bookings', () => {
    const res = listMachineBookings(mem(), 'm1', url('/x?from=2026-01-01&to=2026-01-31'));
    expect(res).toEqual({ status: 200, body: { data: [] } });
  });
});

describe('getMachineBooking', () => {
  it('is a 404 when the machine does not exist', () => {
    const res = getMachineBooking(mem(), 'ghost', '2026-01-05');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is a 400 for a malformed date', () => {
    const res = getMachineBooking(mem(), 'm1', 'not-a-date');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION' });
  });

  it('is a 404 when the cell is free', () => {
    const res = getMachineBooking(mem(), 'm1', '2026-01-05');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns the wire-shaped booking (with its date) when booked', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Anna', { note: 'wichtig' });
    const res = getMachineBooking(db, 'm1', '2026-01-05');
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toMatchObject({
      date: '2026-01-05',
      name: 'Anna',
      note: 'wichtig',
    });
  });
});

describe('listBookingsByGroup', () => {
  it('requires groupId', () => {
    const res = listBookingsByGroup(mem(), url('/x'));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION' });
  });

  it('is an empty array, not an error, for a groupId nothing belongs to', () => {
    const res = listBookingsByGroup(mem(), url('/x?groupId=nope'));
    expect(res).toEqual({ status: 200, body: { data: [] } });
  });

  it('collects every cell sharing the group id, across machines', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Anna', { gid: 'g1', gtitle: 'Projekt X' });
    book(db, 'm2', '2026-01-06', 'Anna', { gid: 'g1', gtitle: 'Projekt X' });
    book(db, 'm1', '2026-01-07', 'Anna', { gid: 'other' }); // different group — excluded
    const res = listBookingsByGroup(db, url('/x?groupId=g1'));
    expect(res.status).toBe(200);
    const data = (res.body as { data: { machineId: string; date: string }[] }).data;
    expect(data.map((b) => [b.machineId, b.date]).sort()).toEqual([
      ['m1', '2026-01-05'],
      ['m2', '2026-01-06'],
    ]);
  });
});
