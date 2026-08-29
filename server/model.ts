// model.ts — the read model: pure row → wire-shape mappers + the full state read.
// No HTTP, no globals; every function takes the db (or a row) explicitly, so the
// mapping logic is unit-testable against an in-memory DB. Faithful port of the
// machineOut/bookingOut/getState/isBlocked helpers from src/server.mjs.
import type { Db } from './db.js';
import { getMeta } from './db.js';
import type { BookingOut, BookingRow, MachineOut, MachineRow, StateOut } from './types.js';

/** True if machine `m` is blocked (maintenance/defect) on ISO date `day`. */
export function isBlocked(m: MachineRow, day: string): boolean {
  return !!(
    m.status &&
    m.status !== 'ok' &&
    (!m.statusFrom || day >= m.statusFrom) &&
    (!m.statusUntil || day <= m.statusUntil)
  );
}

/** Add the optional wire fields to `o` only when the row has them set. */
function addOptionalFields(o: MachineOut, r: MachineRow): void {
  if (r.cat) o.cat = r.cat;
  if (r.statusFrom) o.statusFrom = r.statusFrom;
  if (r.statusUntil) o.statusUntil = r.statusUntil;
  if (r.redu) o.redu = r.redu; // Redundanz-Markierung (nur Label)
  if (r.days) o.days = r.days; // verfügbare Wochentage (Maske Mo..So)
  if (r.maint) {
    try {
      const a = JSON.parse(r.maint) as unknown;
      if (Array.isArray(a) && a.length) o.maint = a;
    } catch {
      /* ignore malformed maint JSON — omit the field */
    }
  }
}

/** Map a `machines` row to its wire shape (adds optional fields only when set). */
export function machineOut(r: MachineRow): MachineOut {
  const o: MachineOut = {
    id: r.id,
    name: r.name,
    group: r.grp,
    status: r.status || 'ok',
    statusNote: r.statusNote || '',
    info: r.info || '',
  };
  addOptionalFields(o, r);
  return o;
}

/** Map a booking value (a full row, or the fields the mutate builds) to its wire shape. */
export function bookingOut(
  r: Pick<BookingRow, 'name' | 'ts' | 'note' | 'gid' | 'gtitle'>,
): BookingOut {
  const o: BookingOut = { name: r.name, ts: r.ts };
  if (r.note) o.note = r.note;
  if (r.gid) o.gid = r.gid;
  if (r.gtitle) o.gtitle = r.gtitle;
  return o;
}

/** Read the full team-wide state (revision + groups + machines + bookings). */
export function getState(db: Db): StateOut {
  const machines = (
    db.prepare('SELECT * FROM machines ORDER BY sort, name').all() as unknown as MachineRow[]
  ).map(machineOut);
  const bookings: Record<string, Record<string, BookingOut>> = {};
  for (const r of db.prepare('SELECT * FROM bookings').all() as unknown as BookingRow[]) {
    (bookings[r.mid] ||= {})[r.day] = bookingOut(r);
  }
  return {
    rev: parseInt(getMeta(db, 'revision') || '0') || 0,
    groups: JSON.parse(getMeta(db, 'groups') || '[]') as string[],
    machines,
    bookings,
  };
}
