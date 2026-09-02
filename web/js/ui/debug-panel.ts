// The debug panel (Phase 7 slice B10f): a device-local, Admin-only toggleable log of
// write/error/remote/latency events (`mb_debug` in localStorage; no server involvement).
// Faithful port of legacy `dbgOn`/`dbg`/`applyDebug`/`handleError`. `#dbgClear`/`#dbgClose`
// wiring is `initDebugPanel`, called once at boot (same pattern as `ui/collision-banner.ts`'s
// `initCollisionBanner`, B8).

import { escapeHtml } from './escape-html.ts';
import { store } from '../store-instance.ts';

/** Whether the debug panel is currently switched on for this device. Faithful port of legacy
 *  `dbgOn`. */
export function dbgOn(): boolean {
  return localStorage.getItem('mb_debug') === 'on';
}

const KIND_CLASS: Record<string, string> = {
  err: ' err',
  write: ' write',
  remote: ' remote',
  latency: ' latency',
};

/** Log one event to the debug panel (a no-op when the panel is off, or absent from the DOM).
 *  Capped at 200 rows, newest first. Faithful port of legacy `dbg`. */
export function dbg(kind: string, msg: string): void {
  if (!dbgOn()) return;
  const list = document.getElementById('dbgList');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'dbgrow' + (KIND_CLASS[kind] || '');
  row.innerHTML =
    `<span class="t">${new Date().toLocaleTimeString('de-DE')}</span>` +
    `[${escapeHtml(kind)}] ${escapeHtml(msg)}`;
  list.prepend(row);
  while (list.children.length > 200) list.lastChild!.remove();
}

/** Sync `#dbgPanel`'s visibility with `dbgOn()`, logging an activation line when turning on.
 *  Faithful port of legacy `applyDebug`. */
export function applyDebug(): void {
  document.getElementById('dbgPanel')?.classList.toggle('open', dbgOn());
  if (dbgOn()) dbg('info', 'Debug-Modus aktiv — Nutzer: ' + (store.get('user') || '?'));
}

/** `err.message` when present and truthy, else `String(err)` — legacy's own
 *  `(err&&err.message)||err` expression, reused by `ui/mutate.ts`'s catch blocks. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && (err as { message: unknown }).message) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Central error handling: swallows `AbortError` (an expected cancellation, not a real
 *  failure), otherwise logs to the console and the debug panel. Faithful port of legacy
 *  `handleError`. */
export function handleError(ctx: string, err: unknown): void {
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError') return;
  console.error('[' + ctx + ']', err);
  try {
    dbg('err', ctx + ': ' + errorMessage(err));
  } catch {
    /* dbg itself must never throw from inside an error handler */
  }
}

/** Wire `#dbgClear`/`#dbgClose`. Call once at boot. Faithful port of legacy's inline
 *  `dbgClear`/`dbgClose` `onclick` bindings. */
export function initDebugPanel(): void {
  document.getElementById('dbgClear')!.onclick = () => {
    document.getElementById('dbgList')!.innerHTML = '';
  };
  document.getElementById('dbgClose')!.onclick = () => {
    localStorage.setItem('mb_debug', 'off');
    applyDebug();
  };
}
