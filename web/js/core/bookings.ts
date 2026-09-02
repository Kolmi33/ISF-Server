// The booking domain: pure read-only queries AND the write-path reducers, in one cohesive
// file. No DOM, no I/O, no global state — the reducers take the FRESH server data and mutate
// it in place, returning the same {abort} / {conflicts} / {count,undo} / {n,undo} shapes the
// legacy `mutate(fresh => …)` callbacks returned; the queries are plain lookups over the same
// data. Merged from a prior split (`booking.ts` mutations / `booking-queries.ts` queries,
// PRINCIPLES.md E10's original "one domain, one file pair" shape) back into a single file per
// domain — same reasoning `shared/types.ts`/`shared/dates.ts`/`web/js/state.ts` already use
// (one file, one domain, sectioned internally), and `core/machines.ts` mirrors — see
// PRINCIPLES.md E10 for the updated rule. Sectioned below: 1) types, 2) queries (read-only),
// 3) mutations (write-path). The two impurities the booking apply needs — the wall-clock
// timestamp and the group-id factory — are injected (E4), so the reducers stay deterministic
// functions of their inputs.
//
// This belongs in core/ (domain logic, like sweepWeekends), NOT ui/. Gate-only: the mutations
// POST to /api/mutate, so they're verified by exhaustive unit tests rather than a
// production-write browser smoke (ARCHITECTURE §15).
//
// Naming note: each exported mutation here IS called by its bare name in `legacy.js` (inside a
// `mutate(fresh => bookCells(fresh, ...))` callback, via the window bridge), so those exported
// names are left exactly as they were — they were already full, descriptive words, not
// abbreviations. Only INTERNAL parameters and local variables are spelled out in full
// (PRINCIPLES.md E9); a parameter's name is never visible to a caller, so those renames need no
// change outside this file.

import type { Booking, Bookings, BookingData, Machine } from '../../../shared/types.ts';
import { dayAvailable, isBlockedOnDate, maintenanceSlotAt } from './machines.ts';
import { nextWeekday, previousWeekday } from '../../../shared/dates.ts';
import { sweepWeekends } from './weekend.ts';

// ---------------------------------------------------------------------------------------
// 1. Types
// ---------------------------------------------------------------------------------------

/** A cell change, with the previous value for undo (`null` = the cell was empty). */
export interface CellUndo {
  machineId: string;
  date: string;
  prev: Booking | null;
}

/** A day that could not be booked: already taken, or blocked by maintenance. */
export interface Conflict {
  machineId: string;
  date: string;
  by: string;
}

/** The impure inputs + user-entered fields the booking apply needs. */
export interface BookOptions {
  name: string;
  note: string;
  /** Group title (also the note source in the legacy form); non-empty forces a group. */
  title: string;
  /** When true, book the free days and skip the conflicting ones instead of aborting. */
  skipConflicts: boolean;
  /** Injected clock: the ISO timestamp stamped on every created cell. */
  ts: string;
  /** Injected id factory: called once, only when the action forms a booking group. */
  newGid: () => string;
}

/** The result of {@link bookCells}: a conflict abort, or the applied count + undo. */
export interface BookResult {
  abort?: boolean;
  conflicts?: Conflict[];
  count?: number;
  undo?: CellUndo[];
}

/** A cell address (machine + ISO date) for the selection delete. */
export interface CellRef {
  machineId: string;
  date: string;
}

/** Every cell (across every machine) sharing booking-group id `gid`, plus which machines and
 *  dates that spans. Faithful port of legacy `openBookingDetail`'s group-collection loop. */
export interface BookingGroup {
  machineIds: Set<string>;
  /** Every date in the group, sorted ascending. */
  dates: string[];
}

// ---------------------------------------------------------------------------------------
// 2. Queries (read-only)
// ---------------------------------------------------------------------------------------

/** The booking on `machineId` for `isoDate`, or undefined if that cell is free. Moved here
 *  from `ui/grid.ts` (a rendering module) — it's a plain data lookup with no DOM/rendering
 *  involvement, used by several components that have nothing to do with grid rendering
 *  (ARCHITECTURE_AUDIT.md F6). */
export function getBooking(
  bookings: Bookings,
  machineId: string,
  isoDate: string,
): Booking | undefined {
  return bookings[machineId]?.[isoDate];
}

/**
 * The contiguous run of workdays, centered on `isoDate`, that `machineId` has booked under
 * the same `name` — weekends don't break the run (they're simply skipped over), but a gap of
 * any other kind (a different booker, or a free/blocked day) does. Returned in chronological
 * order, always including `isoDate` itself. Faithful port of legacy `openBookingDetail`'s
 * backward/forward walk.
 */
