import { describe, it, expect, vi } from 'vitest';
import { openDb, getMeta, type Db } from './db.ts';
import { applyMutate } from './mutate.ts';
import type { BookingRow } from './types.ts';

function mem(): Db {
  return openDb(':memory:');
}
function addMachine(db: Db, id = 'm1', over: Record<string, string | null> = {}): void {
  const m = { name: 'M', grp: 'A', status: 'ok', ...over };
  db.prepare('INSERT INTO machines(id,name,grp,status,sort) VALUES(?,?,?,?,0)').run(
    id,
    m.name,
    m.grp,
    m.status,
  );
}
function book(db: Db, mid: string, day: string, name: string): void {
  db.prepare('INSERT INTO bookings(mid,day,name,ts) VALUES(?,?,?,?)').run(mid, day, name, 't0');
}
const bk = (db: Db, mid: string, day: string): BookingRow | undefined =>
  db.prepare('SELECT * FROM bookings WHERE mid=? AND day=?').get(mid, day) as
    BookingRow | undefined;

/* ------------------------ structural path ------------------------ */
describe('applyMutate — structural', () => {
  it('replaces the machine list, sets groups, and broadcasts', () => {
    const db = mem();
    addMachine(db, 'old');
    const spy = vi.fn();
    const res = applyMutate(
      db,
      {
        machines: [
          { id: 'a', name: 'Alpha', group: 'G', cat: 'messtechnik', days: '1111100' },
          { id: 'b', name: 'Beta', group: 'G', status: 'defekt', statusFrom: '2021-01-01' },
        ],
        groups: ['G'],
        log: 'Verwalten',
        user: 'anna',
      },
      spy,
    );
    expect(res).toMatchObject({ ok: true, structural: true });
    expect(res.rev).toBe(1);
    expect(db.prepare('SELECT id FROM machines ORDER BY sort').all()).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
    expect(JSON.parse(getMeta(db, 'groups')!)).toEqual(['G']);
    expect(spy).toHaveBeenCalledWith('structural', expect.objectContaining({ rev: 1, by: 'anna' }));
  });

  it('cleans maintenance slots and clamps invalid dates', () => {
    const db = mem();
    const res = applyMutate(db, {
      machines: [
        {
          id: 'a',
          name: 'A',
          group: 'G',
          maint: [
            { type: 'defekt', from: '2021-01-01', until: 'bogus', note: 'x' },
            { type: 'other', from: 'nope' },
          ],
        },
      ],
    });
    expect(res.ok).toBe(true);
    const row = db.prepare('SELECT maint FROM machines WHERE id=?').get('a') as { maint: string };
    expect(JSON.parse(row.maint)).toEqual([
      { type: 'defekt', from: '2021-01-01', until: '', note: 'x' },
      { type: 'wartung', from: '', until: '' },
    ]);
  });

  it('deletes bookings orphaned by the new machine list', () => {
    const db = mem();
    addMachine(db, 'gone');
    book(db, 'gone', '2021-01-04', 'Alice');
    applyMutate(db, { machines: [{ id: 'keep', name: 'K', group: 'G' }] });
    expect(bk(db, 'gone', '2021-01-04')).toBeUndefined();
  });

  it('rejects an empty, oversized, invalid, or duplicate machine list', () => {
    const db = mem();
    expect(applyMutate(db, { machines: [] }).error).toBe('Ungültige Maschinenliste');
    expect(applyMutate(db, { machines: [{ id: 'a' }] }).error).toBe(
      'Maschine ohne gültige id/name',
    );
    expect(
      applyMutate(db, {
        machines: [
          { id: 'a', name: 'A' },
          { id: 'a', name: 'B' },
        ],
      }).error,
    ).toBe('Doppelte Maschinen-id: a');
  });
});

