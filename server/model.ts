// model.ts — the read model: pure row → wire-shape mappers + the full state read.
// No HTTP, no globals; every function takes the db (or a row) explicitly, so the
// mapping logic is unit-testable against an in-memory DB. Faithful port of the
// machineOut/bookingOut/getState/isBlocked helpers from src/server.mjs.
import type { Db } from './db.js';
import { getMeta } from './db.js';
import { mondayFirstWeekdayIndex, parseIsoDateString } from '../shared/dates.js';
import type { BookingOut, BookingRow, MachineOut, MachineRow, StateOut } from './types.js';

/** A maintenance/defect slot, as stored in a machine row's `maint` JSON column. Only the
 *  date bounds matter for blocking; `type` ('defekt'/'wartung') is carried through only
 *  for the conflict message. */
interface MaintenanceSlot {
  type?: string;
  from?: string;
  until?: string;
}

/** Parse a machine row's `maint` JSON column into slots — `[]` when absent or malformed,
 *  the same tolerant fallback `addOptionalFields` below already uses for the read path. */
function parsedMaintenanceSlots(machine: MachineRow): MaintenanceSlot[] {
  if (!machine.maint) return [];
  try {
    const parsed = JSON.parse(machine.maint) as unknown;
    return Array.isArray(parsed) ? (parsed as MaintenanceSlot[]) : [];
  } catch {
    return [];
  }
}

/** The maintenance slot covering `day` (bounds are inclusive; an empty bound is
 *  open-ended), or null if none. Mirrors the client's `core/machines.ts`
 *  `getMaintenanceSlotAtDate`, over the row's raw JSON rather than the wire's parsed array. */
function maintenanceSlotAt(machine: MachineRow, day: string): MaintenanceSlot | null {
  for (const slot of parsedMaintenanceSlots(machine)) {
    if ((!slot.from || day >= slot.from) && (!slot.until || day <= slot.until)) return slot;
  }
  return null;
}

/**
 * Why machine `machine` is blocked on ISO date `day` (a display-ready label), or null if
 * it isn't. Prefers a structured `maint` slot over the legacy single-status fields,
 * matching the client's own preference (`core/machines.ts`'s `getMaintenanceSlots`) —
 * **this server-side check used to look at the legacy fields only**, so a machine blocked
 * solely via the newer `maint` slots (the only form the machine-edit form has written
 * since `core/machines.ts`'s `saveMachine` started clearing the legacy fields on every
 * save) was silently accepted by a write here even though the client itself already
 * refuses to show that cell as bookable (see ARCHITECTURE_AUDIT.md §9, finding F1).
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

/** True if machine `machine` is blocked (maintenance/defect) on ISO date `day`. */
export function isBlocked(machine: MachineRow, day: string): boolean {
  return blockReason(machine, day) !== null;
}

/**
 * True if the machine is available on the weekday of ISO date `day`, per its `days` mask
 * (Mo..So, '1' = available). A missing or malformed mask means available every day.
 * Faithful port of the client's `core/machines.ts` `isMachineAvailableOnWeekday` — like
 * `blockReason` above, this had no server-side equivalent at all before F1 (a machine closed
 * on a given weekday could still be booked for it via a direct write).
 */
export function isDayAvailable(machine: MachineRow, day: string): boolean {
  if (!machine.days || machine.days.length !== 7) return true;
  return machine.days.charAt(mondayFirstWeekdayIndex(parseIsoDateString(day))) !== '0';
}

/** Add the optional wire fields to `wireShape` only when the row has them set. */
function addOptionalFields(wireShape: MachineOut, row: MachineRow): void {
  if (row.cat) wireShape.cat = row.cat;
  if (row.statusFrom) wireShape.statusFrom = row.statusFrom;
  if (row.statusUntil) wireShape.statusUntil = row.statusUntil;
  if (row.redu) wireShape.redu = row.redu; // Redundanz-Markierung (nur Label)
  if (row.days) wireShape.days = row.days; // verfügbare Wochentage (Maske Mo..So)
  if (row.maint) {
    try {
      const parsedMaintenance = JSON.parse(row.maint) as unknown;
      if (Array.isArray(parsedMaintenance) && parsedMaintenance.length) {
        wireShape.maint = parsedMaintenance;
      }
    } catch {
      /* ignore malformed maint JSON — omit the field */
    }
  }
}

/** Map a `machines` row to its wire shape (adds optional fields only when set). */
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

/** Map a booking value (a full row, or the fields the mutate builds) to its wire shape. */
export function bookingOut(
  row: Pick<BookingRow, 'name' | 'ts' | 'note' | 'gid' | 'gtitle'>,
): BookingOut {
  const wireShape: BookingOut = { name: row.name, ts: row.ts };
  if (row.note) wireShape.note = row.note;
  if (row.gid) wireShape.gid = row.gid;
  if (row.gtitle) wireShape.gtitle = row.gtitle;
  return wireShape;
}

/** Read the full team-wide state (revision + groups + machines + bookings). */
export function getState(db: Db): StateOut {
  const machines = (
    db.prepare('SELECT * FROM machines ORDER BY sort, name').all() as unknown as MachineRow[]
  ).map(machineOut);
  const bookings: Record<string, Record<string, BookingOut>> = {};
  for (const row of db.prepare('SELECT * FROM bookings').all() as unknown as BookingRow[]) {
    (bookings[row.mid] ||= {})[row.day] = bookingOut(row);
  }
  return {
    // `|| '0'` guards a never-set meta row; `|| 0` guards parseInt returning NaN on a
    // corrupt/non-numeric value (mirrors db.ts's bumpRev).
    rev: parseInt(getMeta(db, 'revision') || '0') || 0,
    // Unlike `maint` above (which can hold old free-form seed data), `groups` and
    // `revision` are only ever written by this server itself via setMeta — malformed
    // JSON here would mean DB corruption, not bad input, so it's allowed to throw.
    groups: JSON.parse(getMeta(db, 'groups') || '[]') as string[],
    machines,
    bookings,
  };
}
