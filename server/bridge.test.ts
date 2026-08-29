import { describe, it, expect } from 'vitest';
import { openDb, type Db } from './db.ts';
import { missingBridges, maintainBridges, backfillBridges, type BookingMap } from './bridge.ts';

// Anchors (UTC): 2021-01-08 Fri, 09 Sat, 10 Sun, 11 Mon; 2021-01-15 Fri, 18 Mon.
function mem(): Db {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO machines(id,name,grp,sort) VALUES(?,?,?,0)').run('m1', 'M', 'A');
  return db;
}
function book(db: Db, mid: string, day: string, name: string): void {
  db.prepare('INSERT INTO bookings(mid,day,name,ts) VALUES(?,?,?,?)').run(mid, day, name, 't0');
}
const days = (db: Db, mid: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of db.prepare('SELECT day,name FROM bookings WHERE mid=?').all(mid) as unknown as {
    day: string;
    name: string;
  }[])
    out[r.day] = r.name;
  return out;
};

describe('missingBridges (pure)', () => {
  const map = (mb: Record<string, string>): BookingMap => ({
    m1: Object.fromEntries(Object.entries(mb).map(([d, name]) => [d, { name }])),
  });

  it('bridges Sat+Sun of a Fri→Mon span with the Friday name', () => {
    expect(missingBridges(map({ '2021-01-08': 'Alice', '2021-01-11': 'Bob' }))).toEqual([
      { mid: 'm1', day: '2021-01-09', name: 'Alice' }, // Sat carries Friday's (Alice) name
      { mid: 'm1', day: '2021-01-10', name: 'Alice' },
    ]);
  });

  it('adds nothing when the Monday is not booked', () => {
    expect(missingBridges(map({ '2021-01-08': 'Alice' }))).toEqual([]);
  });

  it('only fills the weekend day that is missing', () => {
    const r = missingBridges(
      map({ '2021-01-08': 'Alice', '2021-01-09': 'Alice', '2021-01-11': 'Bob' }),
    );
    expect(r).toEqual([{ mid: 'm1', day: '2021-01-10', name: 'Alice' }]);
  });

  it('ignores non-Friday bookings and skips machines with no bookings', () => {
    expect(missingBridges(map({ '2021-01-11': 'Bob' }))).toEqual([]); // Monday only
    expect(missingBridges({ m1: {} })).toEqual([]);
  });
});

describe('maintainBridges (in-DB)', () => {
  it('inserts the missing bridges and never overwrites an existing cell', () => {
    const db = mem();
    book(db, 'm1', '2021-01-08', 'Alice'); // Fri
    book(db, 'm1', '2021-01-10', 'KEEP'); // Sun already taken by someone
    book(db, 'm1', '2021-01-11', 'Bob'); // Mon
    const added = maintainBridges(db, ['m1'], 'ts1');
    expect(added).toEqual([{ mid: 'm1', day: '2021-01-09', name: 'Alice' }]); // only Sat
    const d = days(db, 'm1');
    expect(d['2021-01-09']).toBe('Alice');
    expect(d['2021-01-10']).toBe('KEEP'); // untouched
  });

  it('returns [] for empty mids or when nothing is missing', () => {
    const db = mem();
    expect(maintainBridges(db, [], 'ts')).toEqual([]);
    book(db, 'm1', '2021-01-11', 'Bob'); // Monday only → no span
    expect(maintainBridges(db, ['m1'], 'ts')).toEqual([]);
  });
});

describe('backfillBridges (whole DB)', () => {
  it('fills every missing bridge in one pass and is idempotent', () => {
    const db = mem();
    db.prepare('INSERT INTO machines(id,name,grp,sort) VALUES(?,?,?,1)').run('m2', 'M2', 'A');
    book(db, 'm1', '2021-01-08', 'Alice'); // span 1 (m1)
    book(db, 'm1', '2021-01-11', 'Alice');
    book(db, 'm2', '2021-01-15', 'Carl'); // span 2 (m2): Fri 15 → Mon 18
    book(db, 'm2', '2021-01-18', 'Carl');
    expect(backfillBridges(db)).toBe(4); // 2 machines × Sat+Sun
    expect(days(db, 'm1')['2021-01-09']).toBe('Alice');
    expect(days(db, 'm2')['2021-01-16']).toBe('Carl');
    expect(backfillBridges(db)).toBe(0); // nothing left to add
  });

  it('returns 0 when there is nothing to bridge', () => {
    expect(backfillBridges(mem())).toBe(0);
  });
});
