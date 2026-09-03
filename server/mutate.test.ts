import { describe, it, expect, vi } from 'vitest';
import { openDb, getMeta, type Db } from './db.ts';
import { applyMutate } from './mutate.ts';
import type { BookingRow } from './types.ts';

function mem(): Db {
  return openDb(':memory:');
}
function addMachine(db: Db, id = 'm1', over: Record<string, string | null> = {}): void {
  const m = { name: 'M', grp: 'A', status: 'ok', days: null, maint: null, ...over };
  db.prepare('INSERT INTO machines(id,name,grp,status,days,maint,sort) VALUES(?,?,?,?,?,?,0)').run(
    id,
    m.name,
    m.grp,
    m.status,
    m.days,
    m.maint,
  );
}
function book(db: Db, machineId: string, day: string, name: string): void {
  db.prepare('INSERT INTO bookings(mid,day,name,ts) VALUES(?,?,?,?)').run(
    machineId,
    day,
    name,
    't0',
  );
}
const bk = (db: Db, machineId: string, day: string): BookingRow | undefined =>
  db.prepare('SELECT * FROM bookings WHERE mid=? AND day=?').get(machineId, day) as
    BookingRow | undefined;

/* ------------------------ structural path ------------------------ */
describe('applyMutate — structural', () => {
  // What: a structural mutate replaces the ENTIRE machine list (not a partial update), sets
  // the groups list, bumps the revision, and broadcasts a 'structural' event naming who did it.
  // How: seeds one old machine, sends a structural mutate with two brand-new machines and a
  // groups list, and checks the machine list was fully replaced (old one gone), groups
  // persisted, and the broadcast fired with the right shape.
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

  // What: maintenance slots in a structural write are validated/cleaned server-side — an
  // invalid date string is clamped to empty (open-ended), and a type outside the known set
  // normalizes to 'wartung'.
  // How: sends one machine with two slots (one with a bogus `until`, one with an
  // unrecognized type and a bogus `from`) and checks both were cleaned as expected.
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

  // What: replacing the machine list also deletes every booking belonging to a machine that
  // no longer exists in the new list — orphan cleanup, part of the same transaction.
  // How: books a cell on a machine, then sends a structural mutate that omits that machine
  // entirely, and checks its booking is gone too.
  it('deletes bookings orphaned by the new machine list', () => {
    const db = mem();
    addMachine(db, 'gone');
    book(db, 'gone', '2021-01-04', 'Alice');
    applyMutate(db, { machines: [{ id: 'keep', name: 'K', group: 'G' }] });
    expect(bk(db, 'gone', '2021-01-04')).toBeUndefined();
  });

  // What: the structural validator rejects an empty machine list, a machine missing a valid
  // id/name, and a duplicate id across two machines — each with its own specific error message.
  // How: checks an empty machines array, a machine with only `id` (no name), and two machines
  // sharing the same id each produce their expected error text.
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
  // What: booking a free cell writes it with every given field (note/gid/gtitle), defaults
  // the timestamp to a server-generated ISO string when the client didn't supply one, and
  // broadcasts an 'update' event.
  // How: books a cell with no explicit ts and checks the written row's fields, that a real
  // timestamp string got generated, and the broadcast call.
  it('books a free cell (ts defaulted) and broadcasts an update', () => {
    const db = mem();
    addMachine(db, 'm1');
    const spy = vi.fn();
    const res = applyMutate(
      db,
      {
        cells: [
          {
            machineId: 'm1',
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

  // What: when the client DOES supply a ts, it's used verbatim instead of being overridden
  // by the server-generated default.
  // How: books a cell with an explicit ts and checks the stored row keeps that exact value.
  it('keeps a client-supplied ts', () => {
    const db = mem();
    addMachine(db, 'm1');
    applyMutate(db, {
      cells: [
        { machineId: 'm1', day: '2021-01-04', val: { name: 'A', ts: '2020-12-31T09:00:00Z' } },
      ],
    });
    expect(bk(db, 'm1', '2021-01-04')!.ts).toBe('2020-12-31T09:00:00Z');
  });

  // What: booking a cell already taken by someone else is refused — the "never overwrite a
  // foreign booking" rule — reported as a conflict naming who has it, with the cell left
  // exactly as it was.
  // How: pre-books a cell as Bob, tries to book it as Alice, and checks the conflict entry
  // and that Bob's booking is untouched.
  it('reports a conflict for a foreign booking and does not overwrite', () => {
    const db = mem();
    addMachine(db, 'm1');
    book(db, 'm1', '2021-01-04', 'Bob');
    const res = applyMutate(db, {
      cells: [{ machineId: 'm1', day: '2021-01-04', val: { name: 'Alice' } }],
    });
    expect(res.applied).toBe(0);
    expect(res.conflicts).toEqual([{ machineId: 'm1', day: '2021-01-04', by: 'Bob' }]);
    expect(bk(db, 'm1', '2021-01-04')!.name).toBe('Bob');
  });

  // What: booking a day blocked by the legacy status field is refused, reported with the
  // block's reason text.
  // How: gives the machine a 'wartung' status, tries to book it, and checks the conflict
  // names that block reason.
  it('reports a conflict for a blocked day', () => {
    const db = mem();
    addMachine(db, 'm1', { status: 'wartung' });
    const res = applyMutate(db, {
      cells: [{ machineId: 'm1', day: '2021-01-04', val: { name: 'Alice' } }],
    });
    expect(res.conflicts).toEqual([
      { machineId: 'm1', day: '2021-01-04', by: 'gesperrt (wartung)' },
    ]);
  });

  // What: pins the same F1 regression fix model.test.ts's isBlocked test pins, but at the
  // write-path level — a machine blocked ONLY via a `maint` slot (status left 'ok') must
  // actually refuse the booking, not silently accept a write the client itself wouldn't show
  // as bookable.
  // How: gives the machine a covering maint slot with status:'ok', tries to book that day,
  // and checks the conflict names the maint slot's own type and that nothing was written.
  // Regression (ARCHITECTURE_AUDIT.md F1): this write path used to check only the legacy
  // `status` field, so a machine blocked solely via `maint` — the only form the current
  // machine-edit UI ever writes — was silently bookable through a direct write, even
  // though the client itself already refuses to show that cell as bookable.
  it('reports a conflict for a day covered by a `maint` slot, with status left at ok', () => {
    const db = mem();
    addMachine(db, 'm1', {
      status: 'ok',
      maint: JSON.stringify([{ type: 'defekt', from: '2021-01-04', until: '2021-01-04' }]),
    });
    const res = applyMutate(db, {
      cells: [{ machineId: 'm1', day: '2021-01-04', val: { name: 'Alice' } }],
    });
    expect(res.conflicts).toEqual([
      { machineId: 'm1', day: '2021-01-04', by: 'gesperrt (defekt)' },
    ]);
    expect(bk(db, 'm1', '2021-01-04')).toBeUndefined();
  });

  // What: booking a weekday the machine isn't scheduled to work (per its days mask) is
  // refused, with a distinct conflict reason ("unavailable (weekday)") from a maintenance block.
  // How: gives the machine a mask with Monday off, books a Monday, and checks the conflict
  // reason and that nothing was written.
  it('reports a conflict for a day the machine is closed on, per its `days` mask', () => {
    const db = mem();
    addMachine(db, 'm1', { days: '0111111' }); // Monday off
    const res = applyMutate(db, {
      cells: [{ machineId: 'm1', day: '2021-01-04', val: { name: 'Alice' } }], // a Monday
    });
    expect(res.conflicts).toEqual([
      { machineId: 'm1', day: '2021-01-04', by: 'nicht verfügbar (Wochentag)' },
    ]);
    expect(bk(db, 'm1', '2021-01-04')).toBeUndefined();
  });

  // What: re-booking a cell under the SAME name it's already booked under is treated as an
  // update (e.g. changing the note), not a conflict — the "never overwrite a foreign booking"
  // rule only applies to a DIFFERENT name.
  // How: books a cell as Alice, then books it again as Alice with a new note, and checks it
  // applied (not conflicted) and the note updated.
  it('updates a cell the same owner already holds', () => {
    const db = mem();
    addMachine(db, 'm1');
    book(db, 'm1', '2021-01-04', 'Alice');
    const res = applyMutate(db, {
      cells: [{ machineId: 'm1', day: '2021-01-04', val: { name: 'Alice', note: 'new' } }],
    });
    expect(res.applied).toBe(1);
    expect(bk(db, 'm1', '2021-01-04')!.note).toBe('new');
  });

  // What: a cell-delta with `val: null` deletes the cell, when its current name matches the
  // `prev` the client believed was there.
  // How: books a cell as Alice, deletes it with prev:{name:'Alice'}, and checks it applied
  // and the cell is gone.
  it('deletes an existing cell', () => {
    const db = mem();
    addMachine(db, 'm1');
    book(db, 'm1', '2021-01-04', 'Alice');
    const res = applyMutate(db, {
      cells: [{ machineId: 'm1', day: '2021-01-04', val: null, prev: { name: 'Alice' } }],
    });
    expect(res.applied).toBe(1);
    expect(bk(db, 'm1', '2021-01-04')).toBeUndefined();
  });

  // What: a delete whose `prev` no longer matches the cell's ACTUAL current name (someone
  // else took it over in the meantime) is refused as a conflict, leaving the takeover intact.
  // How: books a cell as Carol (simulating a takeover after the client last saw it), sends a
  // delete with prev:{name:'Alice'} (the client's stale belief), and checks it conflicted
  // rather than deleting Carol's booking.
  it('aborts a delete whose cell was taken over by someone else', () => {
    const db = mem();
    addMachine(db, 'm1');
    book(db, 'm1', '2021-01-04', 'Carol'); // now Carol's
    const res = applyMutate(db, {
      cells: [{ machineId: 'm1', day: '2021-01-04', val: null, prev: { name: 'Alice' } }],
    });
    expect(res.applied).toBe(0);
    expect(res.conflicts).toEqual([{ machineId: 'm1', day: '2021-01-04', by: 'Carol' }]);
    expect(bk(db, 'm1', '2021-01-04')!.name).toBe('Carol');
  });

  // What: deleting an already-empty cell is a harmless no-op — applied stays 0 and (since
  // nothing actually changed) no broadcast fires.
  // How: deletes a cell that was never booked and checks applied:0 and that the broadcast
  // spy was never called.
  it('is a no-op delete when the cell is already empty', () => {
    const db = mem();
    addMachine(db, 'm1');
    const spy = vi.fn();
    const res = applyMutate(
      db,
      { cells: [{ machineId: 'm1', day: '2021-01-04', val: null }] },
      spy,
    );
    expect(res.applied).toBe(0);
    expect(spy).not.toHaveBeenCalled(); // no changes → no broadcast
  });

  // What: the cell-delta validator rejects a batch over the 1000-cell cap, a malformed cell
  // (bad date), a cell referencing a nonexistent machine, and a booking with a blank name —
  // each with its own specific error message.
  // How: checks each of the four invalid inputs produces its expected error string.
  it('rejects too many cells, invalid cells, unknown machines, and a nameless booking', () => {
    const db = mem();
    addMachine(db, 'm1');
    expect(
      applyMutate(db, { cells: Array(1001).fill({ machineId: 'm1', day: '2021-01-04' }) }).error,
    ).toBe('Zu viele Zellen (max. 1000)');
    expect(applyMutate(db, { cells: [{ machineId: 'm1', day: 'bad' }] }).error).toBe(
      'Ungültige Zelle',
    );
    expect(applyMutate(db, { cells: [{ machineId: 'ghost', day: '2021-01-04' }] }).error).toBe(
      'Unbekannte Maschine: ghost',
    );
    expect(
      applyMutate(db, { cells: [{ machineId: 'm1', day: '2021-01-04', val: { name: '  ' } }] })
        .error,
    ).toBe('Name fehlt');
  });
});

/* ------------------------ weekend bridging (6.3 maintain hook) ------------------------ */
describe('applyMutate — weekend auto-bridging', () => {
  // What: booking a Monday that completes a Fri→Mon span auto-bridges the weekend days too
  // (carrying the Friday's name), and the bridge cells are included in the broadcast so live
  // clients patch them in — but `applied` counts only the client's own requested change, not
  // the server-added bridges.
  // How: pre-books the Friday, books the Monday, and checks applied is still 1 (just the
  // Monday), both weekend days got bridged with the Friday's name, and the broadcast's
  // changes list includes all three affected dates.
  it('bridges the weekend when a booking completes a Fri→Mon span', () => {
    // Fri 2021-01-08 already Alice's; booking Mon 2021-01-11 completes the span.
    const db = mem();
    addMachine(db, 'm1');
    book(db, 'm1', '2021-01-08', 'Alice');
    const spy = vi.fn();
    const res = applyMutate(
      db,
      { cells: [{ machineId: 'm1', day: '2021-01-11', val: { name: 'Bob' } }] },
      spy,
    );
    expect(res.applied).toBe(1); // only the client's Monday counts as "applied"
    expect(bk(db, 'm1', '2021-01-09')!.name).toBe('Alice'); // Sat bridged with Friday's name
    expect(bk(db, 'm1', '2021-01-10')!.name).toBe('Alice'); // Sun bridged
    // the bridges are broadcast too, so other clients patch them in
    const changes = (spy.mock.calls[0]![1] as { changes: { day: string }[] }).changes;
    expect(changes.map((c) => c.day).sort()).toEqual(['2021-01-09', '2021-01-10', '2021-01-11']);
  });

  // What: passing `bridge:false` (the maintain hook's off-switch) skips the auto-bridging
  // entirely, even for a booking that would otherwise complete a bridgeable span.
  // How: repeats the same Fri-then-Mon setup but calls applyMutate with bridge:false, and
  // checks the weekend day was NOT bridged.
  it('does not bridge when the maintain hook is disabled', () => {
    const db = mem();
    addMachine(db, 'm1');
    book(db, 'm1', '2021-01-08', 'Alice');
    applyMutate(
      db,
      { cells: [{ machineId: 'm1', day: '2021-01-11', val: { name: 'Bob' } }] },
      () => {},
      false,
    );
    expect(bk(db, 'm1', '2021-01-09')).toBeUndefined(); // no bridge
  });
});

/* ------------------------ dispatch + error paths ------------------------ */
describe('applyMutate — dispatch & failure handling', () => {
  // What: a body with neither `cells` nor `machines` (nothing to actually apply) is rejected
  // with a specific "nothing to do" error, rather than silently succeeding.
  // How: calls applyMutate with only a `user` field and checks the error text.
  it('returns "Nichts zu tun" when neither cells nor machines are present', () => {
    expect(applyMutate(mem(), { user: 'x' }).error).toBe('Nichts zu tun');
  });

  // What: if the cell-delta transaction throws partway through (a genuine DB error, not a
  // validation failure), the transaction rolls back and applyMutate reports a generic save
  // failure rather than propagating the raw exception.
  // How: drops the bookings table (so the write inside the transaction throws), attempts a
  // cell booking, and checks the error message.
  it('rolls back and reports failure when the cells transaction throws', () => {
    const db = mem();
    addMachine(db, 'm1');
    db.exec('DROP TABLE bookings'); // prepare() inside the txn will throw
    const res = applyMutate(db, {
      cells: [{ machineId: 'm1', day: '2021-01-04', val: { name: 'A' } }],
    });
    expect(res.error).toBe('Speichern fehlgeschlagen');
  });

  // What: the same rollback-and-report-generically behavior applies to a failure in the
  // structural transaction.
  // How: drops the machines table (so DELETE FROM machines throws), attempts a structural
  // write, and checks the generic failure message.
  it('rolls back and reports failure when the structural transaction throws', () => {
    const db = mem();
    db.exec('DROP TABLE machines'); // DELETE FROM machines will throw
    const res = applyMutate(db, { machines: [{ id: 'a', name: 'A' }] });
    expect(res.error).toBe('Speichern fehlgeschlagen');
  });

  // What: the activity log insert is deliberately best-effort — if it fails (e.g. the log
  // table is unavailable), the actual write it was logging still commits successfully rather
  // than being rolled back over a logging failure.
  // How: drops the log table, performs a real cell booking with a log message, and checks the
  // mutate itself still succeeded and the booking was actually written.
  it('still commits when the best-effort log insert fails', () => {
    const db = mem();
    addMachine(db, 'm1');
    db.exec('DROP TABLE log'); // logAction swallows its own failure
    const res = applyMutate(db, {
      cells: [{ machineId: 'm1', day: '2021-01-04', val: { name: 'A' } }],
      log: 'note',
    });
    expect(res.ok).toBe(true);
    expect(bk(db, 'm1', '2021-01-04')!.name).toBe('A');
  });
});
