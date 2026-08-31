// The live server connection (Phase 7 slice B8): the EventSource lifecycle (presence, cell
// updates, structural reloads) and the remote-change toast queue. Faithful port of legacy
// `connectSSE`/`presenceTick`/`startLiveTimers`/`queueRemote`/`runRemoteQ`. The pure
// event-payload logic (`applyUpdate`/`isForeign`/`remoteMessage`) already lives in `net/sse.ts`
// — this module is the DOM/EventSource adapter, kept a plain module rather than a React
// component (there's no rendered UI of its own to componentize; see `ui/user-chip.ts`'s header
// comment for the same judgment call on the presence badge). Lives under `ui/`, not `net/`,
// because it touches the DOM/toast (`net/` must not depend on `ui/`).

import { applyUpdate, isForeign, remoteMessage } from '../net/sse.ts';
import { API } from '../net/api.ts';
import { patchCells } from './cell-patch.ts';
import { toast } from './toast.ts';

let remoteQueue: string[] = [];
let remoteQueueRunning = false;

/** Drain the remote-change queue one toast at a time (~2.6s each), pausing while an undo toast
 *  is showing. Faithful port of legacy `runRemoteQ`. */
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

/** Queue a remote-change toast; capped at 8 deep (drops the oldest first). Faithful port of
 *  legacy `queueRemote`. */
export function queueRemoteChange(message: string): void {
  remoteQueue.push(message);
  if (remoteQueue.length > 8) remoteQueue = remoteQueue.slice(-8);
  if (!remoteQueueRunning) runRemoteQueue();
}

let eventSource: EventSource | null = null;

/**
 * (Re)connect the live SSE stream: presence, cell updates, and structural (machine-list)
 * changes. Closes any existing connection first. Faithful port of legacy `connectSSE`.
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
  const userName = sharePresence ? window.S.user || '' : '';
  eventSource = new EventSource(
    API + '/api/stream' + (userName ? '?user=' + encodeURIComponent(userName) : ''),
  );
  eventSource.addEventListener('hello', () => {
    window.stampRef();
    window.dbg('info', 'Live-Verbindung steht');
  });
  eventSource.addEventListener('presence', (event) => {
    try {
      window.applyPresence(JSON.parse(event.data).users);
    } catch (error) {
      window.handleError('sse/presence', error);
    }
  });
  eventSource.addEventListener('update', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    const { rev, patch } = applyUpdate(data, window.S.data!.bookings);
    if (rev !== null) window.S.data!.revision = rev;
    if (patch.length) patchCells(patch);
    window.stampRef();
    if (isForeign(data.by, window.S.user || '?') && data.log) {
      window.dbg('remote', data.by + ': ' + data.log);
      queueRemoteChange(remoteMessage({ user: data.by, action: data.log }));
    }
  });
  eventSource.addEventListener('structural', async (event) => {
    try {
      window.S.data = await window.readFile();
      window.fillGroupSel();
      window.notify();
    } catch (error) {
      window.handleError('sse/structural', error);
    }
    let by = '';
    try {
      by = JSON.parse(event.data).by;
    } catch {
      /* no author info */
    }
    if (isForeign(by, window.S.user || '?')) toast(by + ' hat die Maschinenliste geändert.');
  });
  eventSource.onerror = () => {
    const lastRefEl = document.getElementById('lastRef');
    if (lastRefEl) lastRefEl.textContent = '⚠ offline';
  };
}

/** Reconnect with a possibly-new user name (e.g. after a name change). Faithful port of legacy
 *  `presenceTick`. */
export async function presenceTick(): Promise<void> {
  connectSSE();
}

let liveTimersStarted = false;

/** Start the focus-triggered silent refresh and the live SSE connection. Idempotent — a second
 *  call no-ops. Faithful port of legacy `startLiveTimers`. */
export function startLiveTimers(): void {
  if (liveTimersStarted) return;
  liveTimersStarted = true;
  window.addEventListener('focus', () => window.refreshNow(true));
  connectSSE();
}
