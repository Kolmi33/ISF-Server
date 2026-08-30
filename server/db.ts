// db.ts — SQLite (built-in node:sqlite) open + schema + meta helpers + import.
// Zero external dependencies. All writes go through the single server process, so
// SQLite serialises them for us (no client-side lock/merge logic needed). Faithful
// port of the former src/db.mjs.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

// node:sqlite is a very new built-in. Load it through createRequire rather than a static
// `import … from 'node:sqlite'`, so neither Vite (in the tests) nor any bundler tries to
// resolve it as a package — Node loads it natively at runtime, and the compiled build
// keeps working unchanged. The type still comes from @types/node (erased, no runtime cost).
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

/** The open database handle type (node:sqlite's synchronous API). */
export type Db = InstanceType<typeof DatabaseSync>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS machines(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grp TEXT,
  cat TEXT,                       -- 'messtechnik' or NULL (= Maschine)
  status TEXT DEFAULT 'ok',
  statusNote TEXT DEFAULT '',
  statusFrom TEXT,
  statusUntil TEXT,
  info TEXT DEFAULT '',
  redu TEXT,                      -- Redundanz-Markierung (nur Label; keine Buchungswirkung)
  days TEXT,                      -- verfügbare Wochentage als 7-Zeichen-Maske Mo..So ('1'=verfügbar); NULL = jeden Tag
  maint TEXT,                     -- Wartungs-/Ausfall-Slots als JSON-Array [{type,from,until,note}]; NULL = keine
  sort INTEGER
);
CREATE TABLE IF NOT EXISTS bookings(
  mid TEXT NOT NULL,
  day TEXT NOT NULL,              -- ISO 'YYYY-MM-DD'
  name TEXT NOT NULL,
  note TEXT,
  ts TEXT,
  gid TEXT,                       -- booking-group id (NULL = single)
  gtitle TEXT,
  PRIMARY KEY(mid, day)
);
CREATE INDEX IF NOT EXISTS idx_bookings_gid ON bookings(gid);
CREATE INDEX IF NOT EXISTS idx_bookings_day ON bookings(day);
CREATE TABLE IF NOT EXISTS log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT, user TEXT, action TEXT
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
`;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;'); // concurrent readers + durable writes
  db.exec('PRAGMA synchronous = NORMAL;'); // safe with WAL, faster
  db.exec('PRAGMA busy_timeout = 4000;');
  db.exec(SCHEMA);
  // Migration: 'redu'/'days'/'maint' columns retro-fitted into existing DBs (no data loss)
  const existingColumnNames = (
    db.prepare('PRAGMA table_info(machines)').all() as { name: string }[]
  ).map((column) => column.name);
  if (!existingColumnNames.includes('redu')) db.exec('ALTER TABLE machines ADD COLUMN redu TEXT');
  if (!existingColumnNames.includes('days')) db.exec('ALTER TABLE machines ADD COLUMN days TEXT');
  if (!existingColumnNames.includes('maint')) {
    db.exec('ALTER TABLE machines ADD COLUMN maint TEXT');
  }
  if (getMeta(db, 'revision') === null) setMeta(db, 'revision', '0');
  if (getMeta(db, 'schema_version') === null) setMeta(db, 'schema_version', '1');
  return db;
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key) as
    { value: string } | undefined;
  return row ? row.value : null;
}
export function setMeta(db: Db, key: string, value: string | number): void {
  db.prepare(
    'INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run(key, String(value));
}
export function bumpRev(db: Db): number {
  // `|| '0'` guards a never-set meta row; `|| 0` guards parseInt returning NaN on a
  // corrupt/non-numeric value — either way we fall back to revision 0 before bumping.
  const newRevision = (parseInt(getMeta(db, 'revision') || '0') || 0) + 1;
  setMeta(db, 'revision', newRevision);
  return newRevision;
}

/** A machine as it appears in the JSON seed (wire shape: `group`, not `grp`). */
interface SeedMachine {
  id: string;
  name: string;
  group?: string;
  cat?: string;
  status?: string;
  statusNote?: string;
  statusFrom?: string;
  statusUntil?: string;
  info?: string;
  redu?: string;
  days?: string;
  maint?: unknown[];
}
interface SeedBooking {
  name: string;
  note?: string;
  ts?: string;
  gid?: string;
  gtitle?: string;
}
/** The JSON seed shape (a subset of the wire ServerData). */
interface SeedJson {
  machines?: SeedMachine[];
  bookings?: Record<string, Record<string, SeedBooking>>;
  groups?: string[];
}

/** Result of an import: skipped (DB already seeded) or the counts inserted. */
export interface ImportResult {
  skipped: boolean;
  machines: number;
  bookings?: number;
}

/** `value || null` as a call, so the many optional seed columns don't inflate complexity. */
const orNull = (value: string | undefined): string | null => value || null;

/** Insert the seed machines (INSERT OR REPLACE), preserving array order as `sort`. */
function seedMachines(db: Db, machines: SeedMachine[]): void {
  const insertMachine =
    db.prepare(`INSERT OR REPLACE INTO machines(id,name,grp,cat,status,statusNote,statusFrom,statusUntil,info,redu,days,maint,sort)
                         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  machines.forEach((machine, sortIndex) =>
    insertMachine.run(
      machine.id,
      machine.name,
      orNull(machine.group),
      orNull(machine.cat),
      machine.status || 'ok',
      machine.statusNote || '',
      orNull(machine.statusFrom),
      orNull(machine.statusUntil),
      machine.info || '',
      orNull(machine.redu),
      orNull(machine.days),
      Array.isArray(machine.maint) && machine.maint.length ? JSON.stringify(machine.maint) : null,
      sortIndex,
    ),
  );
}

/** Insert the seed bookings; returns the count written. */
function seedBookings(db: Db, bookings: Record<string, Record<string, SeedBooking>>): number {
  const insertBooking = db.prepare(
    'INSERT OR REPLACE INTO bookings(mid,day,name,note,ts,gid,gtitle) VALUES(?,?,?,?,?,?,?)',
  );
  let insertedCount = 0;
  for (const [mid, machineBookings] of Object.entries(bookings)) {
    for (const [day, booking] of Object.entries(machineBookings)) {
      insertBooking.run(
        mid,
        day,
        booking.name,
        orNull(booking.note),
        orNull(booking.ts),
        orNull(booking.gid),
        orNull(booking.gtitle),
      );
      insertedCount++;
    }
  }
  return insertedCount;
}

// One-time seed from an existing buchungen.json (the current file-based data).
// Idempotent: skips if the DB already has machines, unless force=true.
export function importFromJson(db: Db, jsonPath: string, { force = false } = {}): ImportResult {
  const existingMachineCount = (
    db.prepare('SELECT COUNT(*) c FROM machines').get() as { c: number }
  ).c;
  if (existingMachineCount > 0 && !force) {
    return { skipped: true, machines: existingMachineCount };
  }
  const seedJson = JSON.parse(readFileSync(jsonPath, 'utf8')) as SeedJson;
  db.exec('BEGIN');
  try {
    if (force) db.exec('DELETE FROM bookings; DELETE FROM machines;');
    seedMachines(db, seedJson.machines || []);
    const bookingCount = seedBookings(db, seedJson.bookings || {});
    setMeta(db, 'groups', JSON.stringify(seedJson.groups || []));
    db.exec('COMMIT');
    return { skipped: false, machines: (seedJson.machines || []).length, bookings: bookingCount };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
