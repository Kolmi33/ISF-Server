// Pure booking write-path reducers extracted from the monolith (legacy.js). No DOM, no I/O,
// no global state — each takes the FRESH server data (machines + bookings) and mutates
// it in place, returning the same {abort} / {conflicts} / {count,undo} / {n,undo}
// shapes the legacy `mutate(fresh => …)` callbacks returned. The two impurities the
// booking apply needs — the wall-clock timestamp and the group-id factory — are
// injected (E4), so the reducers are deterministic functions of their inputs.
//
// This belongs in core/ (domain logic, like sweepWeekends), NOT ui/. It is the booking
// apply/conflict reducer and the various run-delete reducers — booking domain only; the
// machine-CRUD reducers (save/delete/reorder) that used to live here too moved out to
// core/machines.ts, so this file's name matches what it actually contains
// (PRINCIPLES.md E10). Gate-only: they POST to /api/mutate, so they are verified by
// exhaustive unit tests rather than a production-write browser smoke (ARCHITECTURE §15).
//
// Naming note: each exported function here IS called by its bare name in `legacy.js`
// (inside a `mutate(fresh => bookCells(fresh, ...))` callback, via the window bridge),
// so the exported names themselves are left exactly as they were — they were already
// full, descriptive words, not abbreviations. Only the INTERNAL parameters and local
// variables below are renamed; a parameter's name is never visible to a caller, so
// none of those renames need any change outside this file.

import type { Booking, BookingData, Machine } from '../../../shared/types.ts';
import { dayAvailable, isBlockedOnDate, maintenanceSlotAt } from './machines-queries.ts';
import { sweepWeekends } from './weekend.ts';

/** A cell change, with the previous value for undo (`null` = the cell was empty). */
export interface CellUndo {
  mid: string;
  date: string;
  prev: Booking | null;
}

/** A day that could not be booked: already taken, or blocked by maintenance. */
export interface Conflict {
  mid: string;
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

/** Conflicts against the fresh data: blocked days and already-booked days. */
function findConflicts(
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
          mid: machineId,
          date,
          by: `gesperrt (${maintenanceSlotAt(machine, date)?.type || 'Wartung'})`,
        });
      } else if (machineBookings[date]) {
        conflicts.push({ mid: machineId, date, by: machineBookings[date].name });
      }
    }
  }
  return conflicts;
}

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
    undo.push({ mid: machine.id, date, prev: null });
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
 * Book `dates` on every machine in `mids`. Conflicts are checked against the fresh
 * data first; if any exist and `skipConflicts` is false, aborts with the conflict list
 * (nothing written). Otherwise writes the free cells and returns the count + undo.
 * Faithful port of the `submitBooking` mutate callback.
 */
export function bookCells(
  freshServerData: BookingData,
  mids: readonly string[],
  dates: readonly string[],
  options: BookOptions,
): BookResult {
  const conflicts = findConflicts(freshServerData, mids, dates);
  if (conflicts.length && !options.skipConflicts) return { abort: true, conflicts };
  return applyBooking(freshServerData, mids, dates, options);
}

/**
 * Delete the given `dates` on machine `mid` that belong to `name`, then sweep any
 * weekend bridge days the deletion orphaned. Returns the deleted count + undo records
 * (including the swept weekend days). Faithful port of the booking-detail `del`.
 */
export function deleteCells(
  freshServerData: BookingData,
  mid: string,
  name: string,
  dates: readonly string[],
): { n: number; undo: CellUndo[] } {
  const machineBookings = freshServerData.bookings[mid] || {};
  let deletedCount = 0;
  const undo: CellUndo[] = [];
  for (const date of dates) {
    const existingBooking = machineBookings[date];
    if (existingBooking && existingBooking.name === name) {
      undo.push({ mid, date, prev: { ...existingBooking } });
      delete machineBookings[date];
      deletedCount++;
    }
  }
  undo.push(...sweepWeekends(freshServerData, mid)); // remove orphaned Sat/Sun bridge days too
  return { n: deletedCount, undo };
}

/**
 * Delete the current user's OWN cells (case-insensitive name match) among `dates` on
 * machine `mid`, then sweep. Faithful port of the my-bookings `delDates` (which matches
 * `S.user` case-insensitively — distinct from {@link deleteCells}, which matches the
 * clicked cell's exact stored name).
 */
export function deleteOwnCells(
  freshServerData: BookingData,
  mid: string,
  user: string,
  dates: readonly string[],
): { n: number; undo: CellUndo[] } {
  const machineBookings = freshServerData.bookings[mid] || {};
  const lowercaseUser = user.toLowerCase();
  let deletedCount = 0;
  const undo: CellUndo[] = [];
  for (const date of dates) {
    const existingBooking = machineBookings[date];
    if (existingBooking && existingBooking.name.toLowerCase() === lowercaseUser) {
      undo.push({ mid, date, prev: { ...existingBooking } });
      delete machineBookings[date];
      deletedCount++;
    }
  }
  undo.push(...sweepWeekends(freshServerData, mid));
  return { n: deletedCount, undo };
}

/** A cell address (machine + ISO date) for the selection delete. */
export interface CellRef {
  mid: string;
  date: string;
}

/**
 * Delete the exact cells listed (those that still exist — no name check), then sweep
 * each machine in `mids`. Faithful port of the marquee-selection context-menu delete.
 */
export function deleteSelectedCells(
  freshServerData: BookingData,
  cells: readonly CellRef[],
  mids: readonly string[],
): { n: number; undo: CellUndo[] } {
  let deletedCount = 0;
  const undo: CellUndo[] = [];
  for (const cellRef of cells) {
    const machineBookings = freshServerData.bookings[cellRef.mid];
    if (!machineBookings) continue;
    const existingBooking = machineBookings[cellRef.date];
    if (!existingBooking) continue;
    undo.push({ mid: cellRef.mid, date: cellRef.date, prev: { ...existingBooking } });
    delete machineBookings[cellRef.date];
    deletedCount++;
  }
  for (const mid of mids) undo.push(...sweepWeekends(freshServerData, mid));
  return { n: deletedCount, undo };
}

/**
 * Delete every cell belonging to booking-group `gid` across all machines, then sweep
 * the affected machines. Faithful port of the booking-detail "delete whole group".
 */
export function deleteGroup(
  freshServerData: BookingData,
  groupId: string,
): { n: number; undo: CellUndo[] } {
  let deletedCount = 0;
  const undo: CellUndo[] = [];
  const affectedMachineIds = new Set<string>();
  for (const mid of Object.keys(freshServerData.bookings)) {
    const machineBookings = freshServerData.bookings[mid]!;
    for (const date of Object.keys(machineBookings)) {
      const existingBooking = machineBookings[date];
      if (existingBooking && existingBooking.gid === groupId) {
        undo.push({ mid, date, prev: { ...existingBooking } });
        delete machineBookings[date];
        deletedCount++;
        affectedMachineIds.add(mid);
      }
    }
  }
  for (const mid of affectedMachineIds) undo.push(...sweepWeekends(freshServerData, mid));
  return { n: deletedCount, undo };
}
