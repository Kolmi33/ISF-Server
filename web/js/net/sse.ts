// Pure logic for the live Server-Sent-Events connection (Phase 3.3).
//
// The EventSource lifecycle and all DOM/toast side effects stay in the legacy
// `connectSSE`/`applyPresence` adapter (too coupled to move cleanly — E3); this module
// holds the pieces that are pure functions of their input, so they are unit-tested to
// 100% (E4/E7). Faithful ports of the handlers' inner logic — behavior unchanged (E1).
//
// The store's `notify` path (SSE → store.set → notify) is deferred to Phase 4, when
// `render` actually subscribes (D2/Q2b); wiring it in 3.3 would be a no-op needing an
// injection harness this adapter doesn't warrant (E8). See ARCHITECTURE §14.

import type { Booking, Bookings } from '../../../shared/types.ts';

/** One booking change carried by an `update` event. */
export interface SseChange {
  mid: string;
  day: string;
  /** New booking, or falsy to clear the cell. */
  val?: Booking | null;
}

/** The payload of an `update` event. */
export interface SseUpdate {
  rev?: number;
  changes?: SseChange[];
  by?: string;
  log?: string;
}

/** A repaint instruction for the legacy `patchCells` adapter. */
export interface CellRef {
  mid: string;
  date: string;
}

export interface UpdateResult {
  /** The new revision if the event carried a numeric one, else `null` (leave unchanged). */
  rev: number | null;
  /** The cells that changed, for the caller to repaint. */
  patch: CellRef[];
}

/**
 * Apply an `update` event's changes to `bookings` in place and return the cells to
 * repaint plus the revision to adopt. Faithful port of the legacy `update` handler's
 * inner loop (a truthy `val` sets the cell, a falsy one deletes it).
 */
export function applyUpdate(event: SseUpdate, bookings: Bookings): UpdateResult {
  const patch: CellRef[] = [];
  for (const change of event.changes || []) {
    const machineBookings = (bookings[change.mid] = bookings[change.mid] || {});
    if (change.val) machineBookings[change.day] = change.val;
    else delete machineBookings[change.day];
    patch.push({ mid: change.mid, date: change.day });
  }
  return { rev: typeof event.rev === 'number' ? event.rev : null, patch };
}

/**
 * Turn a raw presence user list into the display fields (count badge + tooltip label).
 * Faithful port of `applyPresence`'s formatting; the `presenceData` timestamp map and the
 * `setPres` DOM write stay in the legacy adapter.
 */
export function presenceInfo(users: readonly (string | null | undefined)[] | undefined): {
  list: string[];
  count: string;
  label: string;
} {
  const list = (users || []).filter(Boolean) as string[];
  return {
    list,
    count: String(list.length || '–'),
    label: list.length ? 'Gerade aktiv: ' + list.join(', ') : 'Niemand aktiv',
  };
}

/**
 * Whether a change attributed to `by` came from someone other than `me` (case-insensitive,
 * and only when `by` is present). Used to gate the "remote change" notices.
 */
export function isForeign(by: string | undefined, me: string): boolean {
  return !!by && String(by).toLowerCase() !== me.toLowerCase();
}