/* ------------------------ cell-delta path ------------------------ */
describe('applyMutate — cells', () => {
  it('books a free cell (ts defaulted) and broadcasts an update', () => {
    const db = mem();
    addMachine(db, 'm1');
    const spy = vi.fn();
    const res = applyMutate(
      db,
      {
        cells: [
          {
            mid: 'm1',
            day: '2021-01-04',
            val: { name: 'Alice', note: 'n', gid: 'g', gtitle: 't' },
          },
        ],
        user: 'anna',
        log: 'book',
      },
      spy,
    );
    expect(res).toMatchObject({ ok: true, applied: 1, conflicts: [] });
    const row = bk(db, 'm1', '2021-01-04')!;
    expect(row.name).toBe('Alice');
    expect(row.note).toBe('n');
    expect(typeof row.ts).toBe('string'); // server-generated ISO timestamp
    expect(row.ts!.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledWith('update', expect.objectContaining({ rev: 1 }));
  });

  it('keeps a client-supplied ts', () => {
    const db = mem();
    addMachine(db, 'm1');
    applyMutate(db, {
      cells: [{ mid: 'm1', day: '2021-01-04', val: { name: 'A', ts: '2020-12-31T09:00:00Z' } }],
    });
    expect(bk(db, 'm1', '2021-01-04')!.ts).toBe('2020-12-31T09:00:00Z');
  });

  it('reports a conflict for a foreign booking and does not overwrite', () => {
    const db = mem();
    addMachine(db, 'm1');
    book(db, 'm1', '2021-01-04', 'Bob');
    const res = applyMutate(db, {
      cells: [{ mid: 'm1', day: '2021-01-04', val: { name: 'Alice' } }],
    });
    expect(res.applied).toBe(0);
    expect(res.conflicts).toEqual([{ mid: 'm1', day: '2021-01-04', by: 'Bob' }]);
    expect(bk(db, 'm1', '2021-01-04')!.name).toBe('Bob');
  });

  it('reports a conflict for a blocked day', () => {
    const db = mem();
    addMachine(db, 'm1', { status: 'wartung' });
    const res = applyMutate(db, {
      cells: [{ mid: 'm1', day: '2021-01-04', val: { name: 'Alice' } }],
    });
    expect(res.conflicts).toEqual([{ mid: 'm1', day: '2021-01-04', by: 'gesperrt (wartung)' }]);
  });

  it('updates a cell the same owner already holds', () => {
    const db = mem();
    addMachine(db, 'm1');
    book(db, 'm1', '2021-01-04', 'Alice');
    const res = applyMutate(db, {
      cells: [{ mid: 'm1', day: '2021-01-04', val: { name: 'Alice', note: 'new' } }],
    });
    expect(res.applied).toBe(1);
    expect(bk(db, 'm1', '2021-01-04')!.note).toBe('new');
  });

  it('deletes an existing cell', () => {
    const db = mem();
    addMachine(db, 'm1');
    book(db, 'm1', '2021-01-04', 'Alice');
    const res = applyMutate(db, {
      cells: [{ mid: 'm1', day: '2021-01-04', val: null, prev: { name: 'Alice' } }],
    });
    expect(res.applied).toBe(1);
    expect(bk(db, 'm1', '2021-01-04')).toBeUndefined();
  });

  it('aborts a delete whose cell was taken over by someone else', () => {
    const db = mem();
    addMachine(db, 'm1');
    book(db, 'm1', '2021-01-04', 'Carol'); // now Carol's
    const res = applyMutate(db, {
      cells: [{ mid: 'm1', day: '2021-01-04', val: null, prev: { name: 'Alice' } }],
    });
    expect(res.applied).toBe(0);
    expect(res.conflicts).toEqual([{ mid: 'm1', day: '2021-01-04', by: 'Carol' }]);
    expect(bk(db, 'm1', '2021-01-04')!.name).toBe('Carol');
  });

  it('is a no-op delete when the cell is already empty', () => {
    const db = mem();
    addMachine(db, 'm1');
    const spy = vi.fn();
    const res = applyMutate(db, { cells: [{ mid: 'm1', day: '2021-01-04', val: null }] }, spy);
    expect(res.applied).toBe(0);
    expect(spy).not.toHaveBeenCalled(); // no changes → no broadcast
  });

  it('rejects too many cells, invalid cells, unknown machines, and a nameless booking', () => {
    const db = mem();
    addMachine(db, 'm1');
    expect(
      applyMutate(db, { cells: Array(1001).fill({ mid: 'm1', day: '2021-01-04' }) }).error,
    ).toBe('Zu viele Zellen (max. 1000)');
    expect(applyMutate(db, { cells: [{ mid: 'm1', day: 'bad' }] }).error).toBe('Ungültige Zelle');
    expect(applyMutate(db, { cells: [{ mid: 'ghost', day: '2021-01-04' }] }).error).toBe(
      'Unbekannte Maschine: ghost',
    );
    expect(
      applyMutate(db, { cells: [{ mid: 'm1', day: '2021-01-04', val: { name: '  ' } }] }).error,
    ).toBe('Name fehlt');
  });
});

/* ------------------------ dispatch + error paths ------------------------ */
describe('applyMutate — dispatch & failure handling', () => {
  it('returns "Nichts zu tun" when neither cells nor machines are present', () => {
    expect(applyMutate(mem(), { user: 'x' }).error).toBe('Nichts zu tun');
  });

  it('rolls back and reports failure when the cells transaction throws', () => {
    const db = mem();
    addMachine(db, 'm1');
    db.exec('DROP TABLE bookings'); // prepare() inside the txn will throw
    const res = applyMutate(db, { cells: [{ mid: 'm1', day: '2021-01-04', val: { name: 'A' } }] });
    expect(res.error).toBe('Speichern fehlgeschlagen');
  });

  it('rolls back and reports failure when the structural transaction throws', () => {
    const db = mem();
    db.exec('DROP TABLE machines'); // DELETE FROM machines will throw
    const res = applyMutate(db, { machines: [{ id: 'a', name: 'A' }] });
    expect(res.error).toBe('Speichern fehlgeschlagen');
  });

  it('still commits when the best-effort log insert fails', () => {
    const db = mem();
    addMachine(db, 'm1');
    db.exec('DROP TABLE log'); // logAction swallows its own failure
    const res = applyMutate(db, {
      cells: [{ mid: 'm1', day: '2021-01-04', val: { name: 'A' } }],
      log: 'note',
    });
    expect(res.ok).toBe(true);
    expect(bk(db, 'm1', '2021-01-04')!.name).toBe('A');
  });
});
