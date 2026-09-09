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
  error?: string;
}

export interface MutateOptions {
  /** Wait for the backend response and report failure to the caller instead of closing early. */
  waitForServer?: boolean;
  /** Ask the backend to roll back the complete cell batch when any cell conflicts. */
  atomic?: boolean;
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
  options: MutateOptions = {},
): Record<string, unknown> {
  const common = { log: logEntry.action, user: store.get('user') || '?' };
  if (result && Array.isArray(result.undo)) {
    const cells = result.undo.map((entry) => ({
      machineId: entry.machineId,
      day: entry.date,
      prev: entry.prev || null,
      val: (store.get('data')!.bookings[entry.machineId] || {})[entry.date] || null,
    }));
    return { cells, ...(options.atomic ? { atomic: true } : {}), ...common };
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

/** Restores the pre-edit cells when an all-or-nothing mutation was not accepted by the server. */
function rollbackOptimistic(result: MutateResult | null): void {
  if (!result?.undo) return;
  for (const entry of [...result.undo].reverse()) {
    const machineBookings = (store.get('data')!.bookings[entry.machineId] ||= {});
    if (entry.prev) machineBookings[entry.date] = { ...entry.prev };
    else delete machineBookings[entry.date];
    if (!Object.keys(machineBookings).length) delete store.get('data')!.bookings[entry.machineId];
  }
  store.notify();
}

/**
 * Persists an applied mutation to the server in the background.
 */
async function persist(
  logEntry: { action: string },
  result: MutateResult | null,
  options: MutateOptions,
): Promise<boolean> {
  try {
    const out = (await apiPost(
      '/api/mutate',
      buildMutateRequestBody(logEntry, result, options),
    )) as MutateApiResponse;
    if (!out || out.error) throw new Error((out && out.error) || 'Serverfehler');
    if (options.atomic && out.conflicts?.length) rollbackOptimistic(result);
    await handleMutateResponse(logEntry, out);
    return !out.conflicts?.length;
  } catch (error) {
    if (options.atomic) rollbackOptimistic(result);
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
    return false;
  }
}

async function settlePersistence(
  persistence: Promise<boolean>,
  result: MutateResult | null,
  waitForServer: boolean,
): Promise<MutateResult | null> {
  if (!waitForServer) {
    void persistence;
    return result;
  }
  return (await persistence) ? result : { ...result, abort: true };
}

function mutationBlockedByReadOnly(): boolean {
  if (!store.get('readOnly')) return false;
  toast('Nur-Lese-Modus – Buchen nicht möglich.');
  return true;
}

function paintMutation(result: MutateResult | null): void {
  const undo = result?.undo;
  if (undo?.length && undo.length <= 500) patchCells(undo);
  else store.notify();
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
  options: MutateOptions = {},
): Promise<MutateResult | null> {
  if (mutationBlockedByReadOnly()) return null;
  const result = fn(store.get('data')!) as MutateResult | null;
  if (result?.abort) return result;

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

  paintMutation(result);
  return settlePersistence(persist(logEntry, result, options), result, !!options.waitForServer);
}
