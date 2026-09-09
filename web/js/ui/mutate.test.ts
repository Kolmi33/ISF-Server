// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppState, Booking, ServerData } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';
import { mutate, refreshNow, stampRef } from './mutate.ts';
import { machById } from './machine-lookup.ts';

function serverData(overrides: Partial<ServerData> = {}): ServerData {
  return {
    machines: [{ id: 'm1', name: 'Fräse', group: 'Halle 1' }],
    bookings: {},
    groups: ['Halle 1'],
    revision: 1,
    log: [],
    ...overrides,
  } as unknown as ServerData;
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return { name: 'anna', ...overrides };
}

function fetchReturning(json: unknown, ok = true): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({ ok, status: 500, json: () => Promise.resolve(json) });
}

// mutate.ts now reads/writes state via the real `store` singleton — spied once here (its
// call history is cleared per test in beforeEach below) rather than relying on a mocked
// window.notify, which nothing calls anymore.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  document.body.innerHTML =
    '<span id="lastRef"></span><div id="toast"></div><div id="collBanner"></div>';
  store.set({
    data: serverData(),
    readOnly: false,
    user: 'anna',
    visM: [],
    visD: [],
  } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe('mutate — read-only guard', () => {
  // What: in read-only mode, mutate refuses the write entirely — the reducer function never
  // even runs, and the user sees a toast explaining why.
  // How: sets readOnly:true, calls mutate with a spy reducer, and checks the result is null,
  // the spy was never invoked, and the toast mentions read-only mode.
  it('toasts, never calls fn, and returns null in read-only mode', async () => {
    window.S.readOnly = true;
    const fn = vi.fn();
    const result = await mutate(fn, 'test action');
    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toContain('Nur-Lese-Modus');
  });
});

describe('mutate — abort', () => {
  // What: when the reducer itself reports an abort (e.g. a conflict the caller decided not
  // to force through), mutate leaves the local state completely untouched and never even
  // attempts to persist to the server — an abort is a true no-op, not a partial write.
  // How: stubs fetch to prove it's never called, runs a reducer that returns {abort:true},
  // and checks the local log length is unchanged, notify never fired, and fetch was never invoked.
  it('leaves S.data and the log untouched, and never calls persist (no fetch)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const before = window.S.data!.log.length;
    const result = await mutate(() => ({ abort: true, conflicts: [] }), 'test action');
    expect(result).toEqual({ abort: true, conflicts: [] });
    expect(window.S.data!.log.length).toBe(before);
    expect(notifySpy).not.toHaveBeenCalled();
    await Promise.resolve(); // let any stray microtask settle
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('mutate — optimistic apply + logging', () => {
  // What: mutate applies the reducer to the local data SYNCHRONOUSLY (optimistic UI update,
  // before the server round-trip completes), records a log entry for the action, and returns
  // whatever the reducer itself returned.
  // How: runs a reducer that both mutates the fresh data and returns a result object, then
  // checks the local data reflects the mutation, the returned value matches the reducer's
  // result, and a log entry was added with the right user/action.
  it("applies fn to S.data synchronously, logs the action, and returns fn's result", async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    const fn = vi.fn((fresh) => {
      fresh.bookings.m1 = { '2021-01-04': booking() };
      return { deletedCount: 1, undo: [{ machineId: 'm1', date: '2021-01-04', prev: null }] };
    });
    const result = await mutate(fn, 'Gebucht: Anna');
    expect(window.S.data!.bookings.m1!['2021-01-04']).toEqual(booking());
    expect(result).toEqual({
      deletedCount: 1,
      undo: [{ machineId: 'm1', date: '2021-01-04', prev: null }],
    });
    expect(window.S.data!.log[0]).toMatchObject({ user: 'anna', action: 'Gebucht: Anna' });
  });

  // What: the in-memory activity log never grows past 500 entries — older entries are
  // dropped as new ones are added at the front.
  // How: seeds exactly 500 existing log entries, adds one more via mutate, and checks the
  // log is still 500 long with the new entry now at the front.
  it('caps the log at 500 entries', async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    window.S.data!.log = Array.from({ length: 500 }, (_, i) => ({
      ts: 't',
      user: 'x',
      action: String(i),
    }));
    await mutate(() => ({}), 'newest');
    expect(window.S.data!.log.length).toBe(500);
    expect(window.S.data!.log[0]!.action).toBe('newest');
  });

  // What: a reducer result with no `undo` array (a structural change — machine add/edit/
  // reorder, not a cell booking) triggers a full store notify() to repaint everything, since
  // there's no cell-level patch list to apply instead.
  // How: runs a reducer returning a plain result with no undo array and checks notify fired once.
  it('notify()s directly for a structural change (no undo array)', async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    await mutate(() => ({ abort: false }), 'Maschine verschoben');
    expect(notifySpy).toHaveBeenCalledOnce();
  });

  // What: because saveMachine/deleteMachine/moveMachine mutate `data.machines` in place
  // (invisible to machById's own reference-equality cache — see machine-lookup.test.ts),
  // mutate() must explicitly invalidate that cache after any structural change so a
  // subsequent lookup sees the update.
  // How: builds the machById cache first, confirms a not-yet-added machine isn't found, runs
  // a structural mutate that pushes a new machine into the array in place, and checks the
  // new machine IS now found (proving the cache was invalidated, not just stale-but-lucky).
  it('invalidates the machine lookup cache for a structural change (no undo array)', async () => {
    // saveMachine/deleteMachine/moveMachine (core/machines.ts) mutate `data.machines` in place
    // — machById's own reference-equality cache can't see that on its own (machine-lookup
    // .test.ts covers that gap directly); this proves mutate() closes it for the real path.
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    machById('m1'); // builds the cache against the machines array set up in beforeEach
    expect(machById('new-machine')).toBeUndefined();
    await mutate((fresh) => {
      fresh.machines.push({ id: 'new-machine', name: 'Neu', group: 'Halle 1' });
    }, 'Maschine angelegt: Neu');
    expect(machById('new-machine')?.name).toBe('Neu');
  });

  // What: a booking-cell change (an undo array present, meaning this is NOT a structural
  // machine-list change) must NOT invalidate the machine lookup cache — that cache tracks
  // machines, not bookings, so touching it here would be pointless work on the hot cell-write path.
  // How: builds the cache, mutates the underlying machines array in place WITHOUT going
  // through mutate() (simulating a change mutate() shouldn't need to know about), then runs a
  // cell-booking mutate (undo array present) and checks the cache still doesn't see the new
  // machine — proving mutate() correctly left the cache alone.
  it('does NOT invalidate the machine lookup cache for a booking-cell change (undo array present)', async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    machById('m1'); // builds the cache
    window.S.data!.machines.push({ id: 'new-machine', name: 'Neu', group: 'Halle 1' }); // in place
    await mutate(
      () => ({ deletedCount: 1, undo: [{ machineId: 'm1', date: '2021-01-04', prev: null }] }),
      'Gebucht',
    );
    expect(machById('new-machine')).toBeUndefined(); // cache correctly left alone
  });

  // What: for a small booking change (an undo array present, under the size threshold),
  // mutate patches only the affected cells directly rather than triggering a full-grid
  // notify() repaint — the cheaper, more surgical path for the common case.
  // How: runs a cell-booking reducer with one undo entry and checks notify was NOT called
  // (the patch path was used instead).
  it('a small undo list patches cells instead of a full notify()', async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    document.body.innerHTML += '<table id="grid"><tbody></tbody></table>';
    await mutate(
      () => ({ deletedCount: 1, undo: [{ machineId: 'm1', date: '2021-01-04', prev: null }] }),
      'x',
    );
    expect(notifySpy).not.toHaveBeenCalled();
  });

  // What: once the undo list grows past 500 entries, mutate abandons the per-cell patch
  // approach and falls back to one full notify() — patching 500+ individual cells would cost
  // more than just repainting everything.
  // How: builds an undo array of 501 entries and checks notify fired exactly once (the
  // fallback), rather than the patch path from the previous test.
  it('an undo list over 500 falls back to a full notify()', async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    const undo = Array.from({ length: 501 }, (_, i) => ({
      machineId: 'm1',
      date: String(i),
      prev: null,
    }));
    await mutate(() => ({ deletedCount: 501, undo }), 'x');
    expect(notifySpy).toHaveBeenCalledOnce();
  });

  // What: mutate resolves and returns control to the caller as soon as the optimistic local
  // apply is done — it does NOT wait for the background server persist (the POST) to
  // complete, keeping the UI responsive.
  // How: stubs fetch to return a promise that's deliberately left unresolved, awaits mutate()
  // anyway, and checks it already resolved with the reducer's result before the fetch promise
  // is ever settled (settled manually afterward, just to clean up).
  it('returns before persist (the background fetch) settles', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      ),
    );
    const returned = await mutate(() => ({}), 'x');
    expect(returned).toEqual({}); // mutate already resolved
    resolveFetch({ ok: true, json: () => Promise.resolve({ rev: 2 }) });
  });

  it('can await an atomic persist for workflows that must keep their dialog open on failure', async () => {
    const fetchSpy = fetchReturning({ rev: 8 });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await mutate(
      () => ({ undo: [{ machineId: 'm1', date: '2021-01-04', prev: null }] }),
      'Buchung bearbeitet',
      { waitForServer: true, atomic: true },
    );
    expect(result?.abort).not.toBe(true);
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.atomic).toBe(true);
    expect(window.S.data!.revision).toBe(8);
  });
});

