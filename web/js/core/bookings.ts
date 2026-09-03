// =======================================================================================
// BOOKING DOMAIN MODULE (web/js/core/bookings.ts)
// =======================================================================================
//
// Pure domain logic for cell reservations (bookings) on the schedule grid.
//
// Responsibilities:
// 1. Read-Only Queries: Looking up individual cells, detecting continuous same-name booking runs,
//    and resolving multi-cell booking groups.
// 2. Write-Path Reducers: Creating new bookings and executing targeted deletions (single cell,
//    user's own cells, marquee selection, or entire booking group).
// 3. Automated Weekend Sweep: Pruning orphaned Saturday/Sunday bridge days when their surrounding
//    Friday or Monday bookings are removed.
// 4. Undo Journaling: Generating deterministic undo records for every applied cell modification.
//
// Invariants & Business Rules:
// - Determinism: Timestamps and group ID generators are injected via BookOptions for reproducible tests.
// - Concurrency Protection: Mutations never overwrite existing bookings silently unless explicitly instructed.
// - Availability Enforcement: Bookings cannot be placed on days blocked by maintenance or excluded by weekday masks.
//
// =======================================================================================

import type { Booking, Bookings, BookingData, Machine } from '../../../shared/types.ts';
import {
  isMachineAvailableOnWeekday,
  isMachineBlockedOnDate,
  getMaintenanceSlotAtDate,
} from './machines.ts';
import {
  nextWeekday,
  previousWeekday,
  parseIsoDateString,
  formatDateAsIsoString,
  addDays,
} from '../../../shared/dates.ts';

// ---------------------------------------------------------------------------------------
// 1. Types & Domain Interfaces
// ---------------------------------------------------------------------------------------

/**
 * An undo record capturing the previous state of a single cell (`prev: null` if previously empty).
 */
export interface CellUndo {
  machineId: string;
  date: string;
  prev: Booking | null;
}

/**
 * Represents a scheduling conflict where a requested cell cannot be booked.
 */
export interface Conflict {
  machineId: string;
  date: string;
  /** Reason for conflict: name of the existing booker, or maintenance/defect description. */
  by: string;
}

/**
 * Form values and runtime options supplied to bookCells.
 */
export interface BookOptions {
  /** Name of the person booking the machine. */
  name: string;
  /** Optional cell note. */
  note: string;
  /** Optional booking group title (e.g. project name). Non-empty forces group creation. */
  title: string;
  /** If true, successfully books all free days while skipping conflicting ones instead of aborting. */
  skipConflicts: boolean;
  /** Injected ISO timestamp stamped onto each created cell. */
  ts: string;
  /** Factory producing unique group IDs when booking multiple cells or a titled group. */
  newGid: () => string;
}

/**
 * Result returned by bookCells.
 */
export interface BookResult {
  /** True if the operation was aborted due to conflicts. */
  abort?: boolean;
  /** List of detected booking conflicts when abort is true. */
  conflicts?: Conflict[];
  /** Total number of cells successfully written. */
  count?: number;
  /** List of undo records for rollback support. */
  undo?: CellUndo[];
}

/**
 * Direct reference to a cell coordinates (machine ID + ISO date).
 */
export interface CellRef {
  machineId: string;
  date: string;
}

/**
 * Represents a resolved multi-cell booking group spanning multiple machines and dates.
 */
export interface BookingGroup {
  /** All machine IDs involved in this group. */
  machineIds: Set<string>;
  /** Chronologically sorted list of all dates included in this group. */
  dates: string[];
}

/**
 * An undo record for an orphaned weekend bridge day removed by sweepWeekends.
 */
export interface WeekendUndo {
  machineId: string;
  date: string;
  prev: { name: string; ts?: string };
}

// ---------------------------------------------------------------------------------------
// 2. Read-Only Queries
// ---------------------------------------------------------------------------------------

