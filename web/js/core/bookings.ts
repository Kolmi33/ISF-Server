// =======================================================================================
// BOOKING DOMAIN MODULE (web/js/core/bookings.ts)
// =======================================================================================
//
// Pure domain logic for bookings (the grid's cells).
// This module provides:
// 1. Read-only queries (looking up a cell, finding a same-name run of workdays, collecting
//    every cell in a booking group).
// 2. Write-path reducers (booking cells, deleting cells — by clicked cell, by owner, by
//    marquee selection, or by whole group).
//
// Key Principles:
// - PURE FUNCTIONS: the reducers take the FRESH server data and mutate it in place,
//   returning the same `{abort}` / `{conflicts}` / `{count,undo}` / `{deletedCount,undo}`
//   shapes the current React components (`BookingForm.tsx`, `BookingDetailModal.tsx`,
//   `MyBookingsModal.tsx`, `ContextMenu.tsx`) already expect from `window.mutate`.
// - INJECTED IMPURITIES: the two non-deterministic inputs booking-apply needs — the
//   wall-clock timestamp and the group-id factory — are passed in as `BookOptions` fields
//   rather than read from `Date.now()`/a random-id call directly, so the reducers stay
//   deterministic functions of their inputs and are trivially unit-testable.
// - DOMAIN LOGIC LIVES IN core/, NOT ui/: this module (like `sweepWeekends`) has no DOM
//   dependency, so it's exhaustively unit-tested here rather than only exercised through a
//   production-write browser smoke test (ARCHITECTURE §15).
//
// =======================================================================================

import type { Booking, Bookings, BookingData, Machine } from '../../../shared/types.ts';
import {
  isMachineAvailableOnWeekday,
  isMachineBlockedOnDate,
  getMaintenanceSlotAtDate,
} from './machines.ts';
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
 *  dates that spans — the shape a booking's detail view needs to show "this group covers 3
 *  machines over 5 workdays". */
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
 * Finds the contiguous run of workdays, centered on `isoDate`, that `machineId` has booked
 * under the same `name` — weekends don't break the run (they're simply skipped over), but a
 * gap of any other kind (a different booker, or a free/blocked day) does.
 *
 * How it works:
 * 1. Starts the run at `isoDate` itself.
 * 2. Walks backward one workday at a time (via `previousWeekday`, so weekends are
 *    transparently skipped), extending the run while the same `name` booked that day too.
 * 3. Walks forward the same way from `isoDate`.
 * 4. Returns the whole run in chronological order.
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

/** Collects every cell sharing booking-group id `groupId`, across every machine — walks the
 *  full `bookings` map once, recording each machine/date pair whose cell carries that `gid`. */
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

/**
 * Checks `machineIds` × `dates` against the fresh data for conflicts.
 *
 * How it works, per machine/date pair:
 * 1. An unavailable weekday (per that machine's `days` mask) is silently skipped — not a
 *    conflict, since the caller never intended to book on a day the machine doesn't work.
 * 2. A day blocked by maintenance/defect IS a conflict, labeled with the block reason.
 * 3. A day already booked by someone else is a conflict, labeled with their name.
 */
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
      if (!isMachineAvailableOnWeekday(machine, date)) continue; // unavailable weekdays are silently skipped
      if (isMachineBlockedOnDate(machine, date)) {
        conflicts.push({
          machineId,
          date,
          by: `gesperrt (${getMaintenanceSlotAtDate(machine, date)?.type || 'Wartung'})`,
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

/**
 * Writes the bookable `dates` on one machine (`buildCell` builds a fresh cell each time it's
 * called, so every written cell gets its own object). A date is silently skipped — not
 * written, not counted, not an error — when the cell is already taken, blocked, or the
 * machine doesn't work that weekday; `bookCells`'s own conflict check has already decided
 * whether skipping is acceptable before this function ever runs.
 */
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
    if (
      machineBookings[date] ||
      isMachineBlockedOnDate(machine, date) ||
      !isMachineAvailableOnWeekday(machine, date)
    ) {
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

/**
 * Writes the free cells into `freshServerData` and returns the applied count + undo records.
 *
 * How it works:
 * 1. Decides whether this action needs a shared group id: more than one cell (several
 *    machines and/or days) OR an explicit title makes it a group, even a single cell with
 *    a title.
 * 2. Builds one cell factory (shared gid/title baked in) and applies it per machine.
 */
function applyBooking(
  freshServerData: BookingData,
  machineIds: readonly string[],
  dates: readonly string[],
  options: BookOptions,
): { count: number; undo: CellUndo[] } {
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
 * Books `dates` on every machine in `machineIds`.
 *
 * How it works:
 * 1. Checks for conflicts against the fresh data first.
 * 2. If any conflicts exist and `skipConflicts` is false, aborts with the conflict list —
 *    nothing is written, so the caller can show the conflicts and let the user decide.
 * 3. Otherwise (no conflicts, or the caller opted to skip them) writes the free cells and
 *    returns the applied count + undo records.
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
 * Deletes the given `dates` on `machineId` that belong to `name` (a date not booked under
 * that exact name is left untouched — this only removes what the caller identified as
 * theirs to delete), then sweeps any weekend bridge days the deletion orphaned. Returns the
 * deleted count + undo records, including the swept weekend days.
 */
export function deleteCells(
  freshServerData: BookingData,
  machineId: string,
  name: string,
  dates: readonly string[],
): { deletedCount: number; undo: CellUndo[] } {
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
  return { deletedCount, undo };
}

/**
 * Deletes the current user's OWN cells among `dates` on `machineId` (case-insensitive name
 * match against `user` — distinct from {@link deleteCells}, which matches the clicked cell's
 * exact stored name instead of "whoever is currently logged in"), then sweeps.
 */
export function deleteOwnCells(
  freshServerData: BookingData,
  machineId: string,
  user: string,
  dates: readonly string[],
): { deletedCount: number; undo: CellUndo[] } {
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
  return { deletedCount, undo };
}

/**
 * Deletes the exact cells listed (whichever of them still exist — no name check, so this
 * removes anyone's booking, not just the caller's own), then sweeps each machine in
 * `machineIds`. Used for a marquee-selection bulk delete, where the user has already
 * explicitly selected every cell to remove.
 */
export function deleteSelectedCells(
  freshServerData: BookingData,
  cells: readonly CellRef[],
  machineIds: readonly string[],
): { deletedCount: number; undo: CellUndo[] } {
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
  return { deletedCount, undo };
}

/**
 * Deletes every cell belonging to booking-group `groupId` across all machines, then sweeps
 * each machine that lost at least one cell — the "delete the whole group at once" action
 * from a booking's detail view, as opposed to deleting just the one clicked cell.
 */
export function deleteGroup(
  freshServerData: BookingData,
  groupId: string,
): { deletedCount: number; undo: CellUndo[] } {
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
  return { deletedCount, undo };
}
