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
  // What: booking on an unknown machine is a 404.
  // How: calls with an unknown machine id and checks the status.
  it('is a 404 for an unknown machine', () => {
    const res = putBooking(mem(), 'ghost', '2026-01-05', { name: 'Anna' }, noHeaders, vi.fn());
    expect(res.status).toBe(404);
  });

  // What: a malformed date, or a body with no name, are both 400 validation errors.
  // How: checks a non-date string and an empty body each produce 400.
  it('is a 400 for a malformed date or a missing name', () => {
    const db = mem();
    expect(putBooking(db, 'm1', 'nope', { name: 'Anna' }, noHeaders, vi.fn()).status).toBe(400);
    expect(putBooking(db, 'm1', '2026-01-05', {}, noHeaders, vi.fn()).status).toBe(400);
  });

  // What: booking a free cell with no If-Match header at all writes unconditionally, returns
  // 201 (created, not updated), includes the new booking's ETag in the response headers, and
  // broadcasts the change.
  // How: PUTs a new booking with no headers and checks the status, the response data, the
  // ETag header's presence, and the broadcast call.
  it('creates a new booking unconditionally (no If-Match given), 201 with an ETag', () => {
    const db = mem();
    const broadcast = vi.fn();
    const res = putBooking(db, 'm1', '2026-01-05', { name: 'Anna' }, noHeaders, broadcast);
    expect(res.status).toBe(201);
    expect((res.body as { data: { name: string } }).data.name).toBe('Anna');
    expect(res.headers?.ETag).toBeDefined();
    expect(broadcast).toHaveBeenCalledWith('update', expect.anything());
  });

  // What: PUTting a cell already booked under the SAME name updates it (e.g. changing the
  // note) and returns 200 (updated, not created).
  // How: pre-books a cell, PUTs the same name with a new note, and checks the 200 status and
  // the updated note.
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

  // What: PUTting a cell already booked under a DIFFERENT name is a 409 conflict — the
  // "never overwrite a foreign booking" rule, enforced regardless of If-Match.
  // How: books a cell as Bob, PUTs it as Anna (no If-Match given), and checks the 409/CONFLICT response.
  it('is a 409 when someone else already booked that cell under a different name', () => {
    const db = mem();
    book(db, 'm1', '2026-01-05', 'Bob');
    const res = putBooking(db, 'm1', '2026-01-05', { name: 'Anna' }, noHeaders, vi.fn());
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT' });
  });

  // What: when an If-Match header IS given, it must match the cell's current tag exactly —
  // a stale tag is refused with 412 (leaving the cell untouched), while the current tag lets
  // the write through.
  // How: books a cell and computes its real current ETag, then PUTs once with a deliberately
  // wrong ("stale") tag (checks 412/PRECONDITION_FAILED) and once with the actual current tag
  // (checks it succeeds with 200).
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

  // What: to CAS against a currently-free cell, the client must send the literal "empty"
  // sentinel tag — that's what bookingEtag() itself computes for a free cell.
  // How: PUTs a new booking with If-Match: "empty" against an actually-free cell and checks
  // it succeeds (201).
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
  // What: deleting on an unknown machine, or an already-free cell (nothing to delete), are
  // both 404s.
  // How: checks an unknown machine and a real machine's free cell both produce 404.
  it('is a 404 for an unknown machine or an already-free cell', () => {
    const db = mem();
    expect(deleteBooking(db, 'ghost', '2026-01-05', noHeaders, vi.fn()).status).toBe(404);
    expect(deleteBooking(db, 'm1', '2026-01-05', noHeaders, vi.fn()).status).toBe(404);
  });

  // What: deleting with no If-Match header deletes whoever is there unconditionally,
  // returns 204, and broadcasts the change.
  // How: books a cell, deletes it with no headers, and checks the status, that the row is
  // actually gone, and the broadcast call.
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

  // What: same CAS precondition as PUT — a stale If-Match on delete is refused (412) and the
  // booking survives untouched.
  // How: books a cell, deletes with a deliberately wrong tag, and checks the 412 response and
  // that the booking is still there.
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
  // What: a batch with no `cells` field, or an explicitly empty array, is rejected — there's
  // nothing to book.
  // How: checks a body with no cells and one with an empty cells array both produce 400.
  it('requires a non-empty cells array', () => {
    expect(batchBook(mem(), {}, vi.fn()).status).toBe(400);
    expect(batchBook(mem(), { cells: [] }, vi.fn()).status).toBe(400);
  });

  // What: the whole batch is validated up front — a single malformed cell (missing a
  // required field) fails the whole request before any of it is written.
  // How: sends a batch with one cell missing its `name` field and checks the 400 response.
  it('validates every cell shape before writing any of it', () => {
    const res = batchBook(mem(), { cells: [{ machineId: 'm1', date: '2026-01-05' }] }, vi.fn());
    expect(res.status).toBe(400);
  });

  // What: a batch where every cell books cleanly (no conflicts) returns 200 with the applied
  // count and an empty conflicts list.
  // How: books two free cells across two machines in one batch and checks the response.
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

  // What: a batch where SOME cells conflict (but the request itself is well-formed) returns
  // 207 Multi-Status, reporting exactly which cells applied and which conflicted.
  // How: pre-books one cell that will conflict, batches it plus one genuinely free cell, and
  // checks the 207 status with applied:1 and one conflict entry.
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

  // What: unlike a per-cell booking conflict (207), a batch referencing a machine id that
  // doesn't exist at all is a 400 — a malformed request, not a partial-success case.
  // How: batches one cell against a nonexistent machine id and checks the 400 response.
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
  // What: same requirement as batchBook — an empty/missing cells array is rejected.
  // How: calls with no cells field and checks the 400 response.
  it('requires a non-empty cells array', () => {
    expect(batchDelete(mem(), {}, vi.fn()).status).toBe(400);
  });

  // What: the whole delete batch is validated up front too — one malformed cell (missing
  // `date`) fails the whole request before any deletion happens.
  // How: sends a batch with one cell missing its date field and checks the 400 response.
  it('validates every cell shape before deleting any of it', () => {
    const res = batchDelete(mem(), { cells: [{ machineId: 'm1' }] }, vi.fn());
    expect(res.status).toBe(400);
  });

  // What: batch delete is unconditional (no per-cell If-Match) — a booked cell in the batch
  // is deleted, and an already-free cell is silently skipped (no error), with `applied`
  // reporting only the count that genuinely had something to delete.
  // How: batches one booked and one already-free cell and checks applied:1 plus that the
  // booked cell is actually gone from the DB.
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