export function findSameNameWorkdayRun(
  bookings: Bookings,
  machineId: string,
  isoDate: string,
  name: string,
): string[] {
  const machineBookings = bookings[machineId] || {};
  const run = [isoDate];

  let cursor = isoDate;
  while (true) {
    const previousWorkday = previousWeekday(cursor);
    if (machineBookings[previousWorkday]?.name !== name) break;
    cursor = previousWorkday;
    run.unshift(cursor);
  }

  cursor = isoDate;
  while (true) {
    const nextWorkday = nextWeekday(cursor);
    if (machineBookings[nextWorkday]?.name !== name) break;
    cursor = nextWorkday;
    run.push(cursor);
  }

  return run;
}

/** Every cell sharing booking-group id `groupId`, across every machine. Faithful port of
 *  legacy `openBookingDetail`'s group-collection loop. */
export function findBookingGroup(bookings: Bookings, groupId: string): BookingGroup {
  const machineIds = new Set<string>();
  const dates = new Set<string>();
  for (const machineId of Object.keys(bookings)) {
    const machineBookings = bookings[machineId]!;
    for (const date of Object.keys(machineBookings)) {
      if (machineBookings[date]?.gid === groupId) {
        machineIds.add(machineId);
        dates.add(date);
      }
    }
  }
  return { machineIds, dates: [...dates].sort() };
}

/** Conflicts against the fresh data: blocked days and already-booked days. */
function findBookingConflicts(
  freshServerData: BookingData,
  machineIds: readonly string[],
  dates: readonly string[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const machineId of machineIds) {
    const machine = freshServerData.machines.find((candidate) => candidate.id === machineId);
    if (!machine) continue;
    const machineBookings = freshServerData.bookings[machineId] || {};
    for (const date of dates) {
      if (!dayAvailable(machine, date)) continue; // unavailable weekdays are silently skipped
      if (isBlockedOnDate(machine, date)) {
        conflicts.push({
          machineId,
          date,
          by: `gesperrt (${maintenanceSlotAt(machine, date)?.type || 'Wartung'})`,
        });
      } else if (machineBookings[date]) {
        conflicts.push({ machineId, date, by: machineBookings[date].name });
      }
    }
  }
  return conflicts;
}

// ---------------------------------------------------------------------------------------
// 3. Mutations (write-path reducers)
// ---------------------------------------------------------------------------------------

/** Write the bookable `dates` on one machine (`buildCell` builds a fresh cell each time). */
function writeMachineCells(
  freshServerData: BookingData,
  machine: Machine,
  dates: readonly string[],
  buildCell: () => Booking,
): CellUndo[] {
  const machineBookings = (freshServerData.bookings[machine.id] =
    freshServerData.bookings[machine.id] || {});
  const undo: CellUndo[] = [];
  for (const date of dates) {
    // Never overwrite an existing cell, and respect blocks + unavailable weekdays.
    if (machineBookings[date] || isBlockedOnDate(machine, date) || !dayAvailable(machine, date)) {
      continue;
    }
    machineBookings[date] = buildCell();
    undo.push({ machineId: machine.id, date, prev: null });
  }
  return undo;
}

/** Build the fields for a newly booked cell, given the current booking's shared gid/title. */
function buildBookingCellFactory(
  options: Pick<BookOptions, 'name' | 'note' | 'ts'>,
  groupId: string | null,
  groupTitle: string,
): () => Booking {
  return () => {
    const cell: Booking = { name: options.name, ts: options.ts };
    if (options.note) cell.note = options.note;
    if (groupId) {
      cell.gid = groupId;
      if (groupTitle) cell.gtitle = groupTitle;
    }
    return cell;
  };
}

/** Write the free cells into `freshServerData` and return the applied count + undo records. */
function applyBooking(
  freshServerData: BookingData,
  machineIds: readonly string[],
  dates: readonly string[],
  options: BookOptions,
): { count: number; undo: CellUndo[] } {
  // A shared group id ties the cells together when this action creates more than one
  // cell (several machines and/or days) OR a title was given.
  const isGroup = machineIds.length > 1 || dates.length > 1 || !!options.title;
  const groupId = isGroup ? options.newGid() : null;
  const buildCell = buildBookingCellFactory(options, groupId, options.title);

  const undo: CellUndo[] = [];
  for (const machineId of machineIds) {
    const machine = freshServerData.machines.find((candidate) => candidate.id === machineId);
    if (!machine) continue;
    undo.push(...writeMachineCells(freshServerData, machine, dates, buildCell));
  }
  return { count: undo.length, undo };
}

