// =======================================================================================
// OPTIMISTIC WRITE PIPELINE MODULE (web/js/ui/mutate.ts)
// =======================================================================================
//
// The optimistic write pipeline — every mutation in this app goes through `mutate`. This
// module IS the single authoritative server write path (CLAUDE.md) — every caller goes
// through `window.mutate`.
//
// Key Principles:
// - OPTIMISTIC, THEN RECONCILED: `fn` applies SYNCHRONOUSLY to the in-memory client data —
//   cells change at the moment of the click, with no network round-trip in the critical
//   path. `persist` then writes authoritatively in the background: re-reads fresh, merges
//   the local delta against anyone else's concurrent change (a foreign booking never gets
//   silently overwritten), and writes. On error/collision, the actual server state wins and
//   the view is reconciled via `refreshNow`.
// - NO UNOBSERVED STATE: there is deliberately no "saving" flag anywhere in this pipeline —
//   a full-codebase search confirmed nothing ever reads such a flag to gate behavior on it
//   (e.g. pausing auto-refresh), so there's nothing to conserve by adding one back.
//
// =======================================================================================

import type { BookingData } from '../../../shared/types.ts';
import type { CellUndo, Conflict } from '../core/bookings.ts';
import { apiPost, readFile } from '../net/api.ts';
import { patchCells } from './cell-patch.ts';
import { store } from '../store-instance.ts';
import { toast } from './toast.ts';
import { showCollisionBanner } from './collision-banner.ts';
import { dbg, errorMessage } from './debug-panel.ts';
import { invalidateMachineLookupCache } from './machine-lookup.ts';

export interface MutateResult {
  abort?: boolean;
  conflicts?: Conflict[];
  count?: number;
  deletedCount?: number;
  undo?: CellUndo[];
}

/** Stamps `#lastRef` with the current time — the toolbar's small "last synced" indicator. */
export function stampRef(): void {
  const el = document.getElementById('lastRef');
  if (el)
    el.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Re-fetches and reconciles the view to the server's authoritative state. */
export async function refreshNow(silent: boolean): Promise<void> {
  try {
    store.set({ data: await readFile() });
    stampRef();
    if (!silent) toast('Aktualisiert ✓');
  } catch (error) {
    const el = document.getElementById('lastRef');
    if (el) el.textContent = '⚠ offline';
    if (!silent) toast('Aktualisieren fehlgeschlagen: ' + errorMessage(error), undefined, 6000);
  }
}

/** Whether `result` came from a machine-structural reducer (saveMachine/deleteMachine/
 *  moveMachine, core/machines.ts) rather than a booking-cell one — those never return an
 *  `undo` array, every booking-cell reducer always does (`buildMutateRequestBody` below makes
 *  the same distinction, inline, for the request-shape decision). Split out purely so `mutate`
 *  itself stays under the complexity budget. */
function isStructuralChange(result: MutateResult | null): boolean {
  return !(result && Array.isArray(result.undo));
}

interface MutateApiResponse {
  error?: string;
  rev?: number;
  conflicts?: Conflict[];
}

/** The `/api/mutate` request body: a cell delta (compare-and-set per cell) when
 *  `result.undo` is an array, else the full machine/group list (a structural change).
 *  Split out from `persist` only to stay under the complexity budget. */
function buildMutateRequestBody(
  logEntry: { action: string },
  result: MutateResult | null,
): Record<string, unknown> {
  const common = { log: logEntry.action, user: store.get('user') || '?' };
  if (result && Array.isArray(result.undo)) {
    const cells = result.undo.map((entry) => ({
      machineId: entry.machineId,
      day: entry.date,
      prev: entry.prev || null,
      val: (store.get('data')!.bookings[entry.machineId] || {})[entry.date] || null,
    }));
    return { cells, ...common };
  }
  return { machines: store.get('data')!.machines, groups: store.get('data')!.groups, ...common };
}

/** Handle the parsed `/api/mutate` response: adopt the new revision, and either flag a
 *  partial conflict (banner + reconcile) or log the success. Split out from `persist` only to
 *  stay under the complexity budget. */
async function handleMutateResponse(
  logEntry: { action: string },
  out: MutateApiResponse,
): Promise<void> {
  if (typeof out.rev === 'number') store.get('data')!.revision = out.rev;
  if (out.conflicts && out.conflicts.length) {
    showCollisionBanner();
    dbg('err', 'Teilkonflikt: ' + out.conflicts.length + ' Termin(e) waren bereits belegt');
    await refreshNow(true); // reconcile the view to the authoritative state
  } else {
    dbg('write', `${logEntry.action} ✓ (Rev ${out.rev})`);
  }
}

/** Writes `result` (from `fn`'s optimistic apply) to the server in the background. */
async function persist(logEntry: { action: string }, result: MutateResult | null): Promise<void> {
  try {
    const out = (await apiPost(
      '/api/mutate',
      buildMutateRequestBody(logEntry, result),
    )) as MutateApiResponse;
    if (!out || out.error) throw new Error((out && out.error) || 'Serverfehler');
    await handleMutateResponse(logEntry, out);
  } catch (error) {
    dbg('err', 'Speichern fehlgeschlagen: ' + errorMessage(error));
    toast(
      '⚠️ Speichern fehlgeschlagen (' + errorMessage(error) + ') – hole aktuellen Stand…',
      undefined,
      6000,
    );
    try {
      await refreshNow(true);
    } catch {
      /* refreshNow already handles its own failure (offline indicator + toast) */
    }
  }
}

/**
 * Applies `fn` to the in-memory client data, logs the action, repaints (patched or full),
 * and persists to the server in the background — returns `fn`'s own result immediately,
 * without waiting for `persist` to finish. Returns `null` in read-only mode instead (a
 * toast explains why, and `fn` never runs at all).
 */
export async function mutate(
  fn: (fresh: BookingData) => unknown,
  logAction: string,
): Promise<MutateResult | null> {
  if (store.get('readOnly')) {
    toast('Nur-Lese-Modus – Buchen nicht möglich.');
    return null;
  }
  const result = fn(store.get('data')!) as MutateResult | null;
  if (result && result.abort) return result; // conflict/cancel: S.data unchanged

  // Machine CRUD mutates `data.machines` IN PLACE (splice/swap) rather than replacing the
  // array — machById's reference-equality cache can't see that on its own.
  if (isStructuralChange(result)) invalidateMachineLookupCache();

  const logEntry = {
    ts: new Date().toISOString(),
    user: store.get('user') || '?',
    action: logAction,
  };
  const data = store.get('data')!;
  data.log = data.log || [];
  data.log.unshift(logEntry);
  if (data.log.length > 500) data.log.length = 500;

  if (result && result.undo && result.undo.length && result.undo.length <= 500) {
    patchCells(result.undo);
  } else {
    store.notify();
  }
  void persist(logEntry, result); // file work in the background
  return result;
}
