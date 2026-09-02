// api-bookings.ts — Phase 9c: GET /api/v1/machines/:id/bookings[/:date], GET
// /api/v1/bookings?groupId=. Read-only, direct SQL (the `bookings` table is already indexed on
// `day` and `gid` — no need to route this through the client-side pure `core/bookings.ts`
// query logic, which operates on an in-memory `Bookings` map the server never builds as such).

import type { Db } from './db.js';
import { bookingOut } from './model.js';
import type { BookingOut, BookingRow } from './types.js';
import type { ApiResponse } from './api-router.js';
import { apiSuccess, apiError } from './api-response.js';
import { DAY_RE } from './mutate.js';

/** A booking as emitted by the machine-bookings endpoints, with its date alongside the usual
 *  wire fields (the date is the resource's own address there, not implied by a parent key). */
export interface BookingEntryOut extends BookingOut {
  date: string;
}

/** A booking as emitted by the group endpoint, additionally naming which machine it's on
 *  (a group can span several). */
export interface GroupedBookingOut extends BookingEntryOut {
  machineId: string;
}

function machineExists(db: Db, machineId: string): boolean {
  return !!db.prepare('SELECT 1 FROM machines WHERE id=?').get(machineId);
}

/** A single booking cell's opaque CAS token: `"empty"` when nothing is booked there, else
 *  derived from the booking's own name+ts (either changing invalidates a previously-fetched
 *  tag). Exported for `api-bookings-write.ts`'s `If-Match` precondition (Phase 9f) — compared
 *  byte-for-byte against a client-supplied header, never parsed or generated any other way. */
export function bookingEtag(row: Pick<BookingRow, 'name' | 'ts'> | undefined): string {
  return row ? `"${row.name}:${row.ts || ''}"` : '"empty"';
}

/**
 * `GET /api/v1/machines/:id/bookings?from=&to=`. Both bounds are required — an unbounded "every
 * booking ever" fetch isn't offered — and must be valid ISO days with `from <= to`. 404s when
 * the machine itself doesn't exist; an empty array (not an error) when the range has no bookings.
 */
export function listMachineBookings(db: Db, machineId: string, url: URL): ApiResponse {
  if (!machineExists(db, machineId)) {
    return apiError(404, 'NOT_FOUND', `Maschine nicht gefunden: ${machineId}`);
  }
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) {
    return apiError(400, 'VALIDATION', 'from und to sind erforderlich (YYYY-MM-DD).');
  }
  if (from > to) return apiError(400, 'VALIDATION', 'from darf nicht nach to liegen.');

  const rows = db
    .prepare('SELECT * FROM bookings WHERE mid=? AND day>=? AND day<=? ORDER BY day')
    .all(machineId, from, to) as unknown as BookingRow[];
  const entries: BookingEntryOut[] = rows.map((row) => ({ date: row.day, ...bookingOut(row) }));
  return apiSuccess(entries);
}

/**
 * `GET /api/v1/machines/:id/bookings/:date`. 404s when the machine doesn't exist, 400s on a
 * malformed date, 404s when the cell is free (there is no booking resource at that address yet).
 */
export function getMachineBooking(db: Db, machineId: string, date: string): ApiResponse {
  if (!machineExists(db, machineId)) {
    return apiError(404, 'NOT_FOUND', `Maschine nicht gefunden: ${machineId}`);
  }
  if (!DAY_RE.test(date)) return apiError(400, 'VALIDATION', 'Ungültiges Datum (YYYY-MM-DD).');

  const row = db.prepare('SELECT * FROM bookings WHERE mid=? AND day=?').get(machineId, date) as
    BookingRow | undefined;
  if (!row) return apiError(404, 'NOT_FOUND', `Keine Buchung am ${date}.`);
  return {
    ...apiSuccess({ date: row.day, ...bookingOut(row) }),
    headers: { ETag: bookingEtag(row) },
  };
}

/**
 * `GET /api/v1/bookings?groupId=`. `groupId` is required (400 `VALIDATION` without it) — this
 * isn't a general booking search, only the one existing use case (find every cell in a group).
 * An empty array, not an error, when nothing matches.
 */
export function listBookingsByGroup(db: Db, url: URL): ApiResponse {
  const groupId = url.searchParams.get('groupId');
  if (!groupId) return apiError(400, 'VALIDATION', 'groupId ist erforderlich.');

  const rows = db
    .prepare('SELECT * FROM bookings WHERE gid=? ORDER BY mid, day')
    .all(groupId) as unknown as BookingRow[];
  const entries: GroupedBookingOut[] = rows.map((row) => ({
    machineId: row.mid,
    date: row.day,
    ...bookingOut(row),
  }));
  return apiSuccess(entries);
}
