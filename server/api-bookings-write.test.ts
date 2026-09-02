import { describe, it, expect, vi } from 'vitest';
import { openDb, type Db } from './db.ts';
import { putBooking, deleteBooking, batchBook, batchDelete } from './api-bookings-write.ts';
import { bookingEtag } from './api-bookings.ts';

function mem(): Db {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO machines(id,name,grp,sort) VALUES(?,?,?,0)').run('m1', 'M1', 'A');
  db.prepare('INSERT INTO machines(id,name,grp,sort) VALUES(?,?,?,1)').run('m2', 'M2', 'A');
  return db;
}

function book(db: Db, machineId: string, day: string, name: string): void {
  db.prepare('INSERT INTO bookings(mid,day,name,ts) VALUES(?,?,?,?)').run(
    machineId,
    day,
    name,
    't0',
  );
}

const noHeaders = {};

describe('putBooking', () => {
  it('is a 404 for an unknown machine', () => {
    const res = putBooking(mem(), 'ghost', '2026-01-05', { name: 'Anna' }, noHeaders, vi.fn());
    expect(res.status).toBe(404);
  });

  it('is a 400 for a malformed date or a missing name', () => {
    const db = mem();
    expect(putBooking(db, 'm1', 'nope', { name: 'Anna' }, noHeaders, vi.fn()).status).toBe(400);
    expect(putBooking(db, 'm1', '2026-01-05', {}, noHeaders, vi.fn()).status).toBe(400);
  });

  it('creates a new booking unconditionally (no If-Match given), 201 with an ETag', () => {
    const db = mem();
    const broadcast = vi.fn();
    const res = putBooking(db, 'm1', '2026-01-05', { name: 'Anna' }, noHeaders, broadcast);
    expect(res.status).toBe(201);
    expect((res.body as { data: { name: string } }).data.name).toBe('Anna');
    expect(res.headers?.ETag).toBeDefined();
    expect(broadcast).toHaveBeenCalledWith('update', expect.anything());
  });

  it('updates an existing booking (same name) unconditionally, 200', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Anna');
    const res = putBooking(
      db,
      'm1',
      '2026-01-05',
      { name: 'Anna', note: 'geändert' },
      noHeaders,
      vi.fn(),
    );
    expect(res.status).toBe(200);
    expect((res.body as { data: { note: string } }).data.note).toBe('geändert');
  });

  it('is a 409 when someone else already booked that cell under a different name', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Bob');
    const res = putBooking(db, 'm1', '2026-01-05', { name: 'Anna' }, noHeaders, vi.fn());
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT' });
  });

  it('honors a correct If-Match, 412s a stale one', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Anna');
    const currentEtag = bookingEtag({ name: 'Anna', ts: 't0' });

    const stale = putBooking(
      db,
      'm1',
      '2026-01-05',
      { name: 'Anna', note: 'x' },
      { 'if-match': '"stale"' },
      vi.fn(),
    );
    expect(stale.status).toBe(412);
    expect(stale.body).toMatchObject({ code: 'PRECONDITION_FAILED' });

    const fresh = putBooking(
      db,
      'm1',
      '2026-01-05',
      { name: 'Anna', note: 'y' },
      { 'if-match': currentEtag },
      vi.fn(),
    );
    expect(fresh.status).toBe(200);
  });

  it('If-Match against an empty cell must be the "empty" sentinel', () => {
    const db = mem();
    const res = putBooking(
      db,
      'm1',
      '2026-01-05',
      { name: 'Anna' },
      { 'if-match': '"empty"' },
      vi.fn(),
    );
    expect(res.status).toBe(201);
  });
});

describe('deleteBooking', () => {
  it('is a 404 for an unknown machine or an already-free cell', () => {
    const db = mem();
    expect(deleteBooking(db, 'ghost', '2026-01-05', noHeaders, vi.fn()).status).toBe(404);
    expect(deleteBooking(db, 'm1', '2026-01-05', noHeaders, vi.fn()).status).toBe(404);
  });

  it('deletes unconditionally without If-Match, 204', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Anna');
    const broadcast = vi.fn();
    const res = deleteBooking(db, 'm1', '2026-01-05', noHeaders, broadcast);
    expect(res.status).toBe(204);
    expect(
      db.prepare('SELECT 1 FROM bookings WHERE mid=? AND day=?').get('m1', '2026-01-05'),
    ).toBeUndefined();
    expect(broadcast).toHaveBeenCalledWith('update', expect.anything());
  });

  it('412s a stale If-Match, leaving the booking untouched', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Anna');
    const res = deleteBooking(db, 'm1', '2026-01-05', { 'if-match': '"stale"' }, vi.fn());
    expect(res.status).toBe(412);
    expect(
      db.prepare('SELECT 1 FROM bookings WHERE mid=? AND day=?').get('m1', '2026-01-05'),
    ).toBeDefined();
  });
});

describe('batchBook', () => {
  it('requires a non-empty cells array', () => {
    expect(batchBook(mem(), {}, vi.fn()).status).toBe(400);
    expect(batchBook(mem(), { cells: [] }, vi.fn()).status).toBe(400);
  });

  it('validates every cell shape before writing any of it', () => {
    const res = batchBook(mem(), { cells: [{ machineId: 'm1', date: '2026-01-05' }] }, vi.fn());
    expect(res.status).toBe(400);
  });

  it('applies every cell cleanly, 200', () => {
    const db = mem();
    const res = batchBook(
      db,
      {
        cells: [
          { machineId: 'm1', date: '2026-01-05', name: 'Anna' },
          { machineId: 'm2', date: '2026-01-06', name: 'Bob' },
        ],
      },
      vi.fn(),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { applied: 2, conflicts: [] } });
  });

  it('is a 207 when some cells conflict', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Bob');
    const res = batchBook(
      db,
      {
        cells: [
          { machineId: 'm1', date: '2026-01-05', name: 'Anna' }, // conflicts with Bob
          { machineId: 'm2', date: '2026-01-06', name: 'Anna' }, // applies fine
        ],
      },
      vi.fn(),
    );
    expect(res.status).toBe(207);
    const data = (res.body as { data: { applied: number; conflicts: unknown[] } }).data;
    expect(data.applied).toBe(1);
    expect(data.conflicts).toHaveLength(1);
  });

  it('is a 400 when the batch references an unknown machine', () => {
    const res = batchBook(
      mem(),
      { cells: [{ machineId: 'ghost', date: '2026-01-05', name: 'Anna' }] },
      vi.fn(),
    );
    expect(res.status).toBe(400);
  });
});

describe('batchDelete', () => {
  it('requires a non-empty cells array', () => {
    expect(batchDelete(mem(), {}, vi.fn()).status).toBe(400);
  });

  it('validates every cell shape before deleting any of it', () => {
    const res = batchDelete(mem(), { cells: [{ machineId: 'm1' }] }, vi.fn());
    expect(res.status).toBe(400);
  });

  it('deletes every cell that had something, reports the count actually applied', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Anna');
    const res = batchDelete(
      db,
      {
        cells: [
          { machineId: 'm1', date: '2026-01-05' }, // booked — deleted
          { machineId: 'm2', date: '2026-01-06' }, // already free — no-op
        ],
      },
      vi.fn(),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { applied: 1 } });
    expect(
      db.prepare('SELECT 1 FROM bookings WHERE mid=? AND day=?').get('m1', '2026-01-05'),
    ).toBeUndefined();
  });
});
