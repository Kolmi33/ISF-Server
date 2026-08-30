// model.ts — the read model: pure row → wire-shape mappers + the full state read.
// No HTTP, no globals; every function takes the db (or a row) explicitly, so the
// mapping logic is unit-testable against an in-memory DB. Faithful port of the
// machineOut/bookingOut/getState/isBlocked helpers from src/server.mjs.
import type { Db } from './db.js';
import { getMeta } from './db.js';
import type { BookingOut, BookingRow, MachineOut, MachineRow, StateOut } from './types.js';

/** True if machine `machine` is blocked (maintenance/defect) on ISO date `day`. */
export function isBlocked(machine: MachineRow, day: string): boolean {
  const hasActiveNonOkStatus = !!machine.status && machine.status !== 'ok';
  const isAfterStatusStart = !machine.statusFrom || day >= machine.statusFrom;
  const isBeforeStatusEnd = !machine.statusUntil || day <= machine.statusUntil;
  return hasActiveNonOkStatus && isAfterStatusStart && isBeforeStatusEnd;
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