/**
 * Looks up the booking at `machineId` on `isoDate`.
 * Returns the Booking object or undefined if the cell is unoccupied.
 */
export function getBooking(
  bookings: Bookings,
  machineId: string,
  isoDate: string,
): Booking | undefined {
  return bookings[machineId]?.[isoDate];
}

/**
 * Finds the contiguous sequence of workdays booked by the same person centered around `isoDate`.
 *
 * Algorithm:
 * 1. Starts at `isoDate`.
 * 2. Walks backward workday-by-workday (skipping weekends) as long as the cell belongs to `name`.
 * 3. Walks forward workday-by-workday as long as the cell belongs to `name`.
 * 4. Returns the full chronological array of date strings.
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

/**
 * Resolves all cells belonging to a specific booking group ID (`groupId`) across all machines.
 */
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
 * Scans a matrix of `machineIds` × `dates` for potential scheduling conflicts.
 *
 * Evaluation Rules:
 * 1. Days where the machine is non-operational per its weekday mask are silently skipped.
 * 2. Days blocked by maintenance or defect are flagged as conflicts with the maintenance note.
 * 3. Days already booked by another reservation are flagged as conflicts with the booker's name.
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
      if (!isMachineAvailableOnWeekday(machine, date)) continue;
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
// 3. Write-Path Reducers (Mutations)
// ---------------------------------------------------------------------------------------

/**
 * Writes new booking cells for a single machine across valid dates.
 * Skips dates that are already booked, blocked by maintenance, or non-operational on that weekday.
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

/**
 * Constructs a cell factory function that attaches shared group attributes (gid, gtitle) to new cells.
 */
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
 * Applies bookings across multiple machines and dates in memory, generating group IDs when applicable.
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
 * Books `dates` across `machineIds`.
 *
 * Workflow:
 * 1. Evaluates all requested cells for scheduling conflicts.
 * 2. If conflicts exist and `skipConflicts` is false, aborts immediately without modifying state.
 * 3. If no conflicts exist (or `skipConflicts` is true), writes the cells and returns undo entries.
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
 * Removes orphaned weekend entries (Saturday/Sunday) on `machineId`.
 *
 * Business Rule:
 * Weekend bookings are only valid as part of a continuous bridge connecting Friday through Monday.
 * If either Friday or Monday is unbooked, the intervening weekend days are automatically pruned.
 */
export function sweepWeekends(freshServerData: BookingData, machineId: string): WeekendUndo[] {
  const machineBookings = freshServerData.bookings[machineId];
  if (!machineBookings) return [];
  const undo: WeekendUndo[] = [];
  for (const [isoDate, previousValue] of Object.entries(machineBookings)) {
    const date = parseIsoDateString(isoDate);
    const weekday = date.getUTCDay();
    const isSaturday = weekday === 6;
    const isSunday = weekday === 0;
    if (!isSaturday && !isSunday) continue;
    const fridayIsoDate = formatDateAsIsoString(addDays(date, isSaturday ? -1 : -2));
    const mondayIsoDate = formatDateAsIsoString(addDays(date, isSaturday ? 2 : 1));
    const bridgeStillHolds = machineBookings[fridayIsoDate] && machineBookings[mondayIsoDate];
    if (!bridgeStillHolds) {
      undo.push({ machineId, date: isoDate, prev: { ...previousValue } });
      delete machineBookings[isoDate];
    }
  }
  return undo;
}

/**
 * Deletes cells on `machineId` for `dates` that match `name` exactly, followed by a weekend sweep.
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
  undo.push(...sweepWeekends(freshServerData, machineId));
  return { deletedCount, undo };
}

/**
 * Deletes the logged-in user's own cells (case-insensitive name match) on `machineId` across `dates`.
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
 * Deletes an explicit list of selected cells regardless of owner (e.g. from marquee selection).
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
 * Deletes all cells across all machines belonging to a booking group (`groupId`), followed by weekend sweep.
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
