// bridge.ts — server-authoritative weekend auto-bridging (Phase 6.3, the ADD direction).
//
// A weekend day (Sat/Sun) belongs in the plan as part of a continuous Fri→Mon series.
// core/weekend.ts already REMOVES orphaned weekend days on the client (the sweep). This
// is the mirror: it ADDS the Sat/Sun between a booked Friday and a booked Monday, carrying
// the Friday's name — a faithful port of the baseline `missingWeekendBridges`, made pure
// and server-side. Used two ways: `maintainBridges` (inside the mutate transaction, going
// forward) and `backfillBridges` (a one-time pass over the whole DB).
import type { Db } from './db.js';
import { parseIsoDateString, formatDateAsIsoString, addDays } from '../shared/dates.js';

/** The minimal booking view the bridge computation needs: machine id → day → { name }. */
export type BookingMap = Record<string, Record<string, { name: string }>>;

/** A weekend day to insert, carrying the Friday booking's name. */
export interface Bridge {
  machineId: string;
  day: string;
  name: string;
}

// JavaScript's Date#getUTCDay(): Sunday=0, Monday=1, ... Saturday=6.
const FRIDAY_WEEKDAY_NUMBER = 5;

/**
 * The Sat/Sun days that sit inside a continuous Fri→Mon series but are not yet booked.
 * For every booked Friday whose following Monday is also booked (by anyone), the empty
 * Saturday and/or Sunday between them is returned, carrying the Friday's name.
 */
export function missingBridges(bookings: BookingMap): Bridge[] {
  const missing: Bridge[] = [];
  for (const machineId of Object.keys(bookings)) {
    const machineBookings = bookings[machineId]!;
    for (const bookedDay of Object.keys(machineBookings)) {
      const fridayDate = parseIsoDateString(bookedDay);
      if (fridayDate.getUTCDay() !== FRIDAY_WEEKDAY_NUMBER) continue;
      const name = machineBookings[bookedDay]!.name;
      const saturdayIsoDate = formatDateAsIsoString(addDays(fridayDate, 1));
      const sundayIsoDate = formatDateAsIsoString(addDays(fridayDate, 2));
      const mondayIsoDate = formatDateAsIsoString(addDays(fridayDate, 3));
      if (machineBookings[mondayIsoDate]) {
        // the series runs across the weekend (Monday booked, any person)
        if (!machineBookings[saturdayIsoDate]) {
          missing.push({ machineId, day: saturdayIsoDate, name });
        }
        if (!machineBookings[sundayIsoDate]) {
          missing.push({ machineId, day: sundayIsoDate, name });
        }
      }
    }
  }
  return missing;
}

/** Read the bookings (id → day → name) for the given machines into a BookingMap. */
function bookingsFor(db: Db, machineIds: readonly string[]): BookingMap {
  const selectBookingsForMachine = db.prepare('SELECT day, name FROM bookings WHERE mid=?');
  const bookingsByMachine: BookingMap = {};
  for (const machineId of machineIds) {
    const rows = selectBookingsForMachine.all(machineId) as unknown as {
      day: string;
      name: string;
    }[];
    const bookingsByDay: Record<string, { name: string }> = {};
    for (const row of rows) bookingsByDay[row.day] = { name: row.name };
    bookingsByMachine[machineId] = bookingsByDay;
  }
  return bookingsByMachine;
}

/**
 * Insert any missing weekend bridges for `machineIds` (never overwriting an existing cell),
 * using the given timestamp. Meant to run INSIDE an already-open transaction (the mutate
 * path); returns the bridges inserted so the caller can broadcast them. `ON CONFLICT DO
 * NOTHING` makes it safe even if a day filled concurrently.
 */
export function maintainBridges(db: Db, machineIds: readonly string[], ts: string): Bridge[] {
  if (!machineIds.length) return [];
  const missing = missingBridges(bookingsFor(db, machineIds));
  if (!missing.length) return [];
  const insertBridge = db.prepare(
    'INSERT INTO bookings(mid,day,name,ts) VALUES(?,?,?,?) ON CONFLICT(mid,day) DO NOTHING',
  );
  for (const bridge of missing) insertBridge.run(bridge.machineId, bridge.day, bridge.name, ts);
  return missing;
}

/**
 * One-time backfill: insert every missing weekend bridge across the whole DB in a single
 * transaction (internal SQL — NOT subject to the API's 1000-cell batch cap). Returns the
 * number inserted. This is a production data write when run against live data.
 */
export function backfillBridges(db: Db): number {
  const allMachineIds = (
    db.prepare('SELECT DISTINCT mid FROM bookings').all() as unknown as { mid: string }[]
  ).map((row) => row.mid);
  const missing = missingBridges(bookingsFor(db, allMachineIds));
  if (!missing.length) return 0;
  const ts = new Date().toISOString();
  const insertBridge = db.prepare(
    'INSERT INTO bookings(mid,day,name,ts) VALUES(?,?,?,?) ON CONFLICT(mid,day) DO NOTHING',
  );
  db.exec('BEGIN');
  try {
    for (const bridge of missing) insertBridge.run(bridge.machineId, bridge.day, bridge.name, ts);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }
  return missing.length;
}