describe('mutate — persist (background)', () => {
  // What: the background persist for a cell-booking change POSTs a cell-delta body (one
  // prev/val pair per changed cell, derived from the undo entries) plus the log/user fields,
  // and once the server confirms, the local revision number updates to match.
  // How: books a cell, runs mutate with an undo entry for it, waits for the revision to
  // update, then inspects the actual POST body sent and checks its cells/log/user fields.
  it('posts a cell delta with prev/val per entry, and updates the revision on success', async () => {
    window.S.data!.bookings.m1 = { '2021-01-04': booking({ name: 'anna' }) };
    const fetchSpy = fetchReturning({ rev: 7 });
    vi.stubGlobal('fetch', fetchSpy);
    await mutate(
      () => ({ deletedCount: 1, undo: [{ machineId: 'm1', date: '2021-01-04', prev: null }] }),
      'Gebucht',
    );
    await vi.waitFor(() => expect(window.S.data!.revision).toBe(7));
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.cells).toEqual([
      { machineId: 'm1', day: '2021-01-04', prev: null, val: booking({ name: 'anna' }) },
    ]);
    expect(body.log).toBe('Gebucht');
    expect(body.user).toBe('anna');
  });

  // What: the background persist for a structural change POSTs the whole machines/groups
  // list (not a cell delta), since a structural change is a full-list replace, not per-cell.
  // How: runs a structural mutate, waits for fetch to be called, and checks the POST body's
  // machines/groups match the current local state.
  it('posts machines/groups for a structural change (no undo array)', async () => {
    const fetchSpy = fetchReturning({ rev: 3 });
    vi.stubGlobal('fetch', fetchSpy);
    await mutate(() => ({}), 'Maschine hinzugefügt');
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.machines).toEqual(window.S.data!.machines);
    expect(body.groups).toEqual(window.S.data!.groups);
  });

  // What: when the server reports the write partially conflicted (someone else took a cell
  // concurrently), the client shows the collision banner AND re-fetches the authoritative
  // state from the server, since the optimistic local apply may now be wrong.
  // How: stubs the server response with a conflicts array, runs mutate, waits for the
  // collision banner to show, and checks a second fetch (the refresh GET) followed the
  // original POST.
  it('on a partial conflict: shows the collision banner and refreshes from the server', async () => {
    vi.stubGlobal(
      'fetch',
      fetchReturning({ rev: 9, conflicts: [{ machineId: 'm1', date: 'x', by: 'bob' }] }),
    );
    await mutate(
      () => ({ deletedCount: 1, undo: [{ machineId: 'm1', date: '2021-01-04', prev: null }] }),
      'x',
    );
    await vi.waitFor(() =>
      expect(document.getElementById('collBanner')!.classList.contains('show')).toBe(true),
    );
    // refreshNow(true) ran: another fetch (GET /api/state) followed the POST.
    await vi.waitFor(() => expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2));
  });

  // What: a server-reported error (a 500-shaped `{error}` body) surfaces as a toast
  // containing the server's own error text, and the client still refreshes from the server
  // afterward so the local optimistic state doesn't silently drift from reality.
  // How: stubs the server response with an error message, runs mutate, and checks the toast
  // eventually shows both the generic "save failed" text and the specific server message.
  it('on a server error response: toasts, and refreshes from the server', async () => {
    vi.stubGlobal('fetch', fetchReturning({ error: 'db locked' }));
    await mutate(
      () => ({ deletedCount: 1, undo: [{ machineId: 'm1', date: '2021-01-04', prev: null }] }),
      'x',
    );
    await vi.waitFor(() =>
      expect(document.getElementById('toast')!.textContent).toContain('Speichern fehlgeschlagen'),
    );
    expect(document.getElementById('toast')!.textContent).toContain('db locked');
  });

  // What: a genuine network failure (the fetch call itself rejecting, not just a bad HTTP
  // response) is handled the same way as a server error — a toast naming the failure, and a
  // refresh attempt afterward (which may itself succeed once connectivity returns).
  // How: stubs fetch to reject once (simulating "offline") then succeed on the next call
  // (the refresh), runs mutate, and checks the toast shows both the generic failure text and
  // the specific "offline" error message.
  it('when the POST itself throws (network failure): toasts, and still tries to refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(serverData()),
        }),
    );
    await mutate(
      () => ({ deletedCount: 1, undo: [{ machineId: 'm1', date: '2021-01-04', prev: null }] }),
      'x',
    );
    await vi.waitFor(() =>
      expect(document.getElementById('toast')!.textContent).toContain('Speichern fehlgeschlagen'),
    );
    expect(document.getElementById('toast')!.textContent).toContain('offline');
  });
  it('rolls back an awaited atomic edit when persistence and reconciliation both fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await mutate(
      (fresh) => {
        fresh.bookings.m1 = { '2021-01-04': booking() };
        return {
          count: 1,
          undo: [{ machineId: 'm1', date: '2021-01-04', prev: null }],
        };
      },
      'Buchung bearbeitet',
      { atomic: true, waitForServer: true },
    );
    expect(result?.abort).toBe(true);
    expect(window.S.data!.bookings.m1).toBeUndefined();
  });
});

