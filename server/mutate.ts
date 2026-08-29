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
const clip = (v: unknown, n: number): string | null =>
  v == null ? null : String(v).slice(0, n) || null;

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
  const seen = new Set<string>();
  for (const m of machines) {
    if (
      !m ||
      typeof m.id !== 'string' ||
      !m.id.trim() ||
      typeof m.name !== 'string' ||
      !m.name.trim()
    )
      return 'Maschine ohne gültige id/name';
    if (seen.has(m.id)) return 'Doppelte Maschinen-id: ' + m.id;
    seen.add(m.id);
  }
  return null;
}

/** Validate + serialise a machine's maintenance slots to JSON, or null if none. */
function cleanMaint(m: InMachine): string | null {
  if (!Array.isArray(m.maint)) return null;
  const a = (m.maint as unknown[]).slice(0, 50).map((s) => {
    const t = (s || {}) as { type?: unknown; from?: unknown; until?: unknown; note?: unknown };
    return {
      type: t.type === 'defekt' ? 'defekt' : 'wartung',
      from: DAY_RE.test(String(t.from || '')) ? String(t.from) : '',
      until: DAY_RE.test(String(t.until || '')) ? String(t.until) : '',
      ...(t.note ? { note: String(t.note).slice(0, 200) } : {}),
    };
  });
  return a.length ? JSON.stringify(a) : null;
}

/** Insert one machine row from an untrusted client machine (server-side clamps/validates). */
function insertMachine(im: Stmt, m: InMachine, i: number): void {
  im.run(
    clip(m.id, 80),
    clip(m.name, 200),
    clip(m.group, 120),
    m.cat === 'messtechnik' ? 'messtechnik' : null,
    m.status === 'wartung' || m.status === 'defekt' ? m.status : 'ok',
    clip(m.statusNote, 200),
    DAY_RE.test(String(m.statusFrom || '')) ? String(m.statusFrom) : null,
    DAY_RE.test(String(m.statusUntil || '')) ? String(m.statusUntil) : null,
    clip(m.info, 300),
    clip(m.redu, 120),
    /^[01]{7}$/.test(String(m.days || '')) ? String(m.days) : null,
    cleanMaint(m),
    i,
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
  const err = structuralError(machines);
  if (err) return { error: err };
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM machines');
    const im =
      db.prepare(`INSERT INTO machines(id,name,grp,cat,status,statusNote,statusFrom,statusUntil,info,redu,days,maint,sort)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    machines.forEach((m, i) => insertMachine(im, m, i));
    if (Array.isArray(groups))
      setMeta(
        db,
        'groups',
        JSON.stringify(groups.map((g) => String(g).slice(0, 120)).slice(0, 500)),
      );
    db.exec('DELETE FROM bookings WHERE mid NOT IN (SELECT id FROM machines)'); // orphans (deleted machine)
    if (note) logAction(db, who, note);
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('mutate/structural:', (e as Error).message);
    return { error: 'Speichern fehlgeschlagen' };
  }
  const rev = bumpRev(db);
  broadcast('structural', { rev, by: who, log: note });
  return { ok: true, rev, structural: true };
}

/* ---------------- cell-delta (booking/deletion) path ---------------- */

/** Validate the cell list against the current machines; return an error or null. */
function validateCells(cells: CellDelta[], machineById: Map<string, MachineRow>): string | null {
  for (const c of cells) {
    if (!c || typeof c.mid !== 'string' || !DAY_RE.test(c.day || '')) return 'Ungültige Zelle';
    if (!machineById.has(c.mid)) return 'Unbekannte Maschine: ' + c.mid;
    if (c.val && !String(c.val.name || '').trim()) return 'Name fehlt';
  }
  return null;
}

/** Apply one cell (set or delete) inside the open transaction, collecting change/conflict. */
function writeCell(
  c: CellDelta,
  m: MachineRow,
  stmts: { cur: Stmt; up: Stmt; dl: Stmt },
  changes: MutateChange[],
  conflicts: MutateConflict[],
): void {
  const now = stmts.cur.get(c.mid, c.day) as BookingRow | undefined;
  if (c.val) {
    // set / book — enforce our own block rule + never overwrite a foreign booking
    const name = String(c.val.name).trim();
    if (isBlocked(m, c.day)) {
      conflicts.push({ mid: c.mid, day: c.day, by: `gesperrt (${m.status})` });
      return;
    }
    if (now && now.name !== name) {
      conflicts.push({ mid: c.mid, day: c.day, by: now.name });
      return;
    }
    const val = {
      name,
      note: clip(c.val.note, 500),
      ts: clip(c.val.ts, 40) || new Date().toISOString(),
      gid: clip(c.val.gid, 40),
      gtitle: clip(c.val.gtitle, 200),
    };
    stmts.up.run(c.mid, c.day, val.name, val.note, val.ts, val.gid, val.gtitle);
    changes.push({ mid: c.mid, day: c.day, val: bookingOut(val) });
  } else {
    // delete — abort the cell if it was taken over by someone else in the meantime
    if (now && c.prev && now.name !== c.prev.name) {
      conflicts.push({ mid: c.mid, day: c.day, by: now.name });
      return;
    }
    if (now) {
      stmts.dl.run(c.mid, c.day);
      changes.push({ mid: c.mid, day: c.day, val: null });
    }
  }
}

function applyCells(
  db: Db,
  cells: CellDelta[],
  who: string,
  note: string | null,
  broadcast: Broadcast,
): MutateResult {
  if (cells.length > 1000) return { error: 'Zu viele Zellen (max. 1000)' };
  const machineById = new Map(
    (db.prepare('SELECT * FROM machines').all() as unknown as MachineRow[]).map(
      (m) => [m.id, m] as const,
    ),
  );
  const err = validateCells(cells, machineById);
  if (err) return { error: err };
  const changes: MutateChange[] = [];
  const conflicts: MutateConflict[] = [];
  db.exec('BEGIN');
  try {
    const stmts = {
      cur: db.prepare('SELECT * FROM bookings WHERE mid=? AND day=?'),
      up: db.prepare(`INSERT INTO bookings(mid,day,name,note,ts,gid,gtitle) VALUES(?,?,?,?,?,?,?)
                      ON CONFLICT(mid,day) DO UPDATE SET name=excluded.name,note=excluded.note,ts=excluded.ts,gid=excluded.gid,gtitle=excluded.gtitle`),
      dl: db.prepare('DELETE FROM bookings WHERE mid=? AND day=?'),
    };
    for (const c of cells) writeCell(c, machineById.get(c.mid)!, stmts, changes, conflicts);
    if (note) logAction(db, who, note);
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('mutate/cells:', (e as Error).message);
    return { error: 'Speichern fehlgeschlagen' };
  }
  const rev = bumpRev(db);
  if (changes.length) broadcast('update', { rev, changes, by: who, log: note });
  return { ok: true, rev, applied: changes.length, conflicts };
}

/**
 * The single write entry point. Dispatches to the structural path (a full machine list)
 * or the cell-delta path, validating server-side. `broadcast` defaults to a noop so the
 * reducer can be unit-tested without a live SSE server.
 */
export function applyMutate(
  db: Db,
  body: MutateBody,
  broadcast: Broadcast = () => {},
): MutateResult {
  const who = String(body.user || '?').slice(0, 80);
  const note = body.log ? String(body.log).slice(0, 200) : null;
  if (Array.isArray(body.machines))
    return applyStructural(db, body.machines as InMachine[], body.groups, who, note, broadcast);
  if (Array.isArray(body.cells)) return applyCells(db, body.cells, who, note, broadcast);
  return { error: 'Nichts zu tun' };
}
