import { describe, it, expect, vi } from 'vitest';
import { openDb, type Db } from './db.ts';
import { createMachine, updateMachine, deleteMachine, moveMachine } from './api-machines-write.ts';

function mem(): Db {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO machines(id,name,grp,sort) VALUES(?,?,?,0)').run('m1', 'M1', 'A');
  db.prepare('INSERT INTO machines(id,name,grp,sort) VALUES(?,?,?,1)').run('m2', 'M2', 'A');
  db.prepare('INSERT INTO machines(id,name,grp,sort) VALUES(?,?,?,2)').run('m3', 'M3', 'B');
  return db;
}

function machineRow(db: Db, id: string): { grp: string | null; sort: number | null } | undefined {
  return db.prepare('SELECT grp, sort FROM machines WHERE id=?').get(id) as
    { grp: string | null; sort: number | null } | undefined;
}

describe('createMachine', () => {
  it('requires a name', () => {
    const res = createMachine(mem(), {}, vi.fn());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION' });
  });

  it('treats a non-object body the same as an empty one', () => {
    expect(createMachine(mem(), 'oops', vi.fn()).status).toBe(400);
    expect(createMachine(mem(), null, vi.fn()).status).toBe(400);
  });

  it('creates a machine with a slugged id, inserted after its group, 201', () => {
    const db = mem();
    const broadcast = vi.fn();
    const res = createMachine(db, { name: 'Prüfgerät', group: 'A' }, broadcast);
    expect(res.status).toBe(201);
    expect((res.body as { data: { id: string } }).data.id).toBe('pruefgeraet');
    // inserted right after the last 'A' machine (m2, sort=1), so it should land at sort=2
    expect(machineRow(db, 'pruefgeraet')).toMatchObject({ grp: 'A', sort: 2 });
    expect(broadcast).toHaveBeenCalledWith('structural', expect.anything());
  });

  it('de-duplicates a slug collision by appending -2', () => {
    const db = mem();
    createMachine(db, { name: 'Neu' }, vi.fn());
    const res = createMachine(db, { name: 'Neu' }, vi.fn());
    expect((res.body as { data: { id: string } }).data.id).toBe('neu-2');
  });

  it('logs the create with a default message when the body omits log/user', () => {
    const db = mem();
    createMachine(db, { name: 'X' }, vi.fn());
    const logRow = db.prepare('SELECT user, action FROM log ORDER BY id DESC LIMIT 1').get() as {
      user: string;
      action: string;
    };
    expect(logRow.action).toBe('Maschine angelegt: X (REST)');
    expect(logRow.user).toBe('?');
  });

  it('sets redu/days/cat/maint when given, and slugs an all-symbol name to the fallback', () => {
    const db = mem();
    const res = createMachine(
      db,
      {
        name: '!!!',
        redu: 'R1',
        days: '1111100',
        cat: 'messtechnik',
        maint: [{ type: 'wartung', from: '2026-01-01', until: '2026-01-02' }],
      },
      vi.fn(),
    );
    expect((res.body as { data: { id: string } }).data.id).toBe('maschine');
    const row = db.prepare('SELECT * FROM machines WHERE id=?').get('maschine') as {
      redu: string;
      days: string;
      cat: string;
      maint: string;
    };
    expect(row.redu).toBe('R1');
    expect(row.days).toBe('1111100');
    expect(row.cat).toBe('messtechnik');
    expect(JSON.parse(row.maint)).toHaveLength(1);
  });

  it('passes through a caller-supplied user/log', () => {
    const db = mem();
    createMachine(db, { name: 'X', user: 'anna', log: 'custom' }, vi.fn());
    const logRow = db.prepare('SELECT user, action FROM log ORDER BY id DESC LIMIT 1').get() as {
      user: string;
      action: string;
    };
    expect(logRow).toEqual({ user: 'anna', action: 'custom' });
  });
});

describe('updateMachine', () => {
  it('is a 404 for an unknown id', () => {
    const res = updateMachine(mem(), 'ghost', { name: 'X' }, vi.fn());
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('requires a name', () => {
    const res = updateMachine(mem(), 'm1', {}, vi.fn());
    expect(res.status).toBe(400);
  });

  it('replaces the editable fields and clears legacy status fields', () => {
    const db = mem();
    db.prepare('UPDATE machines SET status=?, statusNote=? WHERE id=?').run(
      'defekt',
      'kaputt',
      'm1',
    );
    const res = updateMachine(db, 'm1', { name: 'M1 neu', group: 'B', info: 'note' }, vi.fn());
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT * FROM machines WHERE id=?').get('m1') as {
      name: string;
      grp: string;
      status: string;
    };
    expect(row.name).toBe('M1 neu');
    expect(row.grp).toBe('B');
    expect(row.status).toBe('ok'); // legacy status cleared by every write, matching core/machines.ts
  });
});

describe('deleteMachine', () => {
  it('is a 404 for an unknown id', () => {
    const res = deleteMachine(mem(), 'ghost', {}, vi.fn());
    expect(res.status).toBe(404);
  });

  it('removes the machine and its bookings, 204', () => {
    const db = mem();
    db.prepare('INSERT INTO bookings(mid,day,name) VALUES(?,?,?)').run('m1', '2026-01-05', 'Anna');
    const res = deleteMachine(db, 'm1', {}, vi.fn());
    expect(res.status).toBe(204);
    expect(db.prepare('SELECT 1 FROM machines WHERE id=?').get('m1')).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM bookings WHERE mid=?').get('m1')).toBeUndefined();
  });

  it("refuses to delete the last remaining machine (structuralError's own floor)", () => {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO machines(id,name,sort) VALUES(?,?,0)').run('only', 'Only');
    const res = deleteMachine(db, 'only', {}, vi.fn());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION' });
    expect(db.prepare('SELECT 1 FROM machines WHERE id=?').get('only')).toBeDefined();
  });
});

describe('moveMachine', () => {
  it('rejects a missing/invalid direction', () => {
    expect(moveMachine(mem(), 'm1', {}, vi.fn()).status).toBe(400);
    expect(moveMachine(mem(), 'm1', { direction: 'sideways' }, vi.fn()).status).toBe(400);
  });

  it('is a 404 for an unknown id', () => {
    const res = moveMachine(mem(), 'ghost', { direction: 'up' }, vi.fn());
    expect(res.status).toBe(404);
  });

  it('is a 409 when the move would run off the group (already first)', () => {
    const res = moveMachine(mem(), 'm1', { direction: 'up' }, vi.fn());
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT' });
  });

  it('is a 409 when the move would cross a group boundary', () => {
    // m2 (group A) moving down would land on m3 (group B)
    const res = moveMachine(mem(), 'm2', { direction: 'down' }, vi.fn());
    expect(res.status).toBe(409);
  });

  it('swaps with its neighbour within the group', () => {
    const db = mem();
    const res = moveMachine(db, 'm2', { direction: 'up' }, vi.fn());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { movedId: 'm2', direction: 'up' } });
    expect(machineRow(db, 'm2')?.sort).toBe(0);
    expect(machineRow(db, 'm1')?.sort).toBe(1);
  });
});
