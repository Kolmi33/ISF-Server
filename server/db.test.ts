import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, getMeta, setMeta, bumpRev, importFromJson } from './db.ts';

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'mp-db-'));
}

describe('openDb', () => {
  // What: opening a fresh DB applies the full schema and seeds the default meta values
  // (revision 0, schema_version 2).
  // How: opens an in-memory DB and checks both meta values and that the newer optional
  // columns (redu/days/maint) exist on the machines table.
  it('creates the schema and seeds default meta', () => {
    const db = openDb(':memory:');
    expect(getMeta(db, 'revision')).toBe('0');
    expect(getMeta(db, 'schema_version')).toBe('2');
    const cols = (db.prepare('PRAGMA table_info(machines)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(expect.arrayContaining(['redu', 'days', 'maint']));
  });

  // What: opening an EXISTING database file created before redu/days/maint existed
  // retro-fits those columns onto it, without touching or losing the DB's other data.
  // How: creates a raw SQLite file with the pre-migration schema (no redu/days/maint), then
  // opens it through openDb() and checks the columns now exist.
  it('migrates an old machines table by adding redu/days/maint', () => {
    const dir = tmp();
    const path = join(dir, 'old.db');
    try {
      const raw = new DatabaseSync(path);
      raw.exec('CREATE TABLE machines(id TEXT PRIMARY KEY, name TEXT, grp TEXT, sort INTEGER)');
      raw.close();
      const db = openDb(path); // runs the ALTER-TABLE migrations
      const cols = (db.prepare('PRAGMA table_info(machines)').all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).toEqual(expect.arrayContaining(['redu', 'days', 'maint']));
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates legacy workday runs and their weekend bridges into stable groups', () => {
    const dir = tmp();
    const path = join(dir, 'groups-v1.db');
    try {
      const initial = openDb(path);
      initial.prepare('INSERT INTO machines(id,name) VALUES(?,?)').run('m1', 'M1');
      initial
        .prepare('INSERT INTO bookings(mid,day,name,gid) VALUES(?,?,?,?)')
        .run('m1', '2021-01-08', 'Alice', null); // Friday
      initial
        .prepare('INSERT INTO bookings(mid,day,name,gid) VALUES(?,?,?,?)')
        .run('m1', '2021-01-09', 'Alice', ''); // weekend bridge
      initial
        .prepare('INSERT INTO bookings(mid,day,name,gid) VALUES(?,?,?,?)')
        .run('m1', '2021-01-11', 'Alice', null); // next workday, same run
      initial
        .prepare('INSERT INTO bookings(mid,day,name,gid) VALUES(?,?,?,?)')
        .run('m1', '2021-01-13', 'Alice', null); // gap, separate run
      setMeta(initial, 'schema_version', '1');
      initial.close();

      const migrated = openDb(path);
      const rows = migrated.prepare('SELECT gid FROM bookings ORDER BY day').all() as unknown as {
        gid: string;
      }[];
      expect(rows.every((row) => row.gid.startsWith('g_legacy_'))).toBe(true);
      expect(rows[0]!.gid).toBe(rows[1]!.gid);
      expect(rows[1]!.gid).toBe(rows[2]!.gid);
      expect(rows[3]!.gid).not.toBe(rows[2]!.gid);
      expect(new Set(rows.map((row) => row.gid)).size).toBe(2);
      expect(getMeta(migrated, 'schema_version')).toBe('2');
      expect(getMeta(migrated, 'revision')).toBe('1');
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('meta helpers', () => {
  // What: getMeta/setMeta round-trip values (coercing a number to its string form), and
  // bumpRev always increments correctly, even starting from a completely absent revision row.
  // How: checks an unset key reads null, a set-then-get round-trips a string, a numeric value
  // gets stringified, then deletes the meta table entirely and checks bumpRev still correctly
  // starts from 0 (→1) and continues incrementing (→2) from there.
  it('get/set round-trips and bumpRev increments from any state', () => {
    const db = openDb(':memory:');
    expect(getMeta(db, 'nope')).toBeNull();
    setMeta(db, 'k', 'v');
    expect(getMeta(db, 'k')).toBe('v');
    setMeta(db, 'k', 5); // number coerced to string
    expect(getMeta(db, 'k')).toBe('5');
    db.prepare('DELETE FROM meta').run();
    expect(bumpRev(db)).toBe(1); // absent revision → 0 + 1
    expect(bumpRev(db)).toBe(2);
  });
});

describe('importFromJson', () => {
  const SEED = {
    groups: ['G'],
    machines: [
      {
        id: 'a',
        name: 'Alpha',
        group: 'G',
        cat: 'messtechnik',
        days: '1111100',
        maint: [{ type: 'wartung' }],
      },
      { id: 'b', name: 'Beta' },
    ],
    bookings: { a: { '2021-01-04': { name: 'Alice', ts: 't', note: 'n' } } },
  };

  // What: a first import populates machines, bookings, and groups from the seed JSON,
  // reporting the counts it inserted, and correctly writes optional fields (cat, maint as a
  // JSON-serialized array).
  // How: imports a seed with 2 machines/1 booking/1 group into a fresh DB and checks the
  // reported counts, the persisted groups meta, and one machine's cat/maint fields.
  it('seeds machines, bookings, and groups from a JSON file', () => {
    const dir = tmp();
    const path = join(dir, 'seed.json');
    try {
      writeFileSync(path, JSON.stringify(SEED));
      const db = openDb(':memory:');
      const r = importFromJson(db, path);
      expect(r).toEqual({ skipped: false, machines: 2, bookings: 1 });
      expect(getMeta(db, 'groups')).toBe(JSON.stringify(['G']));
      const a = db.prepare('SELECT * FROM machines WHERE id=?').get('a') as {
        cat: string;
        maint: string;
      };
      expect(a.cat).toBe('messtechnik');
      expect(JSON.parse(a.maint)).toEqual([{ type: 'wartung' }]);
      const booking = db.prepare('SELECT gid FROM bookings').get() as { gid: string };
      expect(booking.gid).toMatch(/^g_legacy_/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // What: if any part of the seed insert fails partway through, the whole import rolls back
  // — no partial data is left behind — and the failure propagates to the caller as a thrown error.
  // How: drops the bookings table before importing (so the booking insert inside the
  // transaction throws), checks importFromJson itself throws, and checks the machines table
  // ended up empty (the machine inserts that happened before the failure were rolled back too).
  it('rolls back and rethrows when a seed insert fails', () => {
    const dir = tmp();
    const path = join(dir, 'seed.json');
    try {
      writeFileSync(path, JSON.stringify(SEED));
      const db = openDb(':memory:');
      db.exec('DROP TABLE bookings'); // seedBookings' prepare throws mid-transaction
      expect(() => importFromJson(db, path)).toThrow();
      expect((db.prepare('SELECT COUNT(*) c FROM machines').get() as { c: number }).c).toBe(0); // rolled back
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // What: importing into a DB that already has machines is a no-op UNLESS `force` is given —
  // and with force, the existing data is wiped and replaced by the new seed entirely.
  // How: imports once (populates the DB), imports again without force (checks it's skipped,
  // reporting the existing count), then writes a different seed file and imports with
  // force:true, checking the DB now reflects only the new seed's single machine.
  it('skips a non-empty DB unless forced', () => {
    const dir = tmp();
    const path = join(dir, 'seed.json');
    try {
      writeFileSync(path, JSON.stringify(SEED));
      const db = openDb(':memory:');
      importFromJson(db, path);
      expect(importFromJson(db, path)).toEqual({ skipped: true, machines: 2 });
      // force wipes and re-imports
      writeFileSync(
        path,
        JSON.stringify({ machines: [{ id: 'z', name: 'Z' }], bookings: {}, groups: [] }),
      );
      const r = importFromJson(db, path, { force: true });
      expect(r).toEqual({ skipped: false, machines: 1, bookings: 0 });
      expect(db.prepare('SELECT id FROM machines').all()).toEqual([{ id: 'z' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
