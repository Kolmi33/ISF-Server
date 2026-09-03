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
  // What: a body with no name is rejected — the one required field.
  // How: calls with an empty body and checks the 400/VALIDATION response.
  it('requires a name', () => {
    const res = createMachine(mem(), {}, vi.fn());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION' });
  });

  // What: a body that isn't even an object (a string, null) is treated the same as an empty
  // one — still rejected for the missing name, not crashing on the malformed shape.
  // How: checks a string body and a null body both produce 400.
  it('treats a non-object body the same as an empty one', () => {
    expect(createMachine(mem(), 'oops', vi.fn()).status).toBe(400);
    expect(createMachine(mem(), null, vi.fn()).status).toBe(400);
  });

  // What: creating a machine slugs its id from the name, inserts it right after its group's
  // last existing member, returns 201, and broadcasts the structural change.
  // How: creates a machine with a German name (checks the slugged id), checks its DB row
  // landed at the sort position right after the group's last existing machine, and checks
  // the broadcast fired with a 'structural' event.
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

  // What: creating two machines with the same slugged name doesn't collide — the second gets
  // a numeric suffix.
  // How: creates two machines named 'Neu' and checks the second one's id is 'neu-2'.
  it('de-duplicates a slug collision by appending -2', () => {
    const db = mem();
    createMachine(db, { name: 'Neu' }, vi.fn());
    const res = createMachine(db, { name: 'Neu' }, vi.fn());
    expect((res.body as { data: { id: string } }).data.id).toBe('neu-2');
  });

  // What: when the caller doesn't supply their own user/log, the write logs a default
  // message naming the machine and tagging it '(REST)', with the user recorded as '?'.
  // How: creates a machine with no user/log fields and checks the resulting log row.
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

  // What: the optional fields (redu/days/cat/maint) are all written when given, and a name
  // with no Latin-alphanumeric content at all (pure symbols) falls back to the hash-based id.
  // How: creates a machine named '!!!' with every optional field set and checks both the
  // hash-shaped id and that every optional field landed correctly in the DB row.
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
    const id = (res.body as { data: { id: string } }).data.id;
    expect(id).toMatch(/^m_[0-9a-f]{6}$/);
    const row = db.prepare('SELECT * FROM machines WHERE id=?').get(id) as {
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

  // What: a caller-supplied user/log overrides the auto-generated default.
  // How: creates a machine with explicit user/log fields and checks the log row uses them verbatim.
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
  // What: updating an unknown id is a 404.
  // How: calls with an unknown id and checks the status/code.
  it('is a 404 for an unknown id', () => {
    const res = updateMachine(mem(), 'ghost', { name: 'X' }, vi.fn());
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  // What: an update with no name is rejected, same validation as create.
  // How: calls with an empty body and checks the 400 status.
  it('requires a name', () => {
    const res = updateMachine(mem(), 'm1', {}, vi.fn());
    expect(res.status).toBe(400);
  });

  // What: a successful update replaces the editable fields with the given values, and — like
  // every write path in core/machines.ts — clears the legacy single-status fields, since a
  // save always supersedes them with the newer maint-based form.
  // How: pre-sets a legacy status/statusNote on the machine, updates it with new
  // name/group/info, and checks both the new values landed and the legacy status was reset to 'ok'.
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
  // What: deleting an unknown id is a 404.
  // How: calls with an unknown id and checks the status.
  it('is a 404 for an unknown id', () => {
    const res = deleteMachine(mem(), 'ghost', {}, vi.fn());
    expect(res.status).toBe(404);
  });

  // What: deleting a machine removes both it and every one of its bookings, returning 204.
  // How: books one cell on the machine, deletes it, and checks both the machine row and its
  // booking are gone.
  it('removes the machine and its bookings, 204', () => {
    const db = mem();
    db.prepare('INSERT INTO bookings(mid,day,name) VALUES(?,?,?)').run('m1', '2026-01-05', 'Anna');
    const res = deleteMachine(db, 'm1', {}, vi.fn());
    expect(res.status).toBe(204);
    expect(db.prepare('SELECT 1 FROM machines WHERE id=?').get('m1')).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM bookings WHERE mid=?').get('m1')).toBeUndefined();
  });

  // What: deleting the very last remaining machine is refused — the structural write path's
  // own floor (an empty machine list fails validation), surfaced correctly as a 400 here.
  // How: sets up a DB with exactly one machine, tries to delete it, and checks the request is
  // rejected with VALIDATION and the machine is still there.
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
  // What: a missing or unrecognized `direction` value is rejected client-side.
  // How: checks an empty body and a nonsense direction string both produce 400.
  it('rejects a missing/invalid direction', () => {
    expect(moveMachine(mem(), 'm1', {}, vi.fn()).status).toBe(400);
    expect(moveMachine(mem(), 'm1', { direction: 'sideways' }, vi.fn()).status).toBe(400);
  });

  // What: moving an unknown machine id is a 404.
  // How: calls with an unknown id and checks the status.
  it('is a 404 for an unknown id', () => {
    const res = moveMachine(mem(), 'ghost', { direction: 'up' }, vi.fn());
    expect(res.status).toBe(404);
  });

  // What: moving a machine that's already first in its group up any further is a 409
  // conflict — the request is well-formed, the position just can't move that way.
  // How: moves the fixture's first-in-group machine 'up' and checks the 409/CONFLICT response.
  it('is a 409 when the move would run off the group (already first)', () => {
    const res = moveMachine(mem(), 'm1', { direction: 'up' }, vi.fn());
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT' });
  });

  // What: a move that would cross into a different group is also a 409, even though the
  // target array position itself is technically valid.
  // How: moves the last machine of group A down (which would land it in group B) and checks
  // the 409 response.
  it('is a 409 when the move would cross a group boundary', () => {
    // m2 (group A) moving down would land on m3 (group B)
    const res = moveMachine(mem(), 'm2', { direction: 'down' }, vi.fn());
    expect(res.status).toBe(409);
  });

  // What: a valid move swaps the machine with its neighbour within the same group,
  // returning 200 with the moved id and direction.
  // How: moves the middle machine of group A up and checks both the response body and that
  // the two machines' sort values actually swapped in the DB.
  it('swaps with its neighbour within the group', () => {
    const db = mem();
    const res = moveMachine(db, 'm2', { direction: 'up' }, vi.fn());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { movedId: 'm2', direction: 'up' } });
    expect(machineRow(db, 'm2')?.sort).toBe(0);
    expect(machineRow(db, 'm1')?.sort).toBe(1);
  });
});
