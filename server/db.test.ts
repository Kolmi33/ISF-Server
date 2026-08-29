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
  it('creates the schema and seeds default meta', () => {
    const db = openDb(':memory:');
    expect(getMeta(db, 'revision')).toBe('0');
    expect(getMeta(db, 'schema_version')).toBe('1');
    const cols = (db.prepare('PRAGMA table_info(machines)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(expect.arrayContaining(['redu', 'days', 'maint']));
  });

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
});

describe('meta helpers', () => {
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
