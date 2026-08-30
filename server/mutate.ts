// mutate.ts — the SINGLE write path. The client sends either a cell-delta
// (prev+val per cell → compare-and-set; foreign bookings are never overwritten) OR,
// for management changes, the complete machine/group list. Every input is validated
// here server-side — the client is NOT trusted (there is no login in front of it).
//
// Faithful port of applyMutate from src/server.mjs, split into structural/cells paths
// (and per-cell/per-machine helpers) to keep each function within the lint budgets.
// The SSE broadcast is injected (E4) so the reducer is testable without a live server.
import type { Db } from './db.js';
import { bumpRev, setMeta } from './db.js';
import { maintainBridges } from './bridge.js';
import { bookingOut, isBlocked } from './model.js';
import type {
  BookingRow,
  CellDelta,
  MachineRow,
  MutateBody,
  MutateChange,
  MutateConflict,
  MutateResult,
} from './types.js';

/** SSE broadcast sink; the real one lives in server.ts, tests pass a spy/noop. */
export type Broadcast = (event: string, data: unknown) => void;

type Stmt = ReturnType<Db['prepare']>;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Clamp an untrusted value to a plain string of at most `maxLength` characters, or null
 * when the input is null/undefined OR the clamped result would be empty (`|| null` after
 * `.slice` catches both "no value" and "value was an empty string").
 */
const clip = (value: unknown, maxLength: number): string | null =>
  value == null ? null : String(value).slice(0, maxLength) || null;

function logAction(db: Db, who: string, action: string): void {
  try {
    db.prepare('INSERT INTO log(ts,user,action) VALUES(?,?,?)').run(
      new Date().toISOString(),
      who || '?',
      action,
    );
  } catch {
    /* logging is best-effort */
  }
}

/* ---------------- structural (management) path ---------------- */

/** An untrusted machine from the client's structural payload (all fields unknown). */
interface InMachine {
  id?: unknown;
  name?: unknown;
  group?: unknown;
  cat?: unknown;
  status?: unknown;
  statusNote?: unknown;
  statusFrom?: unknown;
  statusUntil?: unknown;
  info?: unknown;
  redu?: unknown;
  days?: unknown;
  maint?: unknown;
}

/** Validate the whole machine list; return an error message or null. */
function structuralError(machines: InMachine[]): string | null {
  if (machines.length === 0 || machines.length > 5000) return 'Ungültige Maschinenliste';
  const seenIds = new Set<string>();
  for (const machine of machines) {
    const hasValidId = !!machine && typeof machine.id === 'string' && !!machine.id.trim();
    const hasValidName = !!machine && typeof machine.name === 'string' && !!machine.name.trim();
    if (!hasValidId || !hasValidName) return 'Maschine ohne gültige id/name';
    if (seenIds.has(machine.id as string)) return 'Doppelte Maschinen-id: ' + machine.id;
    seenIds.add(machine.id as string);
  }
  return null;
}

/** Validate + serialise a machine's maintenance slots to JSON, or null if none. */
function cleanMaint(machine: InMachine): string | null {
  if (!Array.isArray(machine.maint)) return null;
  const cleanedSlots = (machine.maint as unknown[]).slice(0, 50).map((rawSlot) => {
    const slot = (rawSlot || {}) as {
      type?: unknown;
      from?: unknown;
      until?: unknown;
      note?: unknown;
    };
    const type = slot.type === 'defekt' ? 'defekt' : 'wartung';
    const from = DAY_RE.test(String(slot.from || '')) ? String(slot.from) : '';
    const until = DAY_RE.test(String(slot.until || '')) ? String(slot.until) : '';
    const note = slot.note ? String(slot.note).slice(0, 200) : null;
    return { type, from, until, ...(note ? { note } : {}) };
  });
  return cleanedSlots.length ? JSON.stringify(cleanedSlots) : null;
}