/**
 * Book `dates` on every machine in `machineIds`. Conflicts are checked against the fresh
 * data first; if any exist and `skipConflicts` is false, aborts with the conflict list
 * (nothing written). Otherwise writes the free cells and returns the count + undo.
 * Faithful port of the `submitBooking` mutate callback.
 */
export function bookCells(
  freshServerData: BookingData,
  machineIds: readonly string[],
  dates: readonly string[],
  options: BookOptions,
): BookResult {
  const conflicts = findBookingConflicts(freshServerData, machineIds, dates);
  if (conflicts.length && !options.skipConflicts) return { abort: true, conflicts };
  return applyBooking(freshServerData, machineIds, dates, options);
}

/**
 * Delete the given `dates` on `machineId` that belong to `name`, then sweep any
 * weekend bridge days the deletion orphaned. Returns the deleted count + undo records
 * (including the swept weekend days). Faithful port of the booking-detail `del`.
 */
export function deleteCells(
  freshServerData: BookingData,
  machineId: string,
  name: string,
  dates: readonly string[],
): { n: number; undo: CellUndo[] } {
  const machineBookings = freshServerData.bookings[machineId] || {};
  let deletedCount = 0;
  const undo: CellUndo[] = [];
  for (const date of dates) {
    const existingBooking = machineBookings[date];
    if (existingBooking && existingBooking.name === name) {
      undo.push({ machineId, date, prev: { ...existingBooking } });
      delete machineBookings[date];
      deletedCount++;
    }
  }
  undo.push(...sweepWeekends(freshServerData, machineId)); // remove orphaned Sat/Sun bridge days too
  return { n: deletedCount, undo };
}

/**
 * Delete the current user's OWN cells (case-insensitive name match) among `dates` on
 * `machineId`, then sweep. Faithful port of the my-bookings `delDates` (which matches
 * `S.user` case-insensitively — distinct from {@link deleteCells}, which matches the
 * clicked cell's exact stored name).
 */
export function deleteOwnCells(
  freshServerData: BookingData,
  machineId: string,
  user: string,
  dates: readonly string[],
): { n: number; undo: CellUndo[] } {
  const machineBookings = freshServerData.bookings[machineId] || {};
  const lowercaseUser = user.toLowerCase();
  let deletedCount = 0;
  const undo: CellUndo[] = [];
  for (const date of dates) {
    const existingBooking = machineBookings[date];
    if (existingBooking && existingBooking.name.toLowerCase() === lowercaseUser) {
      undo.push({ machineId, date, prev: { ...existingBooking } });
      delete machineBookings[date];
      deletedCount++;
    }
  }
  undo.push(...sweepWeekends(freshServerData, machineId));
  return { n: deletedCount, undo };
}

/**
 * Delete the exact cells listed (those that still exist — no name check), then sweep
 * each machine in `machineIds`. Faithful port of the marquee-selection context-menu delete.
 */
export function deleteSelectedCells(
  freshServerData: BookingData,
  cells: readonly CellRef[],
  machineIds: readonly string[],
): { n: number; undo: CellUndo[] } {
  let deletedCount = 0;
  const undo: CellUndo[] = [];
  for (const cellRef of cells) {
    const machineBookings = freshServerData.bookings[cellRef.machineId];
    if (!machineBookings) continue;
    const existingBooking = machineBookings[cellRef.date];
    if (!existingBooking) continue;
    undo.push({ machineId: cellRef.machineId, date: cellRef.date, prev: { ...existingBooking } });
    delete machineBookings[cellRef.date];
    deletedCount++;
  }
  for (const machineId of machineIds) undo.push(...sweepWeekends(freshServerData, machineId));
  return { n: deletedCount, undo };
}

/**
 * Delete every cell belonging to booking-group `groupId` across all machines, then sweep
 * the affected machines. Faithful port of the booking-detail "delete whole group".
 */
export function deleteGroup(
  freshServerData: BookingData,
  groupId: string,
): { n: number; undo: CellUndo[] } {
  let deletedCount = 0;
  const undo: CellUndo[] = [];
  const affectedMachineIds = new Set<string>();
  for (const machineId of Object.keys(freshServerData.bookings)) {
    const machineBookings = freshServerData.bookings[machineId]!;
    for (const date of Object.keys(machineBookings)) {
      const existingBooking = machineBookings[date];
      if (existingBooking && existingBooking.gid === groupId) {
        undo.push({ machineId, date, prev: { ...existingBooking } });
        delete machineBookings[date];
        deletedCount++;
        affectedMachineIds.add(machineId);
      }
    }
  }
  for (const machineId of affectedMachineIds)
    undo.push(...sweepWeekends(freshServerData, machineId));
  return { n: deletedCount, undo };
}
