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
  const cols = (db.prepare('PRAGMA table_info(machines)').all() as { name: string }[]).map(
    (c) => c.name,
  );
  if (!cols.includes('redu')) db.exec('ALTER TABLE machines ADD COLUMN redu TEXT');
  if (!cols.includes('days')) db.exec('ALTER TABLE machines ADD COLUMN days TEXT');
  if (!cols.includes('maint')) db.exec('ALTER TABLE machines ADD COLUMN maint TEXT');
  if (getMeta(db, 'revision') === null) setMeta(db, 'revision', '0');
  if (getMeta(db, 'schema_version') === null) setMeta(db, 'schema_version', '1');
  return db;
}

export function getMeta(db: Db, k: string): string | null {
  const r = db.prepare('SELECT value FROM meta WHERE key=?').get(k) as
    { value: string } | undefined;
  return r ? r.value : null;
}
export function setMeta(db: Db, k: string, v: string | number): void {
  db.prepare(
    'INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run(k, String(v));
}
export function bumpRev(db: Db): number {
  const r = (parseInt(getMeta(db, 'revision') || '0') || 0) + 1;
  setMeta(db, 'revision', r);
  return r;
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

/** `v || null` as a call, so the many optional seed columns don't inflate complexity. */
const orNull = (v: string | undefined): string | null => v || null;

/** Insert the seed machines (INSERT OR REPLACE), preserving array order as `sort`. */
function seedMachines(db: Db, machines: SeedMachine[]): void {
  const im =
    db.prepare(`INSERT OR REPLACE INTO machines(id,name,grp,cat,status,statusNote,statusFrom,statusUntil,info,redu,days,maint,sort)
                         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  machines.forEach((m, i) =>
    im.run(
      m.id,
      m.name,
      orNull(m.group),
      orNull(m.cat),
      m.status || 'ok',
      m.statusNote || '',
      orNull(m.statusFrom),
      orNull(m.statusUntil),
      m.info || '',
      orNull(m.redu),
      orNull(m.days),
      Array.isArray(m.maint) && m.maint.length ? JSON.stringify(m.maint) : null,
      i,
    ),
  );
}

/** Insert the seed bookings; returns the count written. */
function seedBookings(db: Db, bookings: Record<string, Record<string, SeedBooking>>): number {
  const ib = db.prepare(
    'INSERT OR REPLACE INTO bookings(mid,day,name,note,ts,gid,gtitle) VALUES(?,?,?,?,?,?,?)',
  );
  let nb = 0;
  for (const [mid, mb] of Object.entries(bookings))
    for (const [day, b] of Object.entries(mb)) {
      ib.run(mid, day, b.name, orNull(b.note), orNull(b.ts), orNull(b.gid), orNull(b.gtitle));
      nb++;
    }
  return nb;
}

// One-time seed from an existing buchungen.json (the current file-based data).
// Idempotent: skips if the DB already has machines, unless force=true.
export function importFromJson(db: Db, jsonPath: string, { force = false } = {}): ImportResult {
  const have = (db.prepare('SELECT COUNT(*) c FROM machines').get() as { c: number }).c;
  if (have > 0 && !force) return { skipped: true, machines: have };
  const j = JSON.parse(readFileSync(jsonPath, 'utf8')) as SeedJson;
  db.exec('BEGIN');
  try {
    if (force) db.exec('DELETE FROM bookings; DELETE FROM machines;');
    seedMachines(db, j.machines || []);
    const nb = seedBookings(db, j.bookings || {});
    setMeta(db, 'groups', JSON.stringify(j.groups || []));
    db.exec('COMMIT');
    return { skipped: false, machines: (j.machines || []).length, bookings: nb };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
