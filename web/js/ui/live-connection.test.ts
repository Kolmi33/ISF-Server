// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppState } from '../../../shared/types.ts';
import { connectSSE, presenceTick, startLiveTimers } from './live-connection.ts';

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

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  localStorage.clear();
  document.body.innerHTML = '<span id="lastRef"></span><div id="toast"></div>';
  window.S = {
    user: 'anna',
    data: { machines: [], bookings: {} },
    visD: [],
    visM: [],
  } as unknown as AppState;
  window.stampRef = vi.fn();
  window.dbg = vi.fn();
  window.applyPresence = vi.fn();
  window.handleError = vi.fn();
  window.readFile = vi.fn().mockResolvedValue({ machines: [], bookings: {} });
  window.fillGroupSel = vi.fn();
  window.notify = vi.fn();
  window.refreshNow = vi.fn().mockResolvedValue(undefined);
});

describe('connectSSE', () => {
  it('connects with the user name in the URL when presence sharing is on (the default)', () => {
    connectSSE();
    expect(latestEventSource().url).toBe('/api/stream?user=anna');
  });

  it('connects without a user name when presence sharing is turned off', () => {
    localStorage.setItem('mb_presence', 'off');
    connectSSE();
    expect(latestEventSource().url).toBe('/api/stream');
  });

  it('closes the previous connection before opening a new one', () => {
    connectSSE();
    const first = latestEventSource();
    connectSSE();
    expect(first.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it('"hello" stamps the last-refresh time and logs', () => {
    connectSSE();
    latestEventSource().emit('hello');
    expect(window.stampRef).toHaveBeenCalled();
    expect(window.dbg).toHaveBeenCalledWith('info', expect.any(String));
  });

  it('"presence" forwards the parsed user list to the (still-legacy) applyPresence', () => {
    connectSSE();
    latestEventSource().emit('presence', { users: ['anna', 'bob'] });
    expect(window.applyPresence).toHaveBeenCalledWith(['anna', 'bob']);
  });

  it('"presence" with unparsable data reports the error instead of throwing', () => {
    connectSSE();
    expect(() => latestEventSource().emit('presence', undefined)).not.toThrow();
    // `emit` JSON.stringifies `undefined` to the literal string "undefined", which JSON.parse
    // rejects — exactly the malformed-payload case this guard exists for.
    expect(window.handleError).toHaveBeenCalledWith('sse/presence', expect.anything());
  });

  it('"update" applies the patch to bookings, patches cells, adopts the revision, and stamps the time', () => {
    connectSSE();
    latestEventSource().emit('update', {
      rev: 7,
      changes: [{ mid: 'm1', day: '2021-01-04', val: { name: 'anna' } }],
    });
    expect(window.S.data!.bookings.m1!['2021-01-04']).toEqual({ name: 'anna' });
    expect(window.S.data!.revision).toBe(7);
    expect(window.stampRef).toHaveBeenCalled();
  });

  it('"update" from someone else queues a remote-change toast', () => {
    connectSSE();
    latestEventSource().emit('update', {
      changes: [],
      by: 'bob',
      log: 'Buchung: Bob, 1 Maschine, 2021-01-04 bis 2021-01-04',
    });
    expect(window.dbg).toHaveBeenCalledWith('remote', expect.stringContaining('bob'));
    expect(document.getElementById('toast')!.textContent).toMatch(/Bob hat 1 Maschine gebucht/);
  });

  it('"update" from the current user does not queue a toast', () => {
    connectSSE();
    latestEventSource().emit('update', { changes: [], by: 'ANNA', log: 'Reihenfolge geändert' });
    expect(document.getElementById('toast')!.textContent).toBe('');
  });

  it('"structural" reloads state and notifies, and toasts only for a foreign author', async () => {
    connectSSE();
    await latestEventSource().emit('structural', { by: 'bob' });
    await Promise.resolve(); // let the async listener's readFile() await settle
    expect(window.readFile).toHaveBeenCalled();
    expect(window.fillGroupSel).toHaveBeenCalled();
    expect(window.notify).toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toMatch(/Maschinenliste geändert/);
  });

  it('"structural" from the current user does not toast', async () => {
    connectSSE();
    await latestEventSource().emit('structural', { by: 'anna' });
    await Promise.resolve();
    expect(document.getElementById('toast')!.textContent).toBe('');
  });

  it('onerror flips the "offline" indicator', () => {
    connectSSE();
    latestEventSource().onerror?.();
    expect(document.getElementById('lastRef')!.textContent).toBe('⚠ offline');
  });
});

describe('presenceTick', () => {
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
  it('connects once and wires a focus listener that silently refreshes', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    startLiveTimers();
    expect(MockEventSource.instances).toHaveLength(1);
    const focusHandler = addEventListenerSpy.mock.calls.find(
      ([type]) => type === 'focus',
    )?.[1] as () => void;
    focusHandler();
    expect(window.refreshNow).toHaveBeenCalledWith(true);
  });
});
