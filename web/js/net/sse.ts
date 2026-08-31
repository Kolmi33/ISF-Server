// Pure logic for the live Server-Sent-Events connection (Phase 3.3).
//
// The EventSource lifecycle and all DOM/toast side effects live in `ui/live-connection.ts`'s
// `connectSSE`/`applyPresence` adapter (too coupled to move cleanly into this module — E3);
// this module holds the pieces that are pure functions of their input, so they are
// unit-tested to 100% (E4/E7). Faithful ports of the handlers' inner logic — behavior
// unchanged (E1).
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
 * `setPresence` DOM write live in `ui/live-connection.ts` (Phase 7 slice B10d).
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

/** One day, abbreviated `DD.MM.` — falls back to the raw string when it isn't a plain ISO
 *  date (`YYYY-MM-DD`). Faithful port of legacy `fmtDM`. */
export function formatDayMonth(isoDate: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
    ? `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.`
    : isoDate;
}

/** A colleague's log entry, as carried by an `update` SSE event. */
export interface RemoteLogEntry {
  user: string;
  action: string;
}

/**
 * A German one-line summary of a colleague's log action, for the remote-change toast queue.
 * Recognizes booking/delete/area-delete/machine actions by pattern; anything else falls back
 * to `"<user>: <action>"`. Faithful port of legacy `remoteMsg`.
 */
export function remoteMessage(entry: RemoteLogEntry): string {
  const { user, action } = entry;
  const bookingMatch = action.match(
    /^Buchung:\s*(.+?),\s*(\d+)\s*Maschine.*?,\s*(\S+)\s*bis\s*(\S+)/,
  );
  if (bookingMatch) {
    const [, person, count, from, to] = bookingMatch;
    return `${person} hat ${count} Maschine${count === '1' ? '' : 'n'} gebucht (${formatDayMonth(from!)}–${formatDayMonth(to!)})`;
  }
  const deleteMatch = action.match(/^Gelöscht:\s*(.+?)\s*auf\s*(.+?),\s*(\d+)/);
  if (deleteMatch) {
    const [, name, machine, days] = deleteMatch;
    return `${user} hat ${days} Tag(e) von „${name}" auf ${machine} gelöscht`;
  }
  if (action.startsWith('Bereich gelöscht')) return `${user} hat einen Buchungsbereich gelöscht`;
  if (action.startsWith('Maschine')) return `${user}: ${action}`;
  return `${user}: ${action}`;
}
