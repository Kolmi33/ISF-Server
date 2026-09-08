// =======================================================================================
// API BOOKINGS WRITE MODULE (server/api-bookings-write.ts)
// =======================================================================================
//
// PUT/DELETE /api/v1/machines/:id/bookings/:date (single-cell writes with an optional
// `If-Match` CAS precondition), POST /api/v1/bookings/batch, POST /api/v1/bookings/batch-delete.
//
// Key Principles:
// - ONE AUTHORITATIVE WRITE PATH: every write here is one `applyMutate` cell-delta call — the
//   exact path the live grid's own booking clicks use — so the blocked-day check, the
//   never-overwrite-a-foreign-booking rule, weekend bridging, the SSE broadcast, and the
//   activity log all come for free. This module adds only the REST-specific pieces
//   `mutate.ts` has no reason to know about: the `If-Match` precondition, and mapping a
//   batch result onto 200/207/400.
//
// =======================================================================================

import type { Db } from './db.js';
import { bookingOut } from './model.js';
import { bookingEtag } from './api-bookings.js';
import { applyMutate, DAY_RE, type Broadcast } from './mutate.js';
import { pickString, logOrDefault } from './api-write-helpers.js';
import type { BookingRow, CellDelta } from './types.js';
import type { ApiResponse, ApiRequestHeaders } from './api-router.js';
import { apiSuccess, apiError } from './api-response.js';

/** Whether a machine with this id currently exists — the 404 guard every single-cell handler runs first. */
function machineExists(db: Db, machineId: string): boolean {
  return !!db.prepare('SELECT 1 FROM machines WHERE id=?').get(machineId);
}

/** The current booking row at one cell, or `undefined` when it's free — the "current state" both
 *  `checkIfMatch`'s precondition and the post-write response read from. */
function currentBookingRow(db: Db, machineId: string, date: string): BookingRow | undefined {
  return db.prepare('SELECT * FROM bookings WHERE mid=? AND day=?').get(machineId, date) as
    BookingRow | undefined;
}

/** The `If-Match` header value, or undefined if the client sent none (an unconditional write) —
 *  Node normalizes a repeated header to an array; a REST client only ever sends one, so the
 *  first value is the whole answer. */