/** Insert one machine row from an untrusted client machine (server-side clamps/validates). */
function insertMachine(insertStatement: Stmt, machine: InMachine, sortIndex: number): void {
  const validStatusFrom = DAY_RE.test(String(machine.statusFrom || ''))
    ? String(machine.statusFrom)
    : null;
  const validStatusUntil = DAY_RE.test(String(machine.statusUntil || ''))
    ? String(machine.statusUntil)
    : null;
  const validDaysMask = /^[01]{7}$/.test(String(machine.days || '')) ? String(machine.days) : null;
  insertStatement.run(
    clip(machine.id, 80),
    clip(machine.name, 200),
    clip(machine.group, 120),
    machine.cat === 'messtechnik' ? 'messtechnik' : null,
    machine.status === 'wartung' || machine.status === 'defekt' ? machine.status : 'ok',
    clip(machine.statusNote, 200),
    validStatusFrom,
    validStatusUntil,
    clip(machine.info, 300),
    clip(machine.redu, 120),
    validDaysMask,
    cleanMaint(machine),
    sortIndex,
  );
}

function applyStructural(
  db: Db,
  machines: InMachine[],
  groups: unknown,
  who: string,
  note: string | null,
  broadcast: Broadcast,
): MutateResult {
  const validationError = structuralError(machines);
  if (validationError) return { error: validationError };
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM machines');
    const insertStatement =
      db.prepare(`INSERT INTO machines(id,name,grp,cat,status,statusNote,statusFrom,statusUntil,info,redu,days,maint,sort)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    machines.forEach((machine, sortIndex) => insertMachine(insertStatement, machine, sortIndex));
    if (Array.isArray(groups)) {
      // Clamp each group name (120 chars), then cap the whole list (500 groups).
      const clampedGroupNames = groups.map((group) => String(group).slice(0, 120));
      setMeta(db, 'groups', JSON.stringify(clampedGroupNames.slice(0, 500)));
    }
    db.exec('DELETE FROM bookings WHERE mid NOT IN (SELECT id FROM machines)'); // orphans (deleted machine)
    if (note) logAction(db, who, note);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('mutate/structural:', (error as Error).message);
    return { error: 'Speichern fehlgeschlagen' };
  }
  const rev = bumpRev(db);
  broadcast('structural', { rev, by: who, log: note });
  return { ok: true, rev, structural: true };
}

/* ---------------- cell-delta (booking/deletion) path ---------------- */

/** Validate the cell list against the current machines; return an error or null. */
function validateCells(cells: CellDelta[], machineById: Map<string, MachineRow>): string | null {
  for (const cell of cells) {
    if (!cell || typeof cell.mid !== 'string' || !DAY_RE.test(cell.day || '')) {
      return 'Ungültige Zelle';
    }
    if (!machineById.has(cell.mid)) return 'Unbekannte Maschine: ' + cell.mid;
    if (cell.val && !String(cell.val.name || '').trim()) return 'Name fehlt';
  }
  return null;
}

/** The three prepared statements `writeCell` needs, named for what each one does. */
interface BookingStatements {
  findExistingBooking: Stmt;
  upsertBooking: Stmt;
  deleteBooking: Stmt;
}

/** Apply one cell (set or delete) inside the open transaction, collecting change/conflict. */
function writeCell(
  cell: CellDelta,
  machine: MachineRow,
  statements: BookingStatements,
  changes: MutateChange[],
  conflicts: MutateConflict[],
): void {
  const existingBooking = statements.findExistingBooking.get(cell.mid, cell.day) as
    BookingRow | undefined;
  if (cell.val) {
    // set / book — enforce our own block rule + never overwrite a foreign booking
    const name = String(cell.val.name).trim();
    if (isBlocked(machine, cell.day)) {
      conflicts.push({ mid: cell.mid, day: cell.day, by: `gesperrt (${machine.status})` });
      return;
    }
    if (existingBooking && existingBooking.name !== name) {
      conflicts.push({ mid: cell.mid, day: cell.day, by: existingBooking.name });
      return;
    }
    const newBooking = {
      name,
      note: clip(cell.val.note, 500),
      ts: clip(cell.val.ts, 40) || new Date().toISOString(),
      gid: clip(cell.val.gid, 40),
      gtitle: clip(cell.val.gtitle, 200),
    };
    statements.upsertBooking.run(
      cell.mid,
      cell.day,
      newBooking.name,
      newBooking.note,
      newBooking.ts,
      newBooking.gid,
      newBooking.gtitle,
    );
    changes.push({ mid: cell.mid, day: cell.day, val: bookingOut(newBooking) });
  } else {
    // delete — abort the cell if it was taken over by someone else in the meantime
    if (existingBooking && cell.prev && existingBooking.name !== cell.prev.name) {
      conflicts.push({ mid: cell.mid, day: cell.day, by: existingBooking.name });
      return;
    }
    if (existingBooking) {
      statements.deleteBooking.run(cell.mid, cell.day);
      changes.push({ mid: cell.mid, day: cell.day, val: null });
    }
  }
}

/** Add server-side weekend bridges for the machines the client just changed (6.3, ADD
 *  direction), appending them to `changes` so they broadcast to every client. */
function addWeekendBridges(db: Db, changes: MutateChange[]): void {
  const affectedMachineIds = [...new Set(changes.map((change) => change.mid))];
  const bridges = maintainBridges(db, affectedMachineIds, new Date().toISOString());
  for (const bridge of bridges) {
    changes.push({
      mid: bridge.mid,
      day: bridge.day,
      val: bookingOut({ name: bridge.name, ts: null, note: null, gid: null, gtitle: null }),
    });
  }
}

function applyCells(
  db: Db,
  cells: CellDelta[],
  who: string,
  note: string | null,
  broadcast: Broadcast,
  bridge: boolean,
): MutateResult {
  if (cells.length > 1000) return { error: 'Zu viele Zellen (max. 1000)' };
  const machineById = new Map(
    (db.prepare('SELECT * FROM machines').all() as unknown as MachineRow[]).map(
      (machine) => [machine.id, machine] as const,
    ),
  );
  const validationError = validateCells(cells, machineById);
  if (validationError) return { error: validationError };
  const changes: MutateChange[] = [];
  const conflicts: MutateConflict[] = [];
  let applied = 0;
  db.exec('BEGIN');
  try {
    const statements: BookingStatements = {
      findExistingBooking: db.prepare('SELECT * FROM bookings WHERE mid=? AND day=?'),
      upsertBooking:
        db.prepare(`INSERT INTO bookings(mid,day,name,note,ts,gid,gtitle) VALUES(?,?,?,?,?,?,?)
                      ON CONFLICT(mid,day) DO UPDATE SET name=excluded.name,note=excluded.note,ts=excluded.ts,gid=excluded.gid,gtitle=excluded.gtitle`),
      deleteBooking: db.prepare('DELETE FROM bookings WHERE mid=? AND day=?'),
    };
    for (const cell of cells) {
      writeCell(cell, machineById.get(cell.mid)!, statements, changes, conflicts);
    }
    // Must run BEFORE addWeekendBridges below — `applied` counts only the client's own
    // requested changes, and addWeekendBridges appends more entries to `changes`.
    applied = changes.length;
    if (bridge) addWeekendBridges(db, changes);
    if (note) logAction(db, who, note);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('mutate/cells:', (error as Error).message);
    return { error: 'Speichern fehlgeschlagen' };
  }
  const rev = bumpRev(db);
  if (changes.length) broadcast('update', { rev, changes, by: who, log: note });
  return { ok: true, rev, applied, conflicts };
}

/**
 * The single write entry point. Dispatches to the structural path (a full machine list)
 * or the cell-delta path, validating server-side. `broadcast` defaults to a noop so the
 * reducer can be unit-tested without a live SSE server; `bridge` toggles the weekend
 * auto-bridging maintain hook (on by default — the decided Phase 6.3 scope).
 */
export function applyMutate(
  db: Db,
  body: MutateBody,
  broadcast: Broadcast = () => {},
  bridge = true,
): MutateResult {
  const who = String(body.user || '?').slice(0, 80);
  const note = body.log ? String(body.log).slice(0, 200) : null;
  if (Array.isArray(body.machines))
    return applyStructural(db, body.machines as InMachine[], body.groups, who, note, broadcast);
  if (Array.isArray(body.cells)) return applyCells(db, body.cells, who, note, broadcast, bridge);
  return { error: 'Nichts zu tun' };
}
