// =======================================================================================
// OPTIMISTIC WRITE PIPELINE MODULE (web/js/ui/mutate.ts)
// =======================================================================================
//
// The authoritative write pipeline coordinating client mutations with server persistence.
//
// Optimistic UI Architecture:
// 1. Synchronous Local Mutation: Mutates client state (`store.state.data`) in place immediately,
//    giving users instant visual feedback with zero network latency.
// 2. Local Paint: Performs localized DOM cell patching (`patchCells`) or triggers a full grid repaint.
// 3. Background Persistence: Sends compare-and-set cell deltas (or full structural machine lists)
//    to `/api/mutate`.
// 4. Server Reconciliation: If a race condition or conflict occurred, the server state wins and
//    the client automatically resynchronizes via `refreshNow`.
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

/** Result returned by mutate callbacks. */
export interface MutateResult {
  abort?: boolean;
  conflicts?: Conflict[];
  count?: number;
  deletedCount?: number;
  undo?: CellUndo[];
}

/** Updates the toolbar's "last synced" time indicator. */
export function stampRef(): void {
  const el = document.getElementById('lastRef');
  if (el)
    el.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Re-fetches authoritative state from `/api/state` and reconciles the active view.
 */
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

/**
 * Checks whether the mutation modified machine list structure (CRUD/reorder) rather than booking cells.
 */
function isStructuralChange(result: MutateResult | null): boolean {
  return !(result && Array.isArray(result.undo));
}

interface MutateApiResponse {
  error?: string;
  rev?: number;
  conflicts?: Conflict[];
}

/**
 * Formats the `/api/mutate` HTTP request body:
 * - Booking cell mutations: Generates a list of cell deltas with `prev` and `val` for compare-and-set.
 * - Machine management mutations: Sends the full `machines` and `groups` arrays.
 */
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

/**
 * Processes server response from `/api/mutate`, updating the local revision number and triggering
 * reconciliation if concurrent booking collisions occurred.
 */
async function handleMutateResponse(
  logEntry: { action: string },
  out: MutateApiResponse,
): Promise<void> {
  if (typeof out.rev === 'number') store.get('data')!.revision = out.rev;
  if (out.conflicts && out.conflicts.length) {
    showCollisionBanner();
    dbg('err', 'Teilkonflikt: ' + out.conflicts.length + ' Termin(e) waren bereits belegt');
    await refreshNow(true);
  } else {
    dbg('write', `${logEntry.action} ✓ (Rev ${out.rev})`);
  }
}

/**
 * Persists an applied mutation to the server in the background.
 */
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
      /* refreshNow handles its own errors */
    }
  }
}

/**
 * Authoritative mutation pipeline:
 * 1. Executes reducer `fn` on local data synchronously.
 * 2. Invalidate caches if machine structure changed.
 * 3. Records action in the in-memory audit log.
 * 4. Patches DOM cells or notifies store listeners.
 * 5. Dispatches background persistence to `/api/mutate`.
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
  if (result && result.abort) return result;

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
  void persist(logEntry, result);
  return result;
}