function ifMatchHeader(headers: ApiRequestHeaders): string | undefined {
  const raw = headers['if-match'];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** 412 when an `If-Match` was given and doesn't equal the cell's current tag; `null` (proceed)
 *  when it was omitted (unconditional) or matches. Shared by the PUT and DELETE single-cell
 *  writes below — their only difference is what "the current state" means to fetch first. */
function checkIfMatch(
  existing: BookingRow | undefined,
  headers: ApiRequestHeaders,
): ApiResponse | null {
  const ifMatch = ifMatchHeader(headers);
  if (ifMatch !== undefined && ifMatch !== bookingEtag(existing)) {
    return apiError(412, 'PRECONDITION_FAILED', 'Die Buchung wurde zwischenzeitlich geändert.');
  }
  return null;
}

/** Run one cell-delta write through `applyMutate`, mapping its error/conflict outcomes onto the
 *  REST status codes every single-cell write in this module shares. `null` means it succeeded. */
function applySingleCellWrite(
  db: Db,
  cell: CellDelta,
  who: string | undefined,
  log: string,
  broadcast: Broadcast,
): ApiResponse | null {
  const result = applyMutate(db, { cells: [cell], user: who, log }, broadcast);
  if (result.error) return apiError(400, 'VALIDATION', result.error);
  if (result.conflicts?.length) return apiError(409, 'CONFLICT', result.conflicts[0]!.by);
  return null;
}

interface BookingWriteBody {
  name?: unknown;
  note?: unknown;
  groupId?: unknown;
  groupTitle?: unknown;
  user?: unknown;
  log?: unknown;
}

/** Narrows an untrusted parsed-JSON body to `BookingWriteBody`'s shape (same pattern as
 *  `api-machines-write.ts`'s `asBody`: a non-object body becomes an empty object). */
function asBody(body: unknown): BookingWriteBody {
  return (body && typeof body === 'object' ? body : {}) as BookingWriteBody;
}

/**
 * `PUT /api/v1/machines/:id/bookings/:date`. Body: `{name, note?, groupId?, groupTitle?}`
 * (+ optional `user`/`log`). Omitting `groupId` preserves an existing cell's group or creates a
 * new one for a free cell. An
 * `If-Match` header, when given, must equal the cell's current {@link bookingEtag} or the write
 * is refused with 412 before it's even attempted; omitted entirely, the PUT is unconditional —
 * `applyMutate`'s own cell-delta path still enforces its own rules (blocked days, "never
 * overwrite a foreign booking" by name) either way, so `If-Match` is an extra precondition for
 * REST clients that want real HTTP conditional semantics, not the only one.
 */
export function putBooking(
  db: Db,
  machineId: string,
  date: string,
  body: unknown,
  headers: ApiRequestHeaders,
  broadcast: Broadcast,
): ApiResponse {
  if (!machineExists(db, machineId)) {
    return apiError(404, 'NOT_FOUND', `Maschine nicht gefunden: ${machineId}`);
  }
  if (!DAY_RE.test(date)) return apiError(400, 'VALIDATION', 'Ungültiges Datum (YYYY-MM-DD).');
  const input = asBody(body);
  if (typeof input.name !== 'string' || !input.name.trim()) {
    return apiError(400, 'VALIDATION', 'Name fehlt.');
  }

  const existing = currentBookingRow(db, machineId, date);
  const preconditionFailure = checkIfMatch(existing, headers);
  if (preconditionFailure) return preconditionFailure;

  const cell: CellDelta = {
    machineId,
    day: date,
    val: {
      name: input.name,
      note: pickString(input.note),
      gid: pickString(input.groupId),
      gtitle: pickString(input.groupTitle),
    },
  };
  const writeFailure = applySingleCellWrite(
    db,
    cell,
    pickString(input.user),
    logOrDefault(input.log, `Buchung: ${input.name} (REST)`),
    broadcast,
  );
  if (writeFailure) return writeFailure;

  const written = currentBookingRow(db, machineId, date)!;
  return {
    ...apiSuccess({ date, ...bookingOut(written) }, existing ? 200 : 201),
    headers: { ETag: bookingEtag(written) },
  };
}

/**
 * `DELETE /api/v1/machines/:id/bookings/:date`. Same `If-Match` precondition as {@link
 * putBooking}; unconditional (deletes whoever is there) when the header is absent. 404 for an
 * unknown machine or an already-free cell (nothing to delete); 204 on success.
 */
export function deleteBooking(
  db: Db,
  machineId: string,
  date: string,
  headers: ApiRequestHeaders,
  broadcast: Broadcast,
): ApiResponse {
  if (!machineExists(db, machineId)) {
    return apiError(404, 'NOT_FOUND', `Maschine nicht gefunden: ${machineId}`);
  }
  if (!DAY_RE.test(date)) return apiError(400, 'VALIDATION', 'Ungültiges Datum (YYYY-MM-DD).');
  const existing = currentBookingRow(db, machineId, date);
  if (!existing) return apiError(404, 'NOT_FOUND', `Keine Buchung am ${date}.`);

  const preconditionFailure = checkIfMatch(existing, headers);
  if (preconditionFailure) return preconditionFailure;

  applyMutate(
    db,
    { cells: [{ machineId, day: date, val: null }], log: 'Buchung gelöscht (REST)' },
    broadcast,
  );
  return apiSuccess(null, 204);
}

interface BatchCellInput {
  machineId?: unknown;
  date?: unknown;
  name?: unknown;
  note?: unknown;
}
interface BatchBody {
  cells?: unknown;
  groupId?: unknown;
  groupTitle?: unknown;
  user?: unknown;
  log?: unknown;
}

/** Narrows an untrusted parsed-JSON body to `BatchBody`'s shape (same pattern as `asBody` above). */
function asBatchBody(body: unknown): BatchBody {
  return (body && typeof body === 'object' ? body : {}) as BatchBody;
}

/** Validate + shape a batch's raw cell list into `CellDelta`s for a booking write, or the
 *  `ApiResponse` to fail with — pulled out of {@link batchBook} purely to keep its own
 *  complexity down; the validation itself is unchanged. */
function parseBookCells(
  rawCells: unknown[],
  groupId?: string,
  groupTitle?: string,
): CellDelta[] | ApiResponse {
  const cells: CellDelta[] = [];
  for (const raw of rawCells as BatchCellInput[]) {
    if (
      typeof raw.machineId !== 'string' ||
      typeof raw.date !== 'string' ||
      typeof raw.name !== 'string' ||
      !raw.name.trim()
    ) {
      return apiError(400, 'VALIDATION', 'Jede Zelle braucht machineId, date und name.');
    }
    cells.push({
      machineId: raw.machineId,
      day: raw.date,
      val: { name: raw.name, note: pickString(raw.note), gid: groupId, gtitle: groupTitle },
    });
  }
  return cells;
}

/**
 * `POST /api/v1/bookings/batch`. Body:
 * `{cells: [{machineId, date, name, note?}], groupId?, groupTitle?, user?, log?}`.
 * All cells share one generated group when `groupId` is omitted, or join the supplied group.
 * — one `applyMutate` call for the whole batch (one transaction, one revision bump, one
 * broadcast — not N of each). 200 when every cell applied cleanly, 207 Multi-Status when some
 * conflicted, 400 when the request itself is malformed (an unknown machine id counts as
 * malformed here too — `applyMutate`'s cell-delta path validates the whole batch before writing
 * any of it, the same all-or-nothing behavior `/api/mutate` itself already has).
 */
export function batchBook(db: Db, body: unknown, broadcast: Broadcast): ApiResponse {
  const input = asBatchBody(body);
  if (!Array.isArray(input.cells) || input.cells.length === 0) {
    return apiError(400, 'VALIDATION', 'cells (nicht-leeres Array) ist erforderlich.');
  }
  const cells = parseBookCells(
    input.cells,
    pickString(input.groupId),
    pickString(input.groupTitle),
  );
  if (!Array.isArray(cells)) return cells; // the ApiResponse validation error

  const result = applyMutate(
    db,
    {
      cells,
      user: pickString(input.user),
      log: logOrDefault(input.log, `Buchung: ${cells.length} Zellen (REST)`),
    },
    broadcast,
  );
  if (result.error) return apiError(400, 'VALIDATION', result.error);
  const status = result.conflicts?.length ? 207 : 200;
  return apiSuccess({ applied: result.applied, conflicts: result.conflicts ?? [] }, status);
}

/** Validate + shape a batch's raw cell list into deletion `CellDelta`s, or the `ApiResponse` to
 *  fail with — the delete counterpart of {@link parseBookCells} (no `name`/`note` to check). */
function parseDeleteCells(rawCells: unknown[]): CellDelta[] | ApiResponse {
  const cells: CellDelta[] = [];
  for (const raw of rawCells as BatchCellInput[]) {
    if (typeof raw.machineId !== 'string' || typeof raw.date !== 'string') {
      return apiError(400, 'VALIDATION', 'Jede Zelle braucht machineId und date.');
    }
    cells.push({ machineId: raw.machineId, day: raw.date, val: null });
  }
  return cells;
}

/**
 * `POST /api/v1/bookings/batch-delete`. Body: `{cells: [{machineId, date}], user?, log?}` —
 * unconditional deletes (no per-cell `If-Match`; use the single-cell DELETE for that), so there
 * are no conflicts to report, only how many of the requested cells actually had something to
 * delete (`applied`).
 */
export function batchDelete(db: Db, body: unknown, broadcast: Broadcast): ApiResponse {
  const input = asBatchBody(body);
  if (!Array.isArray(input.cells) || input.cells.length === 0) {
    return apiError(400, 'VALIDATION', 'cells (nicht-leeres Array) ist erforderlich.');
  }
  const cells = parseDeleteCells(input.cells);
  if (!Array.isArray(cells)) return cells; // the ApiResponse validation error

  const result = applyMutate(
    db,
    {
      cells,
      user: pickString(input.user),
      log: logOrDefault(input.log, `Buchung(en) gelöscht: ${cells.length} Zellen (REST)`),
    },
    broadcast,
  );
  if (result.error) return apiError(400, 'VALIDATION', result.error);
  return apiSuccess({ applied: result.applied });
}
