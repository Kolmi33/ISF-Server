// bridge.ts — server-authoritative weekend auto-bridging (Phase 6.3, the ADD direction).
//
// A weekend day (Sat/Sun) belongs in the plan as part of a continuous Fri→Mon series.
// core/weekend.ts already REMOVES orphaned weekend days on the client (the sweep). This
// is the mirror: it ADDS the Sat/Sun between a booked Friday and a booked Monday, carrying
// the Friday's name — a faithful port of the baseline `missingWeekendBridges`, made pure
// and server-side. Used two ways: `maintainBridges` (inside the mutate transaction, going
// forward) and `backfillBridges` (a one-time pass over the whole DB).
import type { Db } from './db.js';

/** The minimal booking view the bridge computation needs: mid → day → { name }. */
export type BookingMap = Record<string, Record<string, { name: string }>>;

/** A weekend day to insert, carrying the Friday booking's name. */
export interface Bridge {
  mid: string;
  day: string;
  name: string;
}

// UTC date helpers (match core/dates semantics; server is decoupled from web/).
const parseYmd = (s: string): Date => new Date(s + 'T00:00:00Z');
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86400000);

/**
 * The Sat/Sun days that sit inside a continuous Fri→Mon series but are not yet booked.
 * For every booked Friday whose following Monday is also booked (by anyone), the empty
 * Saturday and/or Sunday between them is returned, carrying the Friday's name.
 */
export function missingBridges(bookings: BookingMap): Bridge[] {
  const adds: Bridge[] = [];
  for (const mid of Object.keys(bookings)) {
    const mb = bookings[mid]!;
    for (const d of Object.keys(mb)) {
      const dt = parseYmd(d);
      if (dt.getUTCDay() !== 5) continue; // Fridays only
      const name = mb[d]!.name;
      const sat = ymd(addDays(dt, 1));
      const sun = ymd(addDays(dt, 2));
      const mon = ymd(addDays(dt, 3));
      if (mb[mon]) {
        // the series runs across the weekend (Monday booked, any person)
        if (!mb[sat]) adds.push({ mid, day: sat, name });
        if (!mb[sun]) adds.push({ mid, day: sun, name });
      }
    }
  }
  return adds;
}

/** Read the bookings (id → day → name) for the given machines into a BookingMap. */
function bookingsFor(db: Db, mids: readonly string[]): BookingMap {
  const q = db.prepare('SELECT day, name FROM bookings WHERE mid=?');
  const map: BookingMap = {};
  for (const mid of mids) {
    const rows = q.all(mid) as unknown as { day: string; name: string }[];
    const mb: Record<string, { name: string }> = {};
    for (const r of rows) mb[r.day] = { name: r.name };
    map[mid] = mb;
  }
  return map;
}

/**
 * Insert any missing weekend bridges for `mids` (never overwriting an existing cell), using
 * the given timestamp. Meant to run INSIDE an already-open transaction (the mutate path);
 * returns the bridges inserted so the caller can broadcast them. `ON CONFLICT DO NOTHING`
 * makes it safe even if a day filled concurrently.
 */
export function maintainBridges(db: Db, mids: readonly string[], ts: string): Bridge[] {
  if (!mids.length) return [];
  const adds = missingBridges(bookingsFor(db, mids));
  if (!adds.length) return [];
  const up = db.prepare(
    'INSERT INTO bookings(mid,day,name,ts) VALUES(?,?,?,?) ON CONFLICT(mid,day) DO NOTHING',
  );
  for (const a of adds) up.run(a.mid, a.day, a.name, ts);
  return adds;
}

/**
 * One-time backfill: insert every missing weekend bridge across the whole DB in a single
 * transaction (internal SQL — NOT subject to the API's 1000-cell batch cap). Returns the
 * number inserted. This is a production data write when run against live data.
 */
export function backfillBridges(db: Db): number {
  const mids = (
    db.prepare('SELECT DISTINCT mid FROM bookings').all() as unknown as { mid: string }[]
  ).map((r) => r.mid);
  const adds = missingBridges(bookingsFor(db, mids));
  if (!adds.length) return 0;
  const ts = new Date().toISOString();
  const up = db.prepare(
    'INSERT INTO bookings(mid,day,name,ts) VALUES(?,?,?,?) ON CONFLICT(mid,day) DO NOTHING',
  );
  db.exec('BEGIN');
  try {
    for (const a of adds) up.run(a.mid, a.day, a.name, ts);
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
  return adds.length;
}
