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

import type { Booking, BookingData, Machine, MaintSlot } from '../../../shared/types.ts';
import { dayAvailable, isBlockedM, maintAt } from './machines.ts';
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
  fresh: BookingData,
  mids: readonly string[],
  dates: readonly string[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const mid of mids) {
    const m = fresh.machines.find((x) => x.id === mid);
    if (!m) continue;
    const mb = fresh.bookings[mid] || {};
    for (const d of dates) {
      if (!dayAvailable(m, d)) continue; // unavailable weekdays are silently skipped
      if (isBlockedM(m, d))
        conflicts.push({ mid, date: d, by: `gesperrt (${maintAt(m, d)?.type || 'Wartung'})` });
      else if (mb[d]) conflicts.push({ mid, date: d, by: mb[d].name });
    }
  }
  return conflicts;
}

/** Write the bookable `dates` on one machine (`make` builds a fresh cell each time). */
function writeMachineCells(
  fresh: BookingData,
  m: Machine,
  dates: readonly string[],
  make: () => Booking,
): CellUndo[] {
  const mb = (fresh.bookings[m.id] = fresh.bookings[m.id] || {});
  const undo: CellUndo[] = [];
  for (const d of dates) {
    // never overwrite / respect blocks + unavailable weekdays
    if (mb[d] || isBlockedM(m, d) || !dayAvailable(m, d)) continue;
    mb[d] = make();
    undo.push({ mid: m.id, date: d, prev: null });
  }
  return undo;
}

/** Write the free cells into `fresh` and return the applied count + undo records. */
function applyBooking(
  fresh: BookingData,
  mids: readonly string[],
  dates: readonly string[],
  opts: BookOptions,
): { count: number; undo: CellUndo[] } {
  const { name, note, title, ts, newGid } = opts;
  // A shared gid ties the cells together when this action creates more than one cell
  // (several machines and/or days) OR a title was given.
  const isGroup = mids.length > 1 || dates.length > 1 || !!title;
  const gid = isGroup ? newGid() : null;
  const extra = gid ? { gid, ...(title ? { gtitle: title } : {}) } : {};
  const make = (): Booking => ({ name, ...(note ? { note } : {}), ts, ...extra });
  const undo: CellUndo[] = [];
  for (const mid of mids) {
    const m = fresh.machines.find((x) => x.id === mid);
    if (!m) continue;
    undo.push(...writeMachineCells(fresh, m, dates, make));
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
  fresh: BookingData,
  mids: readonly string[],
  dates: readonly string[],
  opts: BookOptions,
): BookResult {
  const conflicts = findConflicts(fresh, mids, dates);
  if (conflicts.length && !opts.skipConflicts) return { abort: true, conflicts };
  return applyBooking(fresh, mids, dates, opts);
}

/**
 * Delete the given `dates` on machine `mid` that belong to `name`, then sweep any
 * weekend bridge days the deletion orphaned. Returns the deleted count + undo records
 * (including the swept weekend days). Faithful port of the booking-detail `del`.
 */
export function deleteCells(
  fresh: BookingData,
  mid: string,
  name: string,
  dates: readonly string[],
): { n: number; undo: CellUndo[] } {
  const fmb = fresh.bookings[mid] || {};
  let n = 0;
  const undo: CellUndo[] = [];
  for (const dd of dates) {
    if (fmb[dd] && fmb[dd].name === name) {
      undo.push({ mid, date: dd, prev: { ...fmb[dd] } });
      delete fmb[dd];
      n++;
    }
  }
  undo.push(...sweepWeekends(fresh, mid)); // remove orphaned Sat/Sun bridge days too
  return { n, undo };
}

/**
 * Delete the current user's OWN cells (case-insensitive name match) among `dates` on
 * machine `mid`, then sweep. Faithful port of the my-bookings `delDates` (which matches
 * `S.user` case-insensitively — distinct from {@link deleteCells}, which matches the
 * clicked cell's exact stored name).
 */
export function deleteOwnCells(
  fresh: BookingData,
  mid: string,
  user: string,
  dates: readonly string[],
): { n: number; undo: CellUndo[] } {
  const mb = fresh.bookings[mid] || {};
  const u = user.toLowerCase();
  let n = 0;
  const undo: CellUndo[] = [];
  for (const d of dates) {
    const b = mb[d];
    if (b && b.name.toLowerCase() === u) {
      undo.push({ mid, date: d, prev: { ...b } });
      delete mb[d];
      n++;
    }
  }
  undo.push(...sweepWeekends(fresh, mid));
  return { n, undo };
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
  fresh: BookingData,
  cells: readonly CellRef[],
  mids: readonly string[],
): { n: number; undo: CellUndo[] } {
  let n = 0;
  const undo: CellUndo[] = [];
  for (const c of cells) {
    const mb = fresh.bookings[c.mid];
    if (!mb) continue;
    const b = mb[c.date];
    if (!b) continue;
    undo.push({ mid: c.mid, date: c.date, prev: { ...b } });
    delete mb[c.date];
    n++;
  }
  for (const mid of mids) undo.push(...sweepWeekends(fresh, mid));
  return { n, undo };
}

/**
 * Delete every cell belonging to booking-group `gid` across all machines, then sweep
 * the affected machines. Faithful port of the booking-detail "delete whole group".
 */
export function deleteGroup(fresh: BookingData, gid: string): { n: number; undo: CellUndo[] } {
  let n = 0;
  const undo: CellUndo[] = [];
  const affected = new Set<string>();
  for (const mid of Object.keys(fresh.bookings)) {
    const fmb = fresh.bookings[mid]!;
    for (const dd of Object.keys(fmb)) {
      const b = fmb[dd];
      if (b && b.gid === gid) {
        undo.push({ mid, date: dd, prev: { ...b } });
        delete fmb[dd];
        n++;
        affected.add(mid);
      }
    }
  }
  for (const mid of affected) undo.push(...sweepWeekends(fresh, mid));
  return { n, undo };
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
function applyFields(o: Machine, f: MachineForm): void {
  o.name = f.name;
  o.group = f.group;
  o.info = f.info;
  if (f.redu) o.redu = f.redu;
  else delete o.redu; // redundancy marker (label only)
  if (f.daysMask) o.days = f.daysMask;
  else delete o.days; // available weekdays
  if (f.maint.length) o.maint = f.maint;
  else delete o.maint; // maintenance/defect slots
  delete o.status;
  delete o.statusNote;
  delete o.statusFrom;
  delete o.statusUntil; // legacy single-status replaced by maint
  if (f.cat === 'messtechnik') o.cat = 'messtechnik';
  else delete o.cat; // 'maschine' = default (no field)
}

/** Derive a URL-safe machine id base from a name (German transliteration). */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'maschine'
  );
}

