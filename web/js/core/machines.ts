// Pure machine-CRUD write-path reducers (save/delete/reorder), extracted from core/booking.ts
// where they used to live mislabeled under the booking domain's file name. No DOM, no I/O, no
// global state — each takes the FRESH server data and mutates it in place, returning the same
// {abort} / void shapes the legacy `mutate(fresh => …)` callbacks returned. Pairs with
// core/machines-queries.ts (the read-only side) the same way core/booking.ts pairs with
// core/booking-queries.ts (PRINCIPLES.md E10 — one domain, one file pair).
//
// Naming note: each exported function here IS called by its bare name in `legacy.js` (inside a
// `mutate(fresh => saveMachine(fresh, ...))` callback, via the window bridge), so the exported
// names themselves are left exactly as they were. Only the INTERNAL parameters and local
// variables are spelled out in full (PRINCIPLES.md E9) — a parameter's name is never visible to
// a caller, so none of those renames need any change outside this file.

import type { BookingData, Machine, MaintSlot } from '../../../shared/types.ts';

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
 * Save the machine form: when `machineId` is set, apply the fields onto that machine (abort
 * if it vanished from the fresh data); otherwise create a new machine — a unique
 * slugged id, inserted after the last machine of the same group. Faithful port of the
 * `mfSave` mutate callback (returns nothing on success, `{abort:true}` on failure).
 */
export function saveMachine(
  freshServerData: BookingData,
  machineId: string | null,
  form: MachineForm,
): { abort: true } | void {
  if (machineId) {
    const existingMachine = freshServerData.machines.find(
      (candidate) => candidate.id === machineId,
    );
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
 * Remove machine `machineId` and all its bookings. Faithful port of the `mfDel` mutate
 * callback (`{abort:true}` if the machine is already gone).
 */
export function deleteMachine(
  freshServerData: BookingData,
  machineId: string,
): { abort: true } | void {
  const machineIndex = freshServerData.machines.findIndex(
    (candidate) => candidate.id === machineId,
  );
  if (machineIndex < 0) return { abort: true };
  freshServerData.machines.splice(machineIndex, 1);
  delete freshServerData.bookings[machineId];
}

/**
 * Move the machine `machineId` one step up or down within its own group, by swapping it with
 * its immediate neighbour in the machines array (machines are already stored grouped —
 * consecutive `group` values — so a group's members are already adjacent in the array; swapping
 * array neighbours IS moving within the group).
 *
 * `direction` is -1 to move up (earlier in the array) or +1 to move down (later). Aborts
 * without changing anything when the move would leave the group: running off either end of
 * the array, or landing on a machine from a different group — reordering across a group
 * boundary isn't allowed. Faithful port of the admin `moveById`.
 */
export function moveMachine(
  freshServerData: BookingData,
  machineId: string,
  direction: -1 | 1,
): { abort: true } | void {
  const machines = freshServerData.machines;
  const currentIndex = machines.findIndex((machine) => machine.id === machineId);
  const neighbourIndex = currentIndex + direction;
  const wouldLeaveTheArray =
    currentIndex < 0 || neighbourIndex < 0 || neighbourIndex >= machines.length;
  if (wouldLeaveTheArray) return { abort: true };

  const currentMachine = machines[currentIndex]!;
  const neighbourMachine = machines[neighbourIndex]!;
  if (currentMachine.group !== neighbourMachine.group) return { abort: true }; // crosses a group boundary

  machines[currentIndex] = neighbourMachine;
  machines[neighbourIndex] = currentMachine;
}
