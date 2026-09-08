// =======================================================================================
// SERVER MUTATION ENGINE (server/mutate.ts)
// =======================================================================================
//
// Core server-side write pipeline handling transactional mutations from `/api/mutate`.
//
// Responsibilities:
// 1. Structural Management Path: Atomically replaces the machine list and group configurations in
//    a single transaction with orphan cleanup for deleted machines.
// 2. Cell Delta Path: Executes fine-grained Compare-And-Set (CAS) booking creations and deletions,
//    enforcing machine availability masks, maintenance blocks, and foreign booking protection.
// 3. Automated Weekend Bridging: Automatically maintains weekend bridge days (Fri->Mon) on the server.
// 4. Concurrency Control: Increments monotonic database revision numbers (`rev`) and broadcasts
//    live updates to all connected browser clients via Server-Sent Events (SSE).
// 5. Defensive Input Validation: Sanitizes and clamps all untrusted payload fields before DB execution.
//
// =======================================================================================
import type { Db } from './db.js';
import { bumpRev, setMeta } from './db.js';
import { maintainBridges } from './bridge.js';
import { bookingOut, blockReason, isDayAvailable } from './model.js';
import { createBookingGroupId } from './booking-groups.js';
import type {
  BookingRow,
  CellDelta,
  MachineRow,
  MutateBody,
  MutateChange,
  MutateConflict,
  MutateResult,
} from './types.js';

/** SSE broadcast sink function to push events to active browser clients. */
export type Broadcast = (event: string, data: unknown) => void;

type Stmt = ReturnType<Db['prepare']>;

/** Regular expression validating standard ISO 'YYYY-MM-DD' calendar date strings. */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Clamps an untrusted string to `maxLength` characters. Returns null if empty or non-string.
 */
const clip = (value: unknown, maxLength: number): string | null =>
  value == null ? null : String(value).slice(0, maxLength) || null;

/**
 * Writes an action entry to the database audit log table.
 */
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

/* ---------------- Structural Management Path (Machines / Groups) ---------------- */

/** Untrusted machine payload structure received from the client. */
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

/**
 * Validates the structure and uniqueness of the received machine list before writing.
 */
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

/**
 * Validates and serializes a machine's maintenance slots into sanitized JSON.
 */
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

/**
 * Inserts a single machine record into SQLite with sanitized fields and sort order.
 */
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

/**
 * Atomically replaces the machine list and group definitions in a single database transaction.
 * Automatically removes orphaned bookings for deleted machines and broadcasts the update.
 */
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
      const clampedGroupNames = groups.map((group) => String(group).slice(0, 120));
      setMeta(db, 'groups', JSON.stringify(clampedGroupNames.slice(0, 500)));
    }
    db.exec('DELETE FROM bookings WHERE mid NOT IN (SELECT id FROM machines)');
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

/* ---------------- Cell Delta Path (Bookings / Deletions) ---------------- */

/**
 * Validates a list of cell deltas against existing machines and required fields.
 */
function validateCells(cells: CellDelta[], machineById: Map<string, MachineRow>): string | null {
  for (const cell of cells) {
    if (!cell || typeof cell.machineId !== 'string' || !DAY_RE.test(cell.day || '')) {
      return 'Ungültige Zelle';
    }
    if (!machineById.has(cell.machineId)) return 'Unbekannte Maschine: ' + cell.machineId;
    if (cell.val && !String(cell.val.name || '').trim()) return 'Name fehlt';
  }
  return null;
}

/** Prepared statements used during cell write transactions. */
interface BookingStatements {
  findExistingBooking: Stmt;
  upsertBooking: Stmt;
  deleteBooking: Stmt;
}

/** Resolves group membership without allowing a partial update to detach an existing cell. */
function bookingGroupId(
  value: unknown,
  existing: BookingRow | undefined,
  fallback: string,
): string {
  return clip(value, 40)?.trim() || existing?.gid || fallback;
}

/**
 * Applies a single cell modification (insert/update or delete) with conflict checks.
 */
function writeCell(
  cell: CellDelta,
  machine: MachineRow,
  statements: BookingStatements,
  changes: MutateChange[],
  conflicts: MutateConflict[],
  operationGroupId: string,
): void {
  const existingBooking = statements.findExistingBooking.get(cell.machineId, cell.day) as
    BookingRow | undefined;
  if (cell.val) {
    // Booking insertion / update: enforce maintenance blocks and weekday availability
    const name = String(cell.val.name).trim();
    const reason = blockReason(machine, cell.day);
    if (reason) {
      conflicts.push({ machineId: cell.machineId, day: cell.day, by: reason });
      return;
    }
    if (!isDayAvailable(machine, cell.day)) {
      conflicts.push({
        machineId: cell.machineId,
        day: cell.day,
        by: 'nicht verfügbar (Wochentag)',
      });
      return;
    }
    if (existingBooking && existingBooking.name !== name) {
      conflicts.push({ machineId: cell.machineId, day: cell.day, by: existingBooking.name });
      return;
    }
    const newBooking = {
      name,
      note: clip(cell.val.note, 500),
      ts: clip(cell.val.ts, 40) || new Date().toISOString(),
      gid: bookingGroupId(cell.val.gid, existingBooking, operationGroupId),
      gtitle: clip(cell.val.gtitle, 200),
    };
    statements.upsertBooking.run(
      cell.machineId,
      cell.day,
      newBooking.name,
      newBooking.note,
      newBooking.ts,
      newBooking.gid,
      newBooking.gtitle,
    );
    changes.push({ machineId: cell.machineId, day: cell.day, val: bookingOut(newBooking) });
  } else {
    // Cell deletion: verify that the cell was not concurrently modified by another user
    if (existingBooking && cell.prev && existingBooking.name !== cell.prev.name) {
      conflicts.push({ machineId: cell.machineId, day: cell.day, by: existingBooking.name });
      return;
    }
    if (existingBooking) {
      statements.deleteBooking.run(cell.machineId, cell.day);
      changes.push({ machineId: cell.machineId, day: cell.day, val: null });
    }
  }
}

/**
 * Invokes server-side automated weekend bridging for machines modified in the current transaction.
 */
function addWeekendBridges(db: Db, changes: MutateChange[]): void {
  const affectedMachineIds = [...new Set(changes.map((change) => change.machineId))];
  const bridges = maintainBridges(db, affectedMachineIds, new Date().toISOString());
  for (const bridge of bridges) {
    changes.push({
      machineId: bridge.machineId,
      day: bridge.day,
      val: bookingOut({
        name: bridge.name,
        ts: null,
        note: null,
        gid: bridge.gid,
        gtitle: bridge.gtitle ?? null,
      }),
    });
  }
}

/**
 * Applies a batch of cell modifications in a single database transaction.
 */
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
  const operationGroupId = createBookingGroupId();
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
      writeCell(
        cell,
        machineById.get(cell.machineId)!,
        statements,
        changes,
        conflicts,
        operationGroupId,
      );
    }
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
 * Main dispatch entry point for server mutations.
 * Directs payloads to structural management or cell delta handlers.
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
