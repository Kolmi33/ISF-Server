import { describe, it, expect } from 'vitest';
import { openDb, setMeta, type Db } from './db.ts';
import {
  isBlocked,
  blockReason,
  isDayAvailable,
  machineOut,
  bookingOut,
  getState,
} from './model.ts';
import type { MachineRow } from './types.ts';

// A fresh in-memory DB per test (node:sqlite ':memory:').
function mem(): Db {
  return openDb(':memory:');
}

const ROW = (over: Partial<MachineRow> = {}): MachineRow => ({
  id: 'm1',
  name: 'M1',
  grp: 'A',
  cat: null,
  status: 'ok',
  statusNote: '',
  statusFrom: null,
  statusUntil: null,
  info: '',
  redu: null,
  days: null,
  maint: null,
  sort: 0,
  ...over,
});

function insertMachine(db: Db, r: MachineRow): void {
  db.prepare(
    `INSERT INTO machines(id,name,grp,cat,status,statusNote,statusFrom,statusUntil,info,redu,days,maint,sort)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    r.id,
    r.name,
    r.grp,
    r.cat,
    r.status,
    r.statusNote,
    r.statusFrom,
    r.statusUntil,
    r.info,
    r.redu,
    r.days,
    r.maint,
    r.sort,
  );
}

describe('isBlocked', () => {
  // What: a machine with status 'ok' (or no status at all) is never blocked.
  // How: checks both an explicit 'ok' status and a null status both read as unblocked.
  it('is false when status is ok or absent', () => {
    expect(isBlocked(ROW({ status: 'ok' }), '2021-06-01')).toBe(false);
    expect(isBlocked(ROW({ status: null }), '2021-06-01')).toBe(false);
  });
  // What: a non-'ok' status blocks — whether open-ended (no from/until) or within a bounded
  // date window that covers the query date.
  // How: checks an unbounded 'defekt' status and a bounded 'wartung' window covering the
  // query date both read as blocked.
  it('is true within an open or bounded block window', () => {
    expect(isBlocked(ROW({ status: 'defekt' }), '2021-06-01')).toBe(true);
    expect(
      isBlocked(
        ROW({ status: 'wartung', statusFrom: '2021-05-01', statusUntil: '2021-06-30' }),
        '2021-06-01',
      ),
    ).toBe(true);
  });
  // What: a bounded status window only blocks INSIDE its from/until range, not before or after.
  // How: checks a date before, after, and inside the same bounded window.
  it('respects the from/until bounds', () => {
    const r = ROW({ status: 'wartung', statusFrom: '2021-06-10', statusUntil: '2021-06-20' });
    expect(isBlocked(r, '2021-06-01')).toBe(false); // before from
    expect(isBlocked(r, '2021-06-25')).toBe(false); // after until
    expect(isBlocked(r, '2021-06-15')).toBe(true); // inside
  });

  // What: pins a real regression fix (ARCHITECTURE_AUDIT.md F1) — a machine blocked ONLY via
  // the newer `maint` slots (with the legacy status fields left at 'ok', which is what the
  // real machine-edit UI always writes now) must still read as blocked server-side. This used
  // to silently pass, since the server-side check only looked at the legacy fields.
  // How: builds a machine with status:'ok' but a `maint` slot covering a date range, and
  // checks isBlocked correctly follows the maint slot's own bounds, ignoring the ok status.
  // Regression (ARCHITECTURE_AUDIT.md F1): this server-side check used to look only at the
  // legacy status fields, so a machine blocked solely via the newer `maint` slots — the
  // only form the current machine-edit UI ever writes — was silently accepted by a write.
  it('is true for a machine blocked only via `maint`, with status left at ok', () => {
    const r = ROW({
      status: 'ok',
      maint: JSON.stringify([{ type: 'defekt', from: '2021-06-10', until: '2021-06-20' }]),
    });
    expect(isBlocked(r, '2021-06-01')).toBe(false); // before the slot
    expect(isBlocked(r, '2021-06-15')).toBe(true); // inside the slot
    expect(isBlocked(r, '2021-06-25')).toBe(false); // after the slot
  });

  // What: an empty maint array, invalid JSON, or JSON that isn't an array all tolerantly fall
  // back to the legacy status fields, rather than throwing or blocking incorrectly — and a
  // malformed `maint` doesn't accidentally HIDE a real block that legacy status still reports.
  // How: checks '[]', invalid JSON, and a non-array JSON value all fall back to status:'ok'
  // reading unblocked, then checks malformed maint alongside a real 'defekt' status still
  // reads blocked (the fallback goes the right direction).
  it('is false for an empty, non-array, or malformed `maint`, falling back to status', () => {
    expect(isBlocked(ROW({ status: 'ok', maint: '[]' }), '2021-06-15')).toBe(false);
    expect(isBlocked(ROW({ status: 'ok', maint: 'not json' }), '2021-06-15')).toBe(false);
    expect(isBlocked(ROW({ status: 'ok', maint: '{"not":"an array"}' }), '2021-06-15')).toBe(false);
    // malformed maint doesn't hide a real legacy-status block
    expect(isBlocked(ROW({ status: 'defekt', maint: 'not json' }), '2021-06-15')).toBe(true);
  });
});

describe('blockReason', () => {
  // What: an unblocked machine's reason is null (not an empty string).
  // How: checks a status:'ok' machine returns null.
  it('returns null when not blocked', () => {
    expect(blockReason(ROW({ status: 'ok' }), '2021-06-01')).toBeNull();
  });

  // What: when BOTH a legacy status and a covering maint slot are present, the maint slot's
  // own type wins for the reason text — the structured form is preferred over the legacy one.
  // How: sets status to 'wartung' but gives a covering maint slot typed 'defekt', and checks
  // the reason names 'defekt' (the maint slot), not 'wartung' (the legacy status).
  it('prefers a covering `maint` slot over the legacy status fields, using its own type', () => {
    const r = ROW({
      status: 'wartung', // present, but the maint slot should win
      maint: JSON.stringify([{ type: 'defekt', from: '2021-06-01', until: '2021-06-30' }]),
    });
    expect(blockReason(r, '2021-06-15')).toBe('gesperrt (defekt)');
  });

  // What: with no covering maint slot at all, the reason falls back to the legacy status field.
  // How: builds a machine with only a legacy 'wartung' status (no maint array) and checks the reason.
  it('falls back to the legacy status label when no maint slot covers the day', () => {
    expect(blockReason(ROW({ status: 'wartung' }), '2021-06-15')).toBe('gesperrt (wartung)');
  });

  // What: a maint slot missing its own `type` field defaults to the 'wartung' label, matching
  // the client's own default-type convention.
  // How: builds a maint slot with no type field and checks the reason labels it 'wartung'.
  it("labels a maint slot with no `type` as 'wartung'", () => {
    const r = ROW({ maint: JSON.stringify([{ from: '2021-06-01', until: '2021-06-30' }]) });
    expect(blockReason(r, '2021-06-15')).toBe('gesperrt (wartung)');
  });
});

describe('isDayAvailable', () => {
  // What: a machine with no days mask at all defaults to available every day.
  // How: checks a machine with a null days field reads available on a known Monday.
  it('is true when the machine has no days mask', () => {
    expect(isDayAvailable(ROW({ days: null }), '2021-01-04')).toBe(true); // a Monday
  });

  // What: a malformed (wrong-length) mask also defaults to available every day, tolerantly.
  // How: checks a 3-character mask (not the expected 7) reads available.
  it('is true when the mask is malformed (wrong length)', () => {
    expect(isDayAvailable(ROW({ days: '111' }), '2021-01-04')).toBe(true);
  });

  // What: a well-formed mask reads Mo..So in order, with '0' meaning unavailable that weekday.
  // How: gives a machine a mask with Monday off and checks Monday reads unavailable while
  // Tuesday and Sunday (both '1' in the mask) read available.
  it("reads the mask Mo..So, '0' unavailable", () => {
    const closedMondays = ROW({ days: '0111111' });
    expect(isDayAvailable(closedMondays, '2021-01-04')).toBe(false); // Monday
    expect(isDayAvailable(closedMondays, '2021-01-05')).toBe(true); // Tuesday
    expect(isDayAvailable(closedMondays, '2021-01-10')).toBe(true); // Sunday
  });
});

describe('machineOut', () => {
  // What: the base wire fields (id/name/group/status/statusNote/info) map from the row,
  // coalescing null status/statusNote/info to their documented defaults ('ok'/''/'').
  // How: builds a row with those three fields null and checks the wire shape's defaults.
  it('maps the base fields and coalesces null status/note/info', () => {
    expect(machineOut(ROW({ grp: 'B', status: null, statusNote: null, info: null }))).toEqual({
      id: 'm1',
      name: 'M1',
      group: 'B',
      status: 'ok',
      statusNote: '',
      info: '',
    });
  });
  // What: every optional wire field (cat, statusFrom, statusUntil, redu, days, maint — the
  // last parsed from its JSON string into a real array) appears when the row has it set.
  // How: builds a row with all six optional fields set and checks each lands on the wire shape.
  it('adds each optional field only when set', () => {
    const o = machineOut(
      ROW({
        cat: 'messtechnik',
        statusFrom: '2021-01-01',
        statusUntil: '2021-12-31',
        redu: 'r',
        days: '1111100',
        maint: JSON.stringify([{ type: 'wartung' }]),
      }),
    );
    expect(o).toMatchObject({
      cat: 'messtechnik',
      statusFrom: '2021-01-01',
      statusUntil: '2021-12-31',
      redu: 'r',
      days: '1111100',
      maint: [{ type: 'wartung' }],
    });
  });
  // What: malformed maint JSON or an explicitly-empty array both omit the `maint` field from
  // the wire shape entirely, rather than emitting `undefined`/`[]`/an error.
  // How: checks both an invalid-JSON string and a valid-but-empty-array JSON string both
  // leave the wire shape's maint field undefined.
  it('omits maint when the JSON is malformed or an empty array', () => {
    expect(machineOut(ROW({ maint: 'not json' })).maint).toBeUndefined();
    expect(machineOut(ROW({ maint: '[]' })).maint).toBeUndefined();
  });
});

describe('bookingOut', () => {
  // What: name and ts always appear (ts even when null), while note/gid/gtitle only appear
  // when actually set on the input.
  // How: checks a booking with all optionals null maps to just {name, ts}, and one with all
  // optionals set maps to the full shape including each of them.
  it('maps name/ts and only present optionals', () => {
    expect(
      bookingOut({
        name: 'Alice',
        ts: '2021-01-04T00:00:00Z',
        note: null,
        gid: null,
        gtitle: null,
      }),
    ).toEqual({
      name: 'Alice',
      ts: '2021-01-04T00:00:00Z',
    });
    expect(bookingOut({ name: 'Bob', ts: null, note: 'n', gid: 'g', gtitle: 't' })).toEqual({
      name: 'Bob',
      ts: null,
      note: 'n',
      gid: 'g',
      gtitle: 't',
    });
  });
});

describe('getState', () => {
  // What: getState reads the full team-wide state — revision, groups, machines (in their
  // sort/name order), and every booking — assembling it from the raw DB rows/meta.
  // How: seeds a revision, groups, two machines (in reverse sort order) and one booking, and
  // checks the assembled state reflects all of it, with machines correctly (sort, name)-ordered.
  it('returns rev/groups/machines(sorted)/bookings from the DB', () => {
    const db = mem();
    setMeta(db, 'revision', '7');
    setMeta(db, 'groups', JSON.stringify(['A', 'B']));
    insertMachine(db, ROW({ id: 'm2', name: 'Zed', sort: 1 }));
    insertMachine(db, ROW({ id: 'm1', name: 'Abe', sort: 0 }));
    db.prepare('INSERT INTO bookings(mid,day,name,ts) VALUES(?,?,?,?)').run(
      'm1',
      '2021-01-04',
      'Alice',
      '2021-01-04T00:00:00Z',
    );
    const st = getState(db);
    expect(st.rev).toBe(7);
    expect(st.groups).toEqual(['A', 'B']);
    expect(st.machines.map((m) => m.id)).toEqual(['m1', 'm2']); // ORDER BY sort, name
    expect(st.bookings.m1!['2021-01-04']!.name).toBe('Alice');
  });

  // What: with no meta rows set at all (an edge case openDb's own seeding normally prevents),
  // getState still degrades gracefully to sensible defaults rather than throwing.
  // How: deletes every meta row directly and checks the state falls back to rev 0, empty
  // groups, and an empty machine list.
  it('defaults rev to 0 and groups to [] when meta is absent', () => {
    const db = mem();
    db.prepare('DELETE FROM meta').run();
    const st = getState(db);
    expect(st.rev).toBe(0);
    expect(st.groups).toEqual([]);
    expect(st.machines).toEqual([]);
  });
});
