import { describe, it, expect } from 'vitest';
import { openDb, type Db } from './db.ts';
import { missingBridges, maintainBridges, backfillBridges, type BookingMap } from './bridge.ts';

// Anchors (UTC): 2021-01-08 Fri, 09 Sat, 10 Sun, 11 Mon; 2021-01-15 Fri, 18 Mon.
function mem(): Db {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO machines(id,name,grp,sort) VALUES(?,?,?,0)').run('m1', 'M', 'A');
  return db;
}
function book(db: Db, machineId: string, day: string, name: string, gid = 'g1'): void {
  db.prepare('INSERT INTO bookings(mid,day,name,ts,gid) VALUES(?,?,?,?,?)').run(
    machineId,
    day,
    name,
    't0',
    gid,
  );
}
const days = (db: Db, machineId: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of db
    .prepare('SELECT day,name FROM bookings WHERE mid=?')
    .all(machineId) as unknown as {
    day: string;
    name: string;
  }[])
    out[r.day] = r.name;
  return out;
};

describe('missingBridges (pure)', () => {
  const map = (mb: Record<string, string>): BookingMap => ({
    m1: Object.fromEntries(Object.entries(mb).map(([d, name]) => [d, { name, gid: 'g1' }])),
  });

  // What: a booked Friday with the following Monday also booked bridges BOTH weekend days,
  // carrying the Friday's own name (not the Monday's, even if a different person).
  // How: books a Friday under one name and the following Monday under another, and checks
  // both weekend days are proposed with the Friday's name.
  it('bridges Sat+Sun of a Fri→Mon span with the Friday name', () => {
    expect(missingBridges(map({ '2021-01-08': 'Alice', '2021-01-11': 'Bob' }))).toEqual([
      { machineId: 'm1', day: '2021-01-09', name: 'Alice', gid: 'g1' },
      { machineId: 'm1', day: '2021-01-10', name: 'Alice', gid: 'g1' },
    ]);
  });

  // What: a booked Friday with no booked Monday after it isn't a real span — nothing to bridge.
  // How: books only the Friday and checks the result is empty.
  it('adds nothing when the Monday is not booked', () => {
    expect(missingBridges(map({ '2021-01-08': 'Alice' }))).toEqual([]);
  });

  // What: only the weekend day that's ACTUALLY missing is proposed — an already-bridged day
  // isn't re-proposed.
  // How: books Friday, Saturday, and Monday (Sunday left free) and checks only Sunday is proposed.
  it('only fills the weekend day that is missing', () => {
    const r = missingBridges(
      map({ '2021-01-08': 'Alice', '2021-01-09': 'Alice', '2021-01-11': 'Bob' }),
    );
    expect(r).toEqual([{ machineId: 'm1', day: '2021-01-10', name: 'Alice', gid: 'g1' }]);
  });

  // What: a booked Monday with no booked Friday before it isn't a span either, and a machine
  // with no bookings at all trivially has nothing to bridge.
  // How: checks a Monday-only booking and an entirely empty machine both yield nothing.
  it('ignores non-Friday bookings and skips machines with no bookings', () => {
    expect(missingBridges(map({ '2021-01-11': 'Bob' }))).toEqual([]); // Monday only
    expect(missingBridges({ m1: {} })).toEqual([]);
  });
});

describe('maintainBridges (in-DB)', () => {
  // What: maintainBridges actually inserts the missing bridge days into the database, but
  // never overwrites a cell someone else already booked (even if it "should" be a bridge day).
  // How: books a Fri→Mon span with Sunday already taken by someone else, runs maintainBridges,
  // and checks only Saturday got inserted while Sunday's existing booking survives untouched.
  it('inserts the missing bridges and never overwrites an existing cell', () => {
    const db = mem();
    book(db, 'm1', '2021-01-08', 'Alice'); // Fri
    book(db, 'm1', '2021-01-10', 'KEEP'); // Sun already taken by someone
    book(db, 'm1', '2021-01-11', 'Bob'); // Mon
    const added = maintainBridges(db, ['m1'], 'ts1');
    expect(added).toEqual([{ machineId: 'm1', day: '2021-01-09', name: 'Alice', gid: 'g1' }]); // only Sat
    const d = days(db, 'm1');
    expect(d['2021-01-09']).toBe('Alice');
    expect(d['2021-01-10']).toBe('KEEP'); // untouched
    expect(
      (
        db.prepare('SELECT gid FROM bookings WHERE mid=? AND day=?').get('m1', '2021-01-09') as {
          gid: string;
        }
      ).gid,
    ).toBe('g1');
  });

  // What: an empty machineIds list, or a machine list with nothing to bridge, both correctly
  // return an empty result rather than erroring.
  // How: checks an empty machineIds array, then a real machine with only a lone Monday booking
  // (no span to bridge).
  it('returns [] for empty machineIds or when nothing is missing', () => {
    const db = mem();
    expect(maintainBridges(db, [], 'ts')).toEqual([]);
    book(db, 'm1', '2021-01-11', 'Bob'); // Monday only → no span
    expect(maintainBridges(db, ['m1'], 'ts')).toEqual([]);
  });
});

describe('backfillBridges (whole DB)', () => {
  // What: backfillBridges finds and fills every missing bridge across ALL machines in the DB
  // in one pass, and running it again afterward is a no-op (idempotent) since nothing is
  // missing anymore.
  // How: sets up two separate Fri→Mon spans on two different machines, runs backfillBridges
  // once (checks it inserted exactly 4 rows — 2 machines × Sat+Sun — and spot-checks two of
  // them), then runs it again and checks it now inserts 0.
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

  // What: a freshly-seeded DB with no bookings at all has nothing to bridge.
  // How: runs backfillBridges on a bare DB and checks it returns 0.
  it('returns 0 when there is nothing to bridge', () => {
    expect(backfillBridges(mem())).toBe(0);
  });
});
