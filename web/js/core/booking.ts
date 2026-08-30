// Pure write-path reducers extracted from the monolith (legacy.js). No DOM, no I/O,
// no global state — each takes the FRESH server data (machines + bookings) and mutates
// it in place, returning the same {abort} / {conflicts} / {count,undo} / {n,undo}
// shapes the legacy `mutate(fresh => …)` callbacks returned. The two impurities the
// booking apply needs — the wall-clock timestamp and the group-id factory — are
// injected (E4), so the reducers are deterministic functions of their inputs.
//
// These belong in core/ (domain logic, like sweepWeekends), NOT ui/. They are the
// booking apply/conflict reducer, the run delete, and the machine CRUD (save/delete/
// reorder). Gate-only: they POST to /api/mutate, so they are verified by exhaustive
// unit tests rather than a production-write browser smoke (ARCHITECTURE §15).
//
// Naming note: each exported function here IS called by its bare name in `legacy.js`
// (inside a `mutate(fresh => bookCells(fresh, ...))` callback, via the window bridge),
// so the exported names themselves are left exactly as they were — they were already
// full, descriptive words, not abbreviations. Only the INTERNAL parameters and local
// variables below are renamed; a parameter's name is never visible to a caller, so
// none of those renames need any change outside this file.

import type { Booking, BookingData, Machine, MaintSlot } from '../../../shared/types.ts';
import { dayAvailable, isBlockedOnDate, maintenanceSlotAt } from './machines.ts';
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

/** The machine-form fields (already trimmed/validated by the form) a save applies. */
export interface MachineForm {
  name: string;
  group: string;
  /** 'messtechnik' or 'maschine' ('maschine' = default, stored as no `cat` field). */
  cat: string;
  info: string;
  redu: string;
  /** 7-char Mo..So mask, or null for "available every day". */
  daysMask: string | null;
  maint: MaintSlot[];
}

/** Apply the form fields onto a machine object (add-or-clear each optional field). */
function applyFormFieldsToMachine(machine: Machine, form: MachineForm): void {
  machine.name = form.name;
  machine.group = form.group;
  machine.info = form.info;
  if (form.redu) machine.redu = form.redu;
  else delete machine.redu; // redundancy marker (label only)
  if (form.daysMask) machine.days = form.daysMask;
  else delete machine.days; // available weekdays
  if (form.maint.length) machine.maint = form.maint;
  else delete machine.maint; // maintenance/defect slots
  delete machine.status;
  delete machine.statusNote;
  delete machine.statusFrom;
  delete machine.statusUntil; // legacy single-status replaced by maint
  if (form.cat === 'messtechnik') machine.cat = 'messtechnik';
  else delete machine.cat; // 'maschine' = default (no field)
}

/**
 * Derive a URL-safe machine id base from a name: lowercase, German umlauts/ß spelled
 * out (so "Prüfgerät" -> "pruefgeraet"), everything else that isn't a-z0-9 collapsed
 * to a single hyphen, and leading/trailing hyphens trimmed.
 */
function slugify(name: string): string {
  const transliterated = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  const slug = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug || 'maschine';
}

/** A unique machine id starting from `baseSlug`, appending `-2`, `-3`, … until free. */
function findUniqueMachineId(machines: readonly Machine[], baseSlug: string): string {
  let candidateId = baseSlug;
  let suffix = 2;
  while (machines.some((machine) => machine.id === candidateId)) {
    candidateId = `${baseSlug}-${suffix}`;
    suffix++;
  }
  return candidateId;
}

/**
 * Where to insert a newly created machine: right after the last existing machine of
 * the same group, so new machines stay grouped with their siblings instead of always
 * landing at the very end of the list. Falls back to the end when the group is new.
 */
function findGroupInsertionIndex(machines: readonly Machine[], group: string): number {
  for (let index = machines.length - 1; index >= 0; index--) {
    if (machines[index]!.group === group) {
      return index + 1;
    }
  }
  return machines.length;
}

/**
 * Save the machine form: when `mid` is set, apply the fields onto that machine (abort
 * if it vanished from the fresh data); otherwise create a new machine — a unique
 * slugged id, inserted after the last machine of the same group. Faithful port of the
 * `mfSave` mutate callback (returns nothing on success, `{abort:true}` on failure).
 */
export function saveMachine(
  freshServerData: BookingData,
  mid: string | null,
  form: MachineForm,
): { abort: true } | void {
  if (mid) {
    const existingMachine = freshServerData.machines.find((candidate) => candidate.id === mid);
    if (!existingMachine) return { abort: true };
    applyFormFieldsToMachine(existingMachine, form);
    return;
  }
  const newMachineId = findUniqueMachineId(freshServerData.machines, slugify(form.name));
  const insertionIndex = findGroupInsertionIndex(freshServerData.machines, form.group);
  const newMachine = { id: newMachineId } as Machine;
  applyFormFieldsToMachine(newMachine, form);
  freshServerData.machines.splice(insertionIndex, 0, newMachine);
}

/**
 * Remove machine `mid` and all its bookings. Faithful port of the `mfDel` mutate
 * callback (`{abort:true}` if the machine is already gone).
 */
export function deleteMachine(freshServerData: BookingData, mid: string): { abort: true } | void {
  const machineIndex = freshServerData.machines.findIndex((candidate) => candidate.id === mid);
  if (machineIndex < 0) return { abort: true };
  freshServerData.machines.splice(machineIndex, 1);
  delete freshServerData.bookings[mid];
}

/**
 * Move machine `id` one step (`dir` = -1 up / +1 down) within its group by swapping
 * with its neighbour. Aborts at the list ends or across a group boundary (reorder is
 * only allowed inside the same group). Faithful port of the admin `moveById`.
 */
export function moveMachine(
  freshServerData: BookingData,
  id: string,
  dir: number,
): { abort: true } | void {
  const machineIndex = freshServerData.machines.findIndex((machine) => machine.id === id);
  const neighborIndex = machineIndex + dir;
  const machines = freshServerData.machines;
  if (machineIndex < 0 || neighborIndex < 0 || neighborIndex >= machines.length) {
    return { abort: true };
  }
  if (machines[machineIndex]!.group !== machines[neighborIndex]!.group) {
    return { abort: true };
  }
  [machines[machineIndex], machines[neighborIndex]] = [
    machines[neighborIndex]!,
    machines[machineIndex]!,
  ];
}
