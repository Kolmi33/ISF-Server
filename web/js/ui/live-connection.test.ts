// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppState } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';

// live-connection.ts now imports these directly (F8 cleanup, ARCHITECTURE_AUDIT.md) rather
// than reaching through `window.*` — mocked here so this test keeps observing/controlling
// them exactly as it did via the old window stubs. `../net/api.ts` keeps its real `API`
// export (used to build the SSE URL); only `readFile` is replaced.
vi.mock('./mutate.ts', () => ({
  stampRef: vi.fn(),
  refreshNow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./debug-panel.ts', () => ({
  dbg: vi.fn(),
  handleError: vi.fn(),
}));
vi.mock('./components/GroupFilterDropdown.tsx', () => ({
  fillGroupSel: vi.fn(),
}));
vi.mock('../net/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../net/api.ts')>()),
  readFile: vi.fn().mockResolvedValue({ machines: [], bookings: {} }),
}));

import {
  activeUserRows,
  connectSSE,
  presenceData,
  presenceTick,
  startLiveTimers,
} from './live-connection.ts';
import { stampRef, refreshNow } from './mutate.ts';
import { dbg, handleError } from './debug-panel.ts';
import { fillGroupSel } from './components/GroupFilterDropdown.tsx';
import { readFile } from '../net/api.ts';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners: Record<string, ((event: { data: string }) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: { data: string }) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: unknown): void {
    for (const handler of this.listeners[type] ?? []) handler({ data: JSON.stringify(data) });
  }
}

function latestEventSource(): MockEventSource {
  return MockEventSource.instances[MockEventSource.instances.length - 1]!;
}

// live-connection.ts now reads/writes state via the real `store` singleton — spied once
// here (call history cleared per test below) rather than relying on a mocked window.notify.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  localStorage.clear();
  document.body.innerHTML = '<span id="lastRef"></span><div id="toast"></div>';
  store.set({
    user: 'anna',
    data: { machines: [], bookings: {} },
    visD: [],
    visM: [],
  } as unknown as Partial<AppState>);
  window.S = store.state;
  for (const key of Object.keys(presenceData)) delete presenceData[key];
  vi.clearAllMocks(); // clears notifySpy's call history too; implementations survive
});

