// =======================================================================================
// SSE MESSAGE LOGIC (web/js/net/sse.ts)
// =======================================================================================
//
// Pure logic for the live Server-Sent-Events connection's message handling.
// This module provides:
// 1. `applyUpdate`: applies an `update` event's changes onto the in-memory bookings.
// 2. `presenceInfo`: formats the live "who's active" presence list for display.
// 3. `remoteMessage`/`formatDayMonth`: turns a colleague's raw log action into a one-line
//    German toast notification.
//
// Key Principles:
// - PURE FUNCTIONS OF THEIR INPUT: the EventSource lifecycle and all DOM/toast side effects
//   live in `ui/live-connection.ts`'s `connectSSE`/`applyPresence` adapter (too coupled to
//   move cleanly into this module); this module holds only the pieces that are pure
//   functions of their input, so they're unit-tested to 100% coverage without a live
//   connection.
//
// =======================================================================================

import type { Booking, Bookings } from '../../../shared/types.ts';

/** One booking change carried by an `update` event. */
export interface SseChange {
  machineId: string;
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
  machineId: string;
  date: string;
}

export interface UpdateResult {
  /** The new revision if the event carried a numeric one, else `null` (leave unchanged). */
  rev: number | null;
  /** The cells that changed, for the caller to repaint. */
  patch: CellRef[];
}

/**
 * Applies an `update` event's changes to `bookings` in place, returning the cells to
 * repaint plus the revision to adopt.
 *
 * How it works, per changed cell: a truthy `val` sets the cell to that new booking; a
 * falsy `val` (the server's way of saying "this cell is now empty") deletes it. Either way
 * the cell's address is added to the repaint list, so the caller always knows exactly
 * which cells to redraw instead of repainting the whole grid.
 */
export function applyUpdate(event: SseUpdate, bookings: Bookings): UpdateResult {
  const patch: CellRef[] = [];
  for (const change of event.changes || []) {
    const machineBookings = (bookings[change.machineId] = bookings[change.machineId] || {});
    if (change.val) machineBookings[change.day] = change.val;
    else delete machineBookings[change.day];
    patch.push({ machineId: change.machineId, date: change.day });
  }
  return { rev: typeof event.rev === 'number' ? event.rev : null, patch };
}

/**
 * Turns a raw presence user list into the display fields (count badge + tooltip label).
 * Falsy entries (a client that hasn't set a name yet) are filtered out first, so they
 * don't inflate the count or show up as a blank name in the tooltip. The `presenceData`
 * timestamp map and the actual DOM write live in `ui/live-connection.ts`.
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

/** Abbreviates one ISO day as `DD.MM.` — falls back to the raw string when it isn't a plain
 *  ISO date (`YYYY-MM-DD`), so a malformed date degrades gracefully instead of throwing. */
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
 * Builds a German one-line summary of a colleague's log action, for the remote-change
 * toast queue.
 *
 * How it works: tries each recognized action pattern in turn — a multi-cell booking (with a
 * count and date range), a same-name delete, a whole-area delete, a machine action — and
 * returns a friendlier, person-centric phrasing for whichever one matches. Anything that
 * doesn't match any pattern falls back to the generic `"<user>: <action>"`, so an
 * unrecognized (or future) action type still shows something rather than nothing.
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
