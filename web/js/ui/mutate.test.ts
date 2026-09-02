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
  it("applies fn to S.data synchronously, logs the action, and returns fn's result", async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    const fn = vi.fn((fresh) => {
      fresh.bookings.m1 = { '2021-01-04': booking() };
      return { n: 1, undo: [{ mid: 'm1', date: '2021-01-04', prev: null }] };
    });
    const result = await mutate(fn, 'Gebucht: Anna');
    expect(window.S.data!.bookings.m1!['2021-01-04']).toEqual(booking());
    expect(result).toEqual({ n: 1, undo: [{ mid: 'm1', date: '2021-01-04', prev: null }] });
    expect(window.S.data!.log[0]).toMatchObject({ user: 'anna', action: 'Gebucht: Anna' });
  });

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

  it('notify()s directly for a structural change (no undo array)', async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    await mutate(() => ({ abort: false }), 'Maschine verschoben');
    expect(notifySpy).toHaveBeenCalledOnce();
  });

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

  it('does NOT invalidate the machine lookup cache for a booking-cell change (undo array present)', async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    machById('m1'); // builds the cache
    window.S.data!.machines.push({ id: 'new-machine', name: 'Neu', group: 'Halle 1' }); // in place
    await mutate(
      () => ({ n: 1, undo: [{ mid: 'm1', date: '2021-01-04', prev: null }] }),
      'Gebucht',
    );
    expect(machById('new-machine')).toBeUndefined(); // cache correctly left alone
  });

  it('a small undo list patches cells instead of a full notify()', async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    document.body.innerHTML += '<table id="grid"><tbody></tbody></table>';
    await mutate(() => ({ n: 1, undo: [{ mid: 'm1', date: '2021-01-04', prev: null }] }), 'x');
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('an undo list over 500 falls back to a full notify()', async () => {
    vi.stubGlobal('fetch', fetchReturning({ rev: 2 }));
    const undo = Array.from({ length: 501 }, (_, i) => ({
      mid: 'm1',
      date: String(i),
      prev: null,
    }));
    await mutate(() => ({ n: 501, undo }), 'x');
    expect(notifySpy).toHaveBeenCalledOnce();
  });

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
});

describe('mutate — persist (background)', () => {
  it('posts a cell delta with prev/val per entry, and updates the revision on success', async () => {
    window.S.data!.bookings.m1 = { '2021-01-04': booking({ name: 'anna' }) };
    const fetchSpy = fetchReturning({ rev: 7 });
    vi.stubGlobal('fetch', fetchSpy);
    await mutate(
      () => ({ n: 1, undo: [{ mid: 'm1', date: '2021-01-04', prev: null }] }),
      'Gebucht',
    );
    await vi.waitFor(() => expect(window.S.data!.revision).toBe(7));
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.cells).toEqual([
      { mid: 'm1', day: '2021-01-04', prev: null, val: booking({ name: 'anna' }) },
    ]);
    expect(body.log).toBe('Gebucht');
    expect(body.user).toBe('anna');
  });

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

  it('on a partial conflict: shows the collision banner and refreshes from the server', async () => {
    vi.stubGlobal(
      'fetch',
      fetchReturning({ rev: 9, conflicts: [{ mid: 'm1', date: 'x', by: 'bob' }] }),
    );
    await mutate(() => ({ n: 1, undo: [{ mid: 'm1', date: '2021-01-04', prev: null }] }), 'x');
    await vi.waitFor(() =>
      expect(document.getElementById('collBanner')!.classList.contains('show')).toBe(true),
    );
    // refreshNow(true) ran: another fetch (GET /api/state) followed the POST.
    await vi.waitFor(() => expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2));
  });

  it('on a server error response: toasts, and refreshes from the server', async () => {
    vi.stubGlobal('fetch', fetchReturning({ error: 'db locked' }));
    await mutate(() => ({ n: 1, undo: [{ mid: 'm1', date: '2021-01-04', prev: null }] }), 'x');
    await vi.waitFor(() =>
      expect(document.getElementById('toast')!.textContent).toContain('Speichern fehlgeschlagen'),
    );
    expect(document.getElementById('toast')!.textContent).toContain('db locked');
  });

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
    await mutate(() => ({ n: 1, undo: [{ mid: 'm1', date: '2021-01-04', prev: null }] }), 'x');
    await vi.waitFor(() =>
      expect(document.getElementById('toast')!.textContent).toContain('Speichern fehlgeschlagen'),
    );
    expect(document.getElementById('toast')!.textContent).toContain('offline');
  });
});

describe('refreshNow', () => {
  it('reloads S.data, notifies, stamps the time, and toasts unless silent', async () => {
    vi.stubGlobal('fetch', fetchReturning(serverData({ rev: 42 } as unknown as ServerData)));
    await refreshNow(false);
    expect(window.S.data!.revision).toBe(42);
    expect(notifySpy).toHaveBeenCalledOnce();
    expect(document.getElementById('lastRef')!.textContent).not.toBe('');
    expect(document.getElementById('toast')!.textContent).toBe('Aktualisiert ✓');
  });

  it('does not toast when silent', async () => {
    vi.stubGlobal('fetch', fetchReturning(serverData()));
    await refreshNow(true);
    expect(document.getElementById('toast')!.textContent).toBe('');
  });

  it('on failure: flips the offline indicator, and toasts unless silent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await refreshNow(false);
    expect(document.getElementById('lastRef')!.textContent).toBe('⚠ offline');
    expect(document.getElementById('toast')!.textContent).toContain('down');
  });

  it('on failure, silent: flips the offline indicator without toasting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await refreshNow(true);
    expect(document.getElementById('lastRef')!.textContent).toBe('⚠ offline');
    expect(document.getElementById('toast')!.textContent).toBe('');
  });
});

describe('stampRef', () => {
  it('writes the current time into #lastRef', () => {
    stampRef();
    expect(document.getElementById('lastRef')!.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('is a no-op (not a throw) when #lastRef is absent', () => {
    document.body.innerHTML = '';
    expect(() => stampRef()).not.toThrow();
  });
});
