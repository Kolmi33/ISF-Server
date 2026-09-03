// =======================================================================================
// AUTOMATED WEEKEND BRIDGING MODULE (server/bridge.ts)
// =======================================================================================
//
// Automated management of weekend calendar bridge days (Saturday / Sunday).
//
// Domain Rule:
// When a machine is booked on both Friday and the following Monday, the intervening weekend days
// (Saturday and Sunday) are automatically populated as bridge reservations carrying the Friday booker's name.
//
// Responsibilities:
// 1. Missing Bridge Computation: Pure detection of missing Saturday/Sunday dates in Fri->Mon runs.
// 2. Transactional Maintenance: Inserts bridge days inside active mutation transactions (`maintainBridges`).
// 3. Database Backfill Utility: One-time backfill runner for database migration scripts (`backfillBridges`).
//
// =======================================================================================
import type { Db } from './db.js';
import { parseIsoDateString, formatDateAsIsoString, addDays } from '../shared/dates.js';

/** Minimal booking map structure required for bridge evaluation: machineId -> day -> { name }. */
export type BookingMap = Record<string, Record<string, { name: string }>>;

/** Represents a weekend bridge cell to be inserted. */
export interface Bridge {
  machineId: string;
  day: string;
  name: string;
}

const FRIDAY_WEEKDAY_NUMBER = 5;

/**
 * Computes all missing Saturday and Sunday bridge cells across the provided bookings map.
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

/**
 * Loads current bookings for the given machine IDs from SQLite into a BookingMap.
 */
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
 * Inserts missing weekend bridge days for specified machine IDs within an open transaction.
 * Returns the array of inserted bridge records.
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
 * Executes a full database scan and inserts all missing weekend bridges in a single transaction.
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