/**
 * Save the machine form: when `mid` is set, apply the fields onto that machine (abort
 * if it vanished from the fresh data); otherwise create a new machine — a unique
 * slugged id, inserted after the last machine of the same group. Faithful port of the
 * `mfSave` mutate callback (returns nothing on success, `{abort:true}` on failure).
 */
export function saveMachine(
  fresh: BookingData,
  mid: string | null,
  form: MachineForm,
): { abort: true } | void {
  if (mid) {
    const fm = fresh.machines.find((x) => x.id === mid);
    if (!fm) return { abort: true };
    applyFields(fm, form);
    return;
  }
  const base = slugify(form.name);
  let id = base;
  let n = 2;
  while (fresh.machines.some((x) => x.id === id)) id = `${base}-${n++}`;
  let idx = fresh.machines.length;
  for (let i = fresh.machines.length - 1; i >= 0; i--)
    if (fresh.machines[i]!.group === form.group) {
      idx = i + 1;
      break;
    }
  const nm = { id } as Machine;
  applyFields(nm, form);
  fresh.machines.splice(idx, 0, nm);
}

/**
 * Remove machine `mid` and all its bookings. Faithful port of the `mfDel` mutate
 * callback (`{abort:true}` if the machine is already gone).
 */
export function deleteMachine(fresh: BookingData, mid: string): { abort: true } | void {
  const i = fresh.machines.findIndex((x) => x.id === mid);
  if (i < 0) return { abort: true };
  fresh.machines.splice(i, 1);
  delete fresh.bookings[mid];
}

/**
 * Move machine `id` one step (`dir` = -1 up / +1 down) within its group by swapping
 * with its neighbour. Aborts at the list ends or across a group boundary (reorder is
 * only allowed inside the same group). Faithful port of the admin `moveById`.
 */
export function moveMachine(fresh: BookingData, id: string, dir: number): { abort: true } | void {
  const idx = fresh.machines.findIndex((m) => m.id === id);
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= fresh.machines.length) return { abort: true };
  if (fresh.machines[idx]!.group !== fresh.machines[j]!.group) return { abort: true };
  [fresh.machines[idx], fresh.machines[j]] = [fresh.machines[j]!, fresh.machines[idx]!];
}
