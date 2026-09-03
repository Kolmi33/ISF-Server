// =======================================================================================
// READ MODEL & ENTITY MAPPER (server/model.ts)
// =======================================================================================
//
// Read-model projections, entity mappers, and server-side availability validation.
//
// Responsibilities:
// 1. Data Projection: Maps raw SQLite database rows (`machines`, `bookings`) into normalized wire payloads.
// 2. Business Invariant Enforcement: Validates maintenance slots and weekday masks server-side
//    to guarantee that API and batch writes cannot bypass calendar booking rules.
// 3. Full State Retrieval: Implements `getState` to assemble the complete dataset served by `/api/state`.
//
// =======================================================================================
import type { Db } from './db.js';
import { getMeta } from './db.js';
import { mondayFirstWeekdayIndex, parseIsoDateString } from '../shared/dates.js';
import type { BookingOut, BookingRow, MachineOut, MachineRow, StateOut } from './types.js';

/** Maintenance or defect slot structure stored in a machine row's `maint` JSON column. */
interface MaintenanceSlot {
  type?: string;
  from?: string;
  until?: string;
}

/**
 * Safely parses the JSON `maint` column from a machine database row.
 */
function parsedMaintenanceSlots(machine: MachineRow): MaintenanceSlot[] {
  if (!machine.maint) return [];
  try {
    const parsed = JSON.parse(machine.maint) as unknown;
    return Array.isArray(parsed) ? (parsed as MaintenanceSlot[]) : [];
  } catch {
    return [];
  }
}

/**
 * Finds the maintenance slot covering `day` (inclusive bounds, empty bound = open-ended).
 */
function maintenanceSlotAt(machine: MachineRow, day: string): MaintenanceSlot | null {
  for (const slot of parsedMaintenanceSlots(machine)) {
    if ((!slot.from || day >= slot.from) && (!slot.until || day <= slot.until)) return slot;
  }
  return null;
}

/**
 * Checks why a machine is blocked on an ISO date, returning the formatted reason or null if operational.
 * Evaluates both structured `maint` slots and legacy status fields.
 */
export function blockReason(machine: MachineRow, day: string): string | null {
  const slot = maintenanceSlotAt(machine, day);
  if (slot) return `gesperrt (${slot.type || 'wartung'})`;
  const hasActiveNonOkStatus = !!machine.status && machine.status !== 'ok';
  const isAfterStatusStart = !machine.statusFrom || day >= machine.statusFrom;
  const isBeforeStatusEnd = !machine.statusUntil || day <= machine.statusUntil;
  if (hasActiveNonOkStatus && isAfterStatusStart && isBeforeStatusEnd) {
    return `gesperrt (${machine.status})`;
  }
  return null;
}

/**
 * Returns true if a machine is blocked by maintenance or defect on `day`.
 */
export function isBlocked(machine: MachineRow, day: string): boolean {
  return blockReason(machine, day) !== null;
}

/**
 * Validates whether a machine is operational on the day of the week of `day` (per its 7-char mask).
 */
export function isDayAvailable(machine: MachineRow, day: string): boolean {
  if (!machine.days || machine.days.length !== 7) return true;
  return machine.days.charAt(mondayFirstWeekdayIndex(parseIsoDateString(day))) !== '0';
}

/**
 * Attaches optional metadata fields to a machine's wire representation.
 */
function addOptionalFields(wireShape: MachineOut, row: MachineRow): void {
  if (row.cat) wireShape.cat = row.cat;
  if (row.statusFrom) wireShape.statusFrom = row.statusFrom;
  if (row.statusUntil) wireShape.statusUntil = row.statusUntil;
  if (row.redu) wireShape.redu = row.redu;
  if (row.days) wireShape.days = row.days;
  if (row.maint) {
    try {
      const parsedMaintenance = JSON.parse(row.maint) as unknown;
      if (Array.isArray(parsedMaintenance) && parsedMaintenance.length) {
        wireShape.maint = parsedMaintenance;
      }
    } catch {
      /* ignore malformed JSON */
    }
  }
}

/**
 * Maps a SQLite `machines` row to its public wire format.
 */
export function machineOut(row: MachineRow): MachineOut {
  const wireShape: MachineOut = {
    id: row.id,
    name: row.name,
    group: row.grp,
    status: row.status || 'ok',
    statusNote: row.statusNote || '',
    info: row.info || '',
  };
  addOptionalFields(wireShape, row);
  return wireShape;
}

/**
 * Maps a SQLite `bookings` row to its public wire format.
 */
export function bookingOut(
  row: Pick<BookingRow, 'name' | 'ts' | 'note' | 'gid' | 'gtitle'>,
): BookingOut {
  const wireShape: BookingOut = { name: row.name, ts: row.ts };
  if (row.note) wireShape.note = row.note;
  if (row.gid) wireShape.gid = row.gid;
  if (row.gtitle) wireShape.gtitle = row.gtitle;
  return wireShape;
}

/**
 * Queries and assembles the complete application state (revision, groups, machines, bookings).
 */
export function getState(db: Db): StateOut {
  const machines = (
    db.prepare('SELECT * FROM machines ORDER BY sort, name').all() as unknown as MachineRow[]
  ).map(machineOut);
  const bookings: Record<string, Record<string, BookingOut>> = {};
  for (const row of db.prepare('SELECT * FROM bookings').all() as unknown as BookingRow[]) {
    (bookings[row.mid] ||= {})[row.day] = bookingOut(row);
  }
  return {
    rev: parseInt(getMeta(db, 'revision') || '0') || 0,
    groups: JSON.parse(getMeta(db, 'groups') || '[]') as string[],
    machines,
    bookings,
  };
}
