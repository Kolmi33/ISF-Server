import { describe, it, expect } from 'vitest';
import { openDb, type Db } from './db.ts';
import { listActivity } from './api-activity.ts';

function mem(): Db {
  return openDb(':memory:');
}

function logEntry(db: Db, ts: string, user: string, action: string): void {
  db.prepare('INSERT INTO log(ts,user,action) VALUES(?,?,?)').run(ts, user, action);
}

const url = (query = ''): URL => new URL('http://x/api/v1/activity' + query);

describe('listActivity', () => {
  // What: an empty log returns an empty array, a normal successful response, not an error.
  // How: calls listActivity against a fresh empty DB and checks the exact 200/[] response.
  it('is an empty array, not an error, when the log is empty', () => {
    expect(listActivity(mem(), url())).toEqual({ status: 200, body: { data: [] } });
  });

  // What: entries come back newest-first by default, matching the client's own activity display.
  // How: logs two entries in chronological order and checks the response lists them reversed.
  it('returns entries newest-first by default', () => {
    const db = mem();
    logEntry(db, '2026-01-01T00:00:00Z', 'anna', 'Buchung: x');
    logEntry(db, '2026-01-02T00:00:00Z', 'bob', 'Buchung: y');
    const res = listActivity(db, url());
    const data = (res.body as { data: { action: string }[] }).data;
    expect(data.map((e) => e.action)).toEqual(['Buchung: y', 'Buchung: x']);
  });

  // What: without an explicit limit, the response caps at the default page size (50) and
  // reports a `nextCursor` (the last returned entry's id) so the caller can fetch more.
  // How: logs 60 entries and checks exactly 50 come back with nextCursor matching the last one's id.
  it('caps at the default limit, reporting a nextCursor to continue', () => {
    const db = mem();
    for (let i = 0; i < 60; i++)
      logEntry(db, `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`, 'anna', `action ${i}`);
    const res = listActivity(db, url());
    const body = res.body as { data: { id: number }[]; meta?: { nextCursor: number | null } };
    expect(body.data).toHaveLength(50); // default limit
    expect(body.meta?.nextCursor).toBe(body.data[body.data.length - 1]!.id);
  });

  // What: when everything fits on one page, no `meta`/`nextCursor` is included at all — its
  // absence signals "there is no next page" rather than a special null/false value.
  // How: logs one entry (well under any limit) and checks the body has no `meta` key.
  it('has no nextCursor (meta omitted) when everything fit in one page', () => {
    const db = mem();
    logEntry(db, '2026-01-01T00:00:00Z', 'anna', 'x');
    const res = listActivity(db, url());
    expect('meta' in (res.body as Record<string, unknown>)).toBe(false);
  });

  // What: passing a previous page's cursor fetches strictly older entries — the cursor
  // itself is excluded, not included again on the next page.
  // How: logs 5 entries, fetches the first 2-entry page (checks the newest two and captures
  // the cursor), then fetches the next page with that cursor and checks it continues with
  // strictly older entries, no overlap.
  it('follows a cursor to the next page, in strictly older-first-excluded order', () => {
    const db = mem();
    for (let i = 0; i < 5; i++) logEntry(db, `2026-01-01T00:00:0${i}Z`, 'anna', `action ${i}`);
    const firstPage = listActivity(db, url('?limit=2'));
    const firstBody = firstPage.body as {
      data: { id: number; action: string }[];
      meta?: { nextCursor: number };
    };
    expect(firstBody.data.map((e) => e.action)).toEqual(['action 4', 'action 3']);
    const cursor = firstBody.meta!.nextCursor;
    const secondPage = listActivity(db, url(`?limit=2&cursor=${cursor}`));
    const secondData = (secondPage.body as { data: { action: string }[] }).data;
    expect(secondData.map((e) => e.action)).toEqual(['action 2', 'action 1']);
  });

  // What: the `?user=` filter narrows results to just that user's entries.
  // How: logs entries from two users and checks the filtered result only includes the
  // requested one.
  it('filters by user', () => {
    const db = mem();
    logEntry(db, '2026-01-01T00:00:00Z', 'anna', 'x');
    logEntry(db, '2026-01-02T00:00:00Z', 'bob', 'y');
    const res = listActivity(db, url('?user=bob'));
    const data = (res.body as { data: { user: string }[] }).data;
    expect(data.map((e) => e.user)).toEqual(['bob']);
  });

  // What: the `?since=` filter keeps only entries with a timestamp at or after the given one.
  // How: logs an older and a newer entry and checks a since-filter between them keeps only the newer one.
  it('filters by since (ts >= since)', () => {
    const db = mem();
    logEntry(db, '2026-01-01T00:00:00Z', 'anna', 'old');
    logEntry(db, '2026-01-05T00:00:00Z', 'anna', 'new');
    const res = listActivity(db, url('?since=2026-01-03T00:00:00Z'));
    const data = (res.body as { data: { action: string }[] }).data;
    expect(data.map((e) => e.action)).toEqual(['new']);
  });

  // What: a non-numeric `limit` or `cursor` value is rejected with 400, not silently ignored
  // or defaulted.
  // How: checks both a non-numeric limit and a non-numeric cursor each produce a 400 status.
  it('rejects a non-numeric limit or cursor', () => {
    const db = mem();
    expect(listActivity(db, url('?limit=abc')).status).toBe(400);
    expect(listActivity(db, url('?cursor=abc')).status).toBe(400);
  });

  // What: a `limit` above the maximum (200) is clamped down rather than rejected or honored verbatim.
  // How: requests a limit of 99999 against only 5 real entries and checks all 5 (not an error,
  // and no attempt to actually fetch 99999) come back.
  it('clamps an over-large limit to the maximum (200)', () => {
    const db = mem();
    for (let i = 0; i < 5; i++) logEntry(db, `2026-01-01T00:00:0${i}Z`, 'anna', `x${i}`);
    const res = listActivity(db, url('?limit=99999'));
    expect((res.body as { data: unknown[] }).data).toHaveLength(5); // fewer entries than the cap
  });
});