describe('connectSSE', () => {
  // What: the URL connectSSE opens when presence sharing is on (the default).
  // How: call connectSSE(), then read the mock EventSource's constructor URL directly —
  // no event needs to fire, since the URL is decided before the connection even opens.
  it('connects with the user name in the URL when presence sharing is on (the default)', () => {
    connectSSE();
    expect(latestEventSource().url).toBe('/api/stream?user=anna');
  });

  // What: presence sharing can be turned off, which must omit the name from the URL
  // entirely (not just leave it empty) — the whole point is this browser is invisible.
  // How: set the localStorage flag the module reads, then check the URL has no ?user= at all.
  it('connects without a user name when presence sharing is turned off', () => {
    localStorage.setItem('mb_presence', 'off');
    connectSSE();
    expect(latestEventSource().url).toBe('/api/stream');
  });

  // What: calling connectSSE() a second time (e.g. after a name change) must close the
  // stale connection, never leaving two EventSources open at once.
  // How: connect twice, keep a reference to the first instance, and assert it was closed
  // while a second instance was created.
  it('closes the previous connection before opening a new one', () => {
    connectSSE();
    const first = latestEventSource();
    connectSSE();
    expect(first.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
  });

  // What: the "hello" event (the server's first message on a fresh connection) should
  // stamp the last-refresh time and log a confirmation line.
  // How: connect, manually emit a synthetic "hello" event on the mock EventSource, and
  // assert both side effects fired.
  it('"hello" stamps the last-refresh time and logs', () => {
    connectSSE();
    latestEventSource().emit('hello');
    expect(stampRef).toHaveBeenCalled();
    expect(dbg).toHaveBeenCalledWith('info', expect.any(String));
  });

  // What: a "presence" event's user list should update both the in-memory presenceData map
  // and the toolbar's visible count badge.
  // How: add a badge element to the DOM (not present by default), emit a presence event
  // with two names, and check both the map's keys and the badge's rendered text.
  it('"presence" updates presenceData and the toolbar badge from the parsed user list', () => {
    document.body.innerHTML += '<span id="presBadge"></span>';
    connectSSE();
    latestEventSource().emit('presence', { users: ['anna', 'bob'] });
    expect(Object.keys(presenceData).sort()).toEqual(['anna', 'bob']);
    expect(document.getElementById('presBadge')!.textContent).toBe('2');
  });

  // What: presenceData is a full replacement on every event, not a merge — a name absent
  // from a later event must disappear, not linger from an earlier snapshot.
  // How: emit two presence events with disjoint user lists back to back, and assert only
  // the second event's name remains afterward.
  it('"presence" replaces presenceData wholesale — a name missing from a later event drops off', () => {
    connectSSE();
    latestEventSource().emit('presence', { users: ['anna'] });
    latestEventSource().emit('presence', { users: ['bob'] });
    expect(Object.keys(presenceData)).toEqual(['bob']);
  });

  // What: a malformed "presence" payload must be reported through the central error
  // handler, not thrown as an uncaught exception that could crash the SSE listener.
  // How: emit with `undefined` data — the mock's JSON.stringify(undefined) produces the
  // literal string "undefined", which JSON.parse rejects, reliably reproducing a malformed
  // payload — then assert the call doesn't throw and handleError was invoked instead.
  it('"presence" with unparsable data reports the error instead of throwing', () => {
    connectSSE();
    expect(() => latestEventSource().emit('presence', undefined)).not.toThrow();
    expect(handleError).toHaveBeenCalledWith('sse/presence', expect.anything());
  });

  // What: an "update" event must apply its cell changes to the in-memory bookings, adopt
  // the new revision number, and stamp the refresh time — the three things a client needs
  // to stay in sync after someone else's write.
  // How: emit an update with one cell change and a revision, then read the change straight
  // back off the live store state and check the revision/stamp side effects too.
  it('"update" applies the patch to bookings, patches cells, adopts the revision, and stamps the time', () => {
    connectSSE();
    latestEventSource().emit('update', {
      rev: 7,
      changes: [{ machineId: 'm1', day: '2021-01-04', val: { name: 'anna' } }],
    });
    expect(window.S.data!.bookings.m1!['2021-01-04']).toEqual({ name: 'anna' });
    expect(window.S.data!.revision).toBe(7);
    expect(stampRef).toHaveBeenCalled();
  });

  // What: an "update" attributed to someone else (`by`) should surface as a remote-change
  // toast, so the local user notices a colleague's write.
  // How: emit an update with `by: 'bob'` and a `log` message, then check both the debug
  // log entry and the actual rendered toast text.
  it('"update" from someone else queues a remote-change toast', () => {
    connectSSE();
    latestEventSource().emit('update', {
      changes: [],
      by: 'bob',
      log: 'Buchung: Bob, 1 Maschine, 2021-01-04 bis 2021-01-04',
    });
    expect(dbg).toHaveBeenCalledWith('remote', expect.stringContaining('bob'));
    expect(document.getElementById('toast')!.textContent).toMatch(/Bob hat 1 Maschine gebucht/);
  });

  // What: an "update" attributed to the CURRENT user (this client's own write echoed back
  // by the server) must NOT toast — a user shouldn't get notified about their own action.
  // How: emit with `by` matching the logged-in user (case-insensitively — 'ANNA' vs
  // 'anna'), and assert the toast area stayed empty.
  it('"update" from the current user does not queue a toast', () => {
    connectSSE();
    latestEventSource().emit('update', { changes: [], by: 'ANNA', log: 'Reihenfolge geändert' });
    expect(document.getElementById('toast')!.textContent).toBe('');
  });

  // What: a "structural" event (the machine list itself changed) must trigger a full state
  // reload, rebuild the group filter, notify subscribers, and toast — but only when a
  // foreign author made the change.
  // How: emit a structural event from 'bob', await the microtask queue so the listener's
  // internal readFile() await settles, then check every one of those four side effects.
  it('"structural" reloads state and notifies, and toasts only for a foreign author', async () => {
    connectSSE();
    await latestEventSource().emit('structural', { by: 'bob' });
    await Promise.resolve(); // let the async listener's readFile() await settle
    expect(readFile).toHaveBeenCalled();
    expect(fillGroupSel).toHaveBeenCalled();
    expect(notifySpy).toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toMatch(/Maschinenliste geändert/);
  });

  // What: the same "structural" reload happens for a same-user change too, but the toast
  // (which exists to notify about SOMEONE ELSE'S change) must stay silent.
  // How: emit from 'anna' (the logged-in user) and assert no toast text appeared.
  it('"structural" from the current user does not toast', async () => {
    connectSSE();
    await latestEventSource().emit('structural', { by: 'anna' });
    await Promise.resolve();
    expect(document.getElementById('toast')!.textContent).toBe('');
  });

  // What: a connection error should visibly flip the toolbar's status text to an offline
  // indicator, so a disconnected user isn't left thinking their view is still live.
  // How: connect, invoke the mock EventSource's onerror handler directly, and check the
  // status element's text.
  it('onerror flips the "offline" indicator', () => {
    connectSSE();
    latestEventSource().onerror?.();
    expect(document.getElementById('lastRef')!.textContent).toBe('⚠ offline');
  });
});

describe('presenceTick', () => {
  // What: presenceTick must reconnect the SSE stream (used after a user-name change, so
  // presence starts reporting under the new name).
  // How: connect, change the store's user, call presenceTick(), and assert the old
  // connection closed while a new one opened with the new name in its URL.
  it('reconnects (e.g. under a new user name)', async () => {
    connectSSE();
    const first = latestEventSource();
    window.S.user = 'newname';
    await presenceTick();
    expect(first.closed).toBe(true);
    expect(latestEventSource().url).toBe('/api/stream?user=newname');
  });
});

describe('startLiveTimers', () => {
  // What: starting the live timers should open exactly one SSE connection and wire a
  // window focus listener that triggers a silent background refresh.
  // How: spy on window.addEventListener to capture the registered focus handler, call
  // startLiveTimers(), then invoke that captured handler directly and check refreshNow
  // was called with the "silent" flag.
  it('connects once and wires a focus listener that silently refreshes', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    startLiveTimers();
    expect(MockEventSource.instances).toHaveLength(1);
    const focusHandler = addEventListenerSpy.mock.calls.find(
      ([type]) => type === 'focus',
    )?.[1] as () => void;
    focusHandler();
    expect(refreshNow).toHaveBeenCalledWith(true);
  });
});

describe('activeUserRows', () => {
  // What: each row's "seconds ago" figure must be computed correctly, and rows sorted
  // most-recently-seen first.
  // How: seed presenceData with two names at different timestamps, call activeUserRows
  // with a fixed "now", and check both the computed ago values and their order.
  it('computes seconds-ago and sorts most-recently-seen first', () => {
    presenceData.anna = 1000;
    presenceData.bob = 5000;
    expect(activeUserRows(6000)).toEqual([
      { name: 'bob', ago: 1 },
      { name: 'anna', ago: 5 },
    ]);
  });

  // What: a presence entry older than the 180s staleness window must be excluded, not
  // shown with a huge "ago" number.
  // How: seed one entry at time 0, then call activeUserRows with "now" just past 180s
  // later, and check the result is empty.
  it('drops anyone not seen within the last 180s', () => {
    presenceData.anna = 0;
    expect(activeUserRows(181_000)).toEqual([]);
  });

  // What: an empty presenceData map (nobody has connected yet) must yield an empty list,
  // not throw or return something malformed.
  // How: call activeUserRows against the fresh (beforeEach-cleared) presenceData directly.
  it('is empty when nobody has ever been seen', () => {
    expect(activeUserRows(0)).toEqual([]);
  });
});
