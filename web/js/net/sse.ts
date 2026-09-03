// =======================================================================================
// SSE EVENT & PRESENCE PARSER (web/js/net/sse.ts)
// =======================================================================================
//
// Pure processing logic for Server-Sent Events (SSE) messages from `/api/stream`.
//
// Responsibilities:
// 1. Live Cell Updates: Transforms `update` event payloads into targeted in-memory booking mutations.
// 2. Active User Presence: Formats the active users list for toolbar badges and presence tooltips.
// 3. Remote Action Notifications: Formats colleague activity log messages into readable German toasts.
//
// =======================================================================================

import type { Booking, Bookings } from '../../../shared/types.ts';

/** A single cell modification carried by an SSE `update` event. */
export interface SseChange {
  machineId: string;
  day: string;
  /** New booking payload, or null/undefined if the cell was deleted. */
  val?: Booking | null;
}

/** Payload structure of an SSE `update` event broadcast by the server. */
export interface SseUpdate {
  rev?: number;
  changes?: SseChange[];
  by?: string;
  log?: string;
}

/** Cell coordinate instruction for targeted DOM cell repainting. */
export interface CellRef {
  machineId: string;
  date: string;
}

/** Result returned by applyUpdate containing the new revision and list of modified cells. */
export interface UpdateResult {
  rev: number | null;
  patch: CellRef[];
}

/**
 * Applies incoming SSE booking modifications directly to the client's in-memory bookings table.
 * Returns the exact set of changed cell coordinates to allow localized DOM repainting without
 * re-rendering the entire table.
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
 * Formats a list of active online user names for display in the UI toolbar chip and tooltip.
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
 * Checks if a change author is different from the currently logged-in user.
 */
export function isForeign(by: string | undefined, me: string): boolean {
  return !!by && String(by).toLowerCase() !== me.toLowerCase();
}

/**
 * Formats an ISO date string ('YYYY-MM-DD') as 'DD.MM.'.
 */
export function formatDayMonth(isoDate: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
    ? `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.`
    : isoDate;
}

/** A log entry structure received over SSE. */
export interface RemoteLogEntry {
  user: string;
  action: string;
}

/**
 * Generates a human-friendly German notification message describing an action performed by a colleague.
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
