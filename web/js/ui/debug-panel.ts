// =======================================================================================
// DEBUG PANEL MODULE (web/js/ui/debug-panel.ts)
// =======================================================================================
//
// A device-local, Admin-only toggleable log of write/error/remote/latency events
// (`mb_debug` in `localStorage`; no server involvement — this never leaves the browser).
// This module also provides the app's central error-handling helper (`handleError`), since
// every caught error's natural destination is this same debug log.
//
// Key Principles:
// - DEVICE-LOCAL, OPT-IN: the panel is off by default and only ever affects the device that
//   turned it on — nothing here is visible to, or affects, any other user.
//
// =======================================================================================

import { escapeHtml } from './escape-html.ts';
import { store } from '../store-instance.ts';

/** Whether the debug panel is currently switched on for this device. */
export function dbgOn(): boolean {
  return localStorage.getItem('mb_debug') === 'on';
}

const KIND_CLASS: Record<string, string> = {
  err: ' err',
  write: ' write',
  remote: ' remote',
  latency: ' latency',
};

/** Logs one event to the debug panel — a no-op when the panel is off, or the panel element
 *  is absent from the DOM. Capped at 200 rows, newest first (the oldest row is dropped once
 *  the cap is exceeded, so the log never grows unbounded during a long session). */
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

/** Syncs `#dbgPanel`'s visibility with {@link dbgOn}, logging an activation line whenever
 *  the panel turns out to be on (so a session that starts with debug already enabled still
 *  gets a visible "debug mode active" marker at the top of the log). */
export function applyDebug(): void {
  document.getElementById('dbgPanel')?.classList.toggle('open', dbgOn());
  if (dbgOn()) dbg('info', 'Debug-Modus aktiv — Nutzer: ' + (store.get('user') || '?'));
}

/** Extracts a readable message from a caught value: `err.message` when present and truthy,
 *  else `String(err)` — so a plain string, a non-Error object, or a genuine `Error` all
 *  produce something readable instead of `"[object Object]"`. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && (err as { message: unknown }).message) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Central error handling: swallows `AbortError` (an expected cancellation from an
 *  in-flight fetch being superseded, not a real failure), otherwise logs to the console and
 *  the debug panel. `source` is a short tag identifying where the error came from (e.g.
 *  `'sse/presence'`). */
export function handleError(source: string, err: unknown): void {
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError') return;
  console.error('[' + source + ']', err);
  try {
    dbg('err', source + ': ' + errorMessage(err));
  } catch {
    /* dbg itself must never throw from inside an error handler */
  }
}

/** Wires `#dbgClear`/`#dbgClose`. Call once at boot. */
export function initDebugPanel(): void {
  document.getElementById('dbgClear')!.onclick = () => {
    document.getElementById('dbgList')!.innerHTML = '';
  };
  document.getElementById('dbgClose')!.onclick = () => {
    localStorage.setItem('mb_debug', 'off');
    applyDebug();
  };
}