describe('refreshNow', () => {
  // What: a normal (non-silent) refresh reloads the full server state, triggers a repaint,
  // records when the refresh happened, and confirms success with a toast.
  // How: stubs the server to return a known revision, calls refreshNow(false), and checks
  // the local revision updated, notify fired, the timestamp indicator got some text, and the
  // toast shows the success message.
  it('reloads S.data, notifies, stamps the time, and toasts unless silent', async () => {
    vi.stubGlobal('fetch', fetchReturning(serverData({ rev: 42 } as unknown as ServerData)));
    await refreshNow(false);
    expect(window.S.data!.revision).toBe(42);
    expect(notifySpy).toHaveBeenCalledOnce();
    expect(document.getElementById('lastRef')!.textContent).not.toBe('');
    expect(document.getElementById('toast')!.textContent).toBe('Aktualisiert ✓');
  });

  // What: a silent refresh (e.g. a periodic background poll) does its job without bothering
  // the user with a success toast.
  // How: calls refreshNow(true) and checks the toast element stayed empty.
  it('does not toast when silent', async () => {
    vi.stubGlobal('fetch', fetchReturning(serverData()));
    await refreshNow(true);
    expect(document.getElementById('toast')!.textContent).toBe('');
  });

  // What: a failed (non-silent) refresh flips the timestamp indicator to an explicit offline
  // warning (rather than leaving stale/misleading text) and toasts the specific error.
  // How: stubs fetch to reject, calls refreshNow(false), and checks both the indicator text
  // and the toast content.
  it('on failure: flips the offline indicator, and toasts unless silent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await refreshNow(false);
    expect(document.getElementById('lastRef')!.textContent).toBe('⚠ offline');
    expect(document.getElementById('toast')!.textContent).toContain('down');
  });

  // What: a failed SILENT refresh still flips the offline indicator (the user should still
  // see connectivity is lost) but suppresses the toast, same silent behavior as a successful
  // silent refresh.
  // How: stubs fetch to reject, calls refreshNow(true), and checks the indicator shows
  // offline while the toast stays empty.
  it('on failure, silent: flips the offline indicator without toasting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await refreshNow(true);
    expect(document.getElementById('lastRef')!.textContent).toBe('⚠ offline');
    expect(document.getElementById('toast')!.textContent).toBe('');
  });
});

describe('stampRef', () => {
  // What: stampRef writes a readable current-time label into the #lastRef indicator element.
  // How: calls stampRef() and checks the element's text matches an HH:MM-shaped pattern.
  it('writes the current time into #lastRef', () => {
    stampRef();
    expect(document.getElementById('lastRef')!.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  // What: calling stampRef when the #lastRef element isn't in the DOM is a safe no-op.
  // How: empties the document body and checks calling stampRef() doesn't throw.
  it('is a no-op (not a throw) when #lastRef is absent', () => {
    document.body.innerHTML = '';
    expect(() => stampRef()).not.toThrow();
  });
});
