// =======================================================================================
// LIVE CONNECTION MODULE (web/js/ui/live-connection.ts)
// =======================================================================================
//
// The live server connection: the EventSource lifecycle (presence, cell updates,
// structural reloads) and the remote-change toast queue.
// This module:
// 1. Owns the SSE `EventSource` connection and its event handlers.
// 2. Tracks presence (`presenceData`) and formats it for the toolbar badge/popup.
// 3. Queues and drains remote-change toast notifications, one at a time.
//
// Key Principles:
// - DOM ADAPTER OVER A PURE CORE: the pure event-payload logic
//   (`applyUpdate`/`isForeign`/`remoteMessage`/`presenceInfo`) lives in `net/sse.ts`; this
//   module is the DOM/EventSource plumbing around it, kept a plain module rather than a
//   React component since there's no rendered UI of its own to componentize.
// - LIVES UNDER ui/, NOT net/: this module touches the DOM/toast directly, and `net/` must
//   never depend on `ui/` — the layering only works one direction.
//
// =======================================================================================

import { applyUpdate, isForeign, presenceInfo, remoteMessage } from '../net/sse.ts';
import { API, readFile } from '../net/api.ts';
import { patchCells } from './cell-patch.ts';
import { toast } from './toast.ts';
import { setPresence } from './user-chip.ts';
import { store } from '../store-instance.ts';
import { dbg, handleError } from './debug-panel.ts';
import { stampRef, refreshNow } from './mutate.ts';
import { fillGroupSel } from './components/GroupFilterDropdown.tsx';

/** The last known presence timestamp per name, `{name: ms-since-epoch}` — read by
 *  `ui/components/ActiveUsersModal.tsx`'s `activeUserRows`. Mutated in place (not reassigned)
 *  so importers always see the live object. */
export const presenceData: Record<string, number> = {};

/** Refreshes `presenceData` and the toolbar badge from a `presence` SSE event's user list —
 *  replaces the whole map rather than merging, since the event always carries the complete
 *  current user list, not a delta. */
function applyPresence(users: readonly (string | null | undefined)[] | undefined): void {
  const info = presenceInfo(users);
  const now = Date.now();
  for (const key of Object.keys(presenceData)) delete presenceData[key];
  for (const user of info.list) presenceData[user] = now;
  setPresence(info.count, info.label);
}

export interface ActiveUserRow {
  name: string;
  /** Seconds since this name was last seen. */
  ago: number;
}

/** Lists everyone in `presenceData` seen within the last 180s, sorted most-recently-seen
 *  first — a presence entry older than that is treated as stale (that browser tab likely
 *  closed without a clean disconnect) and left out entirely. `now` is injected so this
 *  stays a pure function of its input. */
export function activeUserRows(now: number): ActiveUserRow[] {
  return Object.entries(presenceData)
    .map(([name, ts]) => ({ name, ago: Math.round((now - ts) / 1000) }))
    .filter((row) => row.ago < 180)
    .sort((a, b) => a.ago - b.ago);
}

let remoteQueue: string[] = [];
let remoteQueueRunning = false;

/** Drains the remote-change queue one toast at a time (~2.6s each), pausing while an undo
 *  toast is showing — a remote notice should never steal the screen from, or get raced by,
 *  an undo action the local user might still want to click. */
function runRemoteQueue(): void {
  if (!remoteQueue.length) {
    remoteQueueRunning = false;
    return;
  }
  const toastElement = document.getElementById('toast')!;
  if (toastElement.classList.contains('action') && toastElement.classList.contains('show')) {
    setTimeout(runRemoteQueue, 1500);
    return;
  }
  remoteQueueRunning = true;
  toast(remoteQueue.shift()!, undefined, 2600);
  setTimeout(runRemoteQueue, 2800);
}

/** Queues a remote-change toast; capped at 8 deep, dropping the oldest first — a burst of
 *  colleague activity shouldn't leave a huge backlog of toasts to slowly drain through. */
export function queueRemoteChange(message: string): void {
  remoteQueue.push(message);
  if (remoteQueue.length > 8) remoteQueue = remoteQueue.slice(-8);
  if (!remoteQueueRunning) runRemoteQueue();
}

let eventSource: EventSource | null = null;

/**
 * (Re)connects the live SSE stream: presence, cell updates, and structural (machine-list)
 * changes. Closes any existing connection first, so calling this again (e.g. after a name
 * change) never leaves two connections open at once.
 */
export function connectSSE(): void {
  try {
    eventSource?.close();
  } catch {
    /* already closed */
  }
  // "Anwesenheit teilen" off → connect without a name, so this browser doesn't appear in
  // others' presence lists.
  const sharePresence = localStorage.getItem('mb_presence') !== 'off';
  const userName = sharePresence ? store.get('user') || '' : '';
  eventSource = new EventSource(
    API + '/api/stream' + (userName ? '?user=' + encodeURIComponent(userName) : ''),
  );
  eventSource.addEventListener('hello', () => {
    stampRef();
    dbg('info', 'Live-Verbindung steht');
  });
  eventSource.addEventListener('presence', (event) => {
    try {
      applyPresence(JSON.parse(event.data).users);
    } catch (error) {
      handleError('sse/presence', error);
    }
  });
  eventSource.addEventListener('update', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    const { rev, patch } = applyUpdate(data, store.get('data')!.bookings);
    if (rev !== null) store.get('data')!.revision = rev;
    if (patch.length) patchCells(patch);
    stampRef();
    if (isForeign(data.by, store.get('user') || '?') && data.log) {
      dbg('remote', data.by + ': ' + data.log);
      queueRemoteChange(remoteMessage({ user: data.by, action: data.log }));
    }
  });
  eventSource.addEventListener('structural', async (event) => {
    try {
      // Silent — fillGroupSel() rebuilds from the new data before the one notify fires;
      // store.set() here would notify a beat early, before fillGroupSel() has run.
      store.state.data = await readFile();
      fillGroupSel();
      store.notify();
    } catch (error) {
      handleError('sse/structural', error);
    }
    let by = '';
    try {
      by = JSON.parse(event.data).by;
    } catch {
      /* no author info */
    }
    if (isForeign(by, store.get('user') || '?')) toast(by + ' hat die Maschinenliste geändert.');
  });
  eventSource.onerror = () => {
    const lastRefEl = document.getElementById('lastRef');
    if (lastRefEl) lastRefEl.textContent = '⚠ offline';
  };
}

/** Reconnects with a possibly-new user name — called after a name change, so the new name
 *  takes effect in presence immediately rather than waiting for the next natural reconnect. */
export async function presenceTick(): Promise<void> {
  connectSSE();
}

let liveTimersStarted = false;

/** Starts the focus-triggered silent refresh and the live SSE connection. Idempotent — a
 *  second call is a no-op, so callers don't need to track whether they've already started it. */
export function startLiveTimers(): void {
  if (liveTimersStarted) return;
  liveTimersStarted = true;
  window.addEventListener('focus', () => void refreshNow(true));
  connectSSE();
}
