// =======================================================================================
// DATABASE INITIALIZATION & SCHEMA ENGINE (server/db.ts)
// =======================================================================================
//
// Persistent storage engine backed by Node's native SQLite driver (`node:sqlite`).
//
// Responsibilities:
// 1. Database Lifecycle: Opens database files, enables WAL (Write-Ahead Logging) for fast concurrent
//    reads and safe single-writer serialization, and applies busy timeouts.
// 2. Schema Creation & Auto-Migration: Creates tables (`machines`, `bookings`, `log`, `meta`) and
//    safely adds new optional columns without data loss.
// 3. Metadata & Revisioning: Maintains system metadata and manages the monotonic `revision` counter.
// 4. Seed Importer: Provides idempotent JSON seeding for initial database population.
//
// =======================================================================================
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Load Node's built-in sqlite module via dynamic require
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

/** The open database handle instance type (synchronous API). */
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
  redu TEXT,                      -- Redundancy marker label (UI grouping only)
  days TEXT,                      -- 7-character Mo..So availability mask ('1' = available)
  maint TEXT,                     -- Maintenance / defect slots JSON array [{type,from,until,note}]
  sort INTEGER
);
CREATE TABLE IF NOT EXISTS bookings(
  mid TEXT NOT NULL,
  day TEXT NOT NULL,              -- ISO 'YYYY-MM-DD'
  name TEXT NOT NULL,
  note TEXT,
  ts TEXT,
  gid TEXT,                       -- Booking group ID (NULL = single cell reservation)
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

/**
 * Opens or creates the SQLite database, configures pragmas, applies the schema, and executes auto-migrations.
 */
export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 4000;');
  db.exec(SCHEMA);

  // Column auto-migrations for additive non-breaking schema updates
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

/**
 * Reads a metadata string value by key from the `meta` table, returning null if unset.
 */
export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key) as
    { value: string } | undefined;
  return row ? row.value : null;
}

/**
 * Writes or updates a key-value pair in the `meta` table.
 */
export function setMeta(db: Db, key: string, value: string | number): void {
  db.prepare(
    'INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run(key, String(value));
}

/**
 * Atomically increments and persists the monotonic database revision counter. Returns the new revision number.
 */
export function bumpRev(db: Db): number {
  const newRevision = (parseInt(getMeta(db, 'revision') || '0') || 0) + 1;
  setMeta(db, 'revision', newRevision);
  return newRevision;
}

/** Machine structure parsed from JSON seed files. */
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

/** Top-level structure of a JSON seed file. */
interface SeedJson {
  machines?: SeedMachine[];
  bookings?: Record<string, Record<string, SeedBooking>>;
  groups?: string[];
}

/** Result summary of a database seed import operation. */
export interface ImportResult {
  skipped: boolean;
  machines: number;
  bookings?: number;
}

const orNull = (value: string | undefined): string | null => value || null;

/**
 * Inserts machines from seed data, preserving original array index as the sort order.
 */
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

/**
 * Inserts booking cell records from seed data into the database.
 */
function seedBookings(db: Db, bookings: Record<string, Record<string, SeedBooking>>): number {
  const insertBooking = db.prepare(
    'INSERT OR REPLACE INTO bookings(mid,day,name,note,ts,gid,gtitle) VALUES(?,?,?,?,?,?,?)',
  );
  let insertedCount = 0;
  for (const [machineId, machineBookings] of Object.entries(bookings)) {
    for (const [day, booking] of Object.entries(machineBookings)) {
      insertBooking.run(
        machineId,
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

/**
 * Idempotently seeds an empty database from a JSON file.
 */
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
