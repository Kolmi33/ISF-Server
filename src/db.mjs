// db.mjs — SQLite (built-in node:sqlite) open + schema + meta helpers + import.
// Zero external dependencies. All writes go through the single server process,
// so SQLite serialises them for us (no client-side lock/merge logic needed).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

export function openDb(path){
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');   // concurrent readers + durable writes
  db.exec('PRAGMA synchronous = NORMAL;'); // safe with WAL, faster
  db.exec('PRAGMA busy_timeout = 4000;');
  db.exec(SCHEMA);
  // Migration: 'redu'-Spalte in bestehenden DBs nachrüsten (kein Datenverlust)
  const cols = db.prepare('PRAGMA table_info(machines)').all().map(c=>c.name);
  if(!cols.includes('redu')) db.exec('ALTER TABLE machines ADD COLUMN redu TEXT');
  if(!cols.includes('days')) db.exec('ALTER TABLE machines ADD COLUMN days TEXT');
  if(!cols.includes('maint')) db.exec('ALTER TABLE machines ADD COLUMN maint TEXT');
  if(getMeta(db,'revision') === null) setMeta(db,'revision','0');
  if(getMeta(db,'schema_version') === null) setMeta(db,'schema_version','1');
  return db;
}

export function getMeta(db,k){ const r = db.prepare('SELECT value FROM meta WHERE key=?').get(k); return r ? r.value : null; }
export function setMeta(db,k,v){ db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v)); }
export function bumpRev(db){ const r = (parseInt(getMeta(db,'revision'))||0) + 1; setMeta(db,'revision', r); return r; }

// One-time seed from the existing buchungen.json (the current file-based data).
// Idempotent: skips if the DB already has machines, unless force=true.
export function importFromJson(db, jsonPath, { force=false } = {}){
  const have = db.prepare('SELECT COUNT(*) c FROM machines').get().c;
  if(have > 0 && !force) return { skipped:true, machines:have };
  const j = JSON.parse(readFileSync(jsonPath,'utf8'));
  db.exec('BEGIN');
  try{
    if(force){ db.exec('DELETE FROM bookings; DELETE FROM machines;'); }
    const im = db.prepare(`INSERT OR REPLACE INTO machines(id,name,grp,cat,status,statusNote,statusFrom,statusUntil,info,redu,days,maint,sort)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    (j.machines||[]).forEach((m,i)=> im.run(
      m.id, m.name, m.group||null, m.cat||null, m.status||'ok', m.statusNote||'',
      m.statusFrom||null, m.statusUntil||null, m.info||'', m.redu||null, m.days||null,
      Array.isArray(m.maint)&&m.maint.length?JSON.stringify(m.maint):null, i));
    const ib = db.prepare('INSERT OR REPLACE INTO bookings(mid,day,name,note,ts,gid,gtitle) VALUES(?,?,?,?,?,?,?)');
    let nb=0;
    for(const [mid,mb] of Object.entries(j.bookings||{}))
      for(const [day,b] of Object.entries(mb)){ ib.run(mid, day, b.name, b.note||null, b.ts||null, b.gid||null, b.gtitle||null); nb++; }
    setMeta(db,'groups', JSON.stringify(j.groups||[]));
    db.exec('COMMIT');
    return { skipped:false, machines:(j.machines||[]).length, bookings:nb };
  }catch(e){ db.exec('ROLLBACK'); throw e; }
}
