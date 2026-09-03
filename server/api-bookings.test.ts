import { describe, it, expect } from 'vitest';
import { openDb, type Db } from './db.ts';
import {
  listMachineBookings,
  getMachineBooking,
  listBookingsByGroup,
  bookingEtag,
} from './api-bookings.ts';

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
  // What: both `from` and `to` are required — an unbounded fetch isn't offered.
  // How: checks missing both, missing `to`, and missing `from` all produce 400.
  it('requires from and to', () => {
    const db = mem();
    expect(listMachineBookings(db, 'm1', url('/x')).status).toBe(400);
    expect(listMachineBookings(db, 'm1', url('/x?from=2026-01-01')).status).toBe(400);
    expect(listMachineBookings(db, 'm1', url('/x?to=2026-01-31')).status).toBe(400);
  });

  // What: a malformed date, or a `from` that's after `to`, are both rejected as validation errors.
  // How: checks a non-date `from` value and an inverted from/to range both produce 400.
  it('rejects a malformed date or a from-after-to range', () => {
    const db = mem();
    expect(listMachineBookings(db, 'm1', url('/x?from=nope&to=2026-01-31')).status).toBe(400);
    expect(listMachineBookings(db, 'm1', url('/x?from=2026-02-01&to=2026-01-01')).status).toBe(400);
  });

  // What: fetching bookings for a machine that doesn't exist is a 404.
  // How: calls with an unknown machine id and checks the status/code.
  it('is a 404 when the machine does not exist', () => {
    const res = listMachineBookings(mem(), 'ghost', url('/x?from=2026-01-01&to=2026-01-31'));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  // What: only bookings within the given date range, on the requested machine, come back —
  // sorted by date — with everything else (a different machine, a date outside range) excluded.
  // How: books four cells (one out-of-range, one on a different machine) and checks only the
  // two matching ones come back, in date order.
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

  // What: a valid machine and range with no bookings in it returns an empty array, not an error.
  // How: calls a real machine's bookings with a valid but entirely-unbooked range.
  it('is an empty array, not an error, when the range has no bookings', () => {
    const res = listMachineBookings(mem(), 'm1', url('/x?from=2026-01-01&to=2026-01-31'));
    expect(res).toEqual({ status: 200, body: { data: [] } });
  });
});

describe('getMachineBooking', () => {
  // What: fetching a single cell on an unknown machine is a 404.
  // How: calls with an unknown machine id and checks the status/code.
  it('is a 404 when the machine does not exist', () => {
    const res = getMachineBooking(mem(), 'ghost', '2026-01-05');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  // What: a malformed date string is a 400 validation error.
  // How: calls with a non-date string as the date and checks the status/code.
  it('is a 400 for a malformed date', () => {
    const res = getMachineBooking(mem(), 'm1', 'not-a-date');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION' });
  });

  // What: fetching a free cell (nothing booked there) is a 404 — there's no booking resource
  // at that address to return.
  // How: calls a valid machine/date with nothing booked and checks the status/code.
  it('is a 404 when the cell is free', () => {
    const res = getMachineBooking(mem(), 'm1', '2026-01-05');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  // What: a booked cell returns the wire-shaped booking, with its date included alongside
  // the usual booking fields.
  // How: books a cell with a note and checks the response data includes date/name/note.
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

  // What: a booked cell's response carries an ETag header — the CAS token a write endpoint's
  // `If-Match` precondition compares against.
  // How: books a cell and checks the response's ETag header matches what bookingEtag() would
  // compute for that exact row.
  it('carries an ETag header on a booked cell, for the write endpoints to CAS against', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Anna');
    const res = getMachineBooking(db, 'm1', '2026-01-05');
    expect(res.headers).toEqual({ ETag: bookingEtag({ name: 'Anna', ts: 't0' }) });
  });
});

describe('bookingEtag', () => {
  // What: an empty cell (no row) always produces the fixed sentinel tag "empty".
  // How: calls bookingEtag(undefined) and checks the exact sentinel value.
  it('is a fixed sentinel for an empty cell', () => {
    expect(bookingEtag(undefined)).toBe('"empty"');
  });

  // What: the tag changes whenever the name or the ts changes, but is stable for identical
  // inputs — a booked cell's tag is derived purely from those two fields.
  // How: computes a tag once, then checks the same inputs reproduce it, a different name
  // changes it, a different ts changes it, and an empty cell is always different from a real one.
  it('changes when the name or the ts changes, stable otherwise', () => {
    const original = bookingEtag({ name: 'Anna', ts: 't0' });
    expect(bookingEtag({ name: 'Anna', ts: 't0' })).toBe(original); // same inputs, same tag
    expect(bookingEtag({ name: 'Bob', ts: 't0' })).not.toBe(original);
    expect(bookingEtag({ name: 'Anna', ts: 't1' })).not.toBe(original);
    expect(bookingEtag(undefined)).not.toBe(original);
  });
});

describe('listBookingsByGroup', () => {
  // What: `groupId` is required — this isn't a general booking search.
  // How: calls with no groupId query param and checks the 400 validation error.
  it('requires groupId', () => {
    const res = listBookingsByGroup(mem(), url('/x'));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION' });
  });

  // What: a groupId nothing belongs to returns an empty array, not an error.
  // How: calls with a groupId that matches no bookings and checks the empty 200 response.
  it('is an empty array, not an error, for a groupId nothing belongs to', () => {
    const res = listBookingsByGroup(mem(), url('/x?groupId=nope'));
    expect(res).toEqual({ status: 200, body: { data: [] } });
  });

  // What: every cell sharing one group id is collected across ALL machines, while a cell
  // with a different group id (even on the same machine) is excluded.
  // How: books two cells with the same gid on different machines plus one decoy cell with a
  // different gid, and checks only the two real group members come back.
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
