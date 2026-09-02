// The machine domain: pure category/maintenance/availability predicates AND the CRUD
// write-path reducers (save/delete/reorder), in one cohesive file. No DOM, no I/O, no global
// state. Merged from a prior split (`machines.ts` mutations / `machines-queries.ts` queries,
// PRINCIPLES.md E10's original "one domain, one file pair" shape) back into a single file per
// domain — same reasoning `shared/types.ts`/`shared/dates.ts`/`web/js/state.ts` already use
// (one file, one domain, sectioned internally) — see PRINCIPLES.md E10 for the updated rule.
// Sectioned below: 1) types, 2) queries/predicates (read-only), 3) mutations (write-path).
//
// `categoryOf`/`maintenanceSlots`/`maintenanceSlotAt`/`isBlockedOnDate`/`hasAnyMaintenanceSlot`
// were each called by an old abbreviated name (`catOf`/`maintSlots`/`maintAt`/`isBlockedM`/
// `anyMaint`) dozens of times across `legacy.js`, via window-bridge aliases — retired along
// with `legacy.js` itself in Phase 7 slice B10g (`legacy.js` no longer exists in this repo).
// The mutation exports (`saveMachine`/`deleteMachine`/`moveMachine`) are called the same bare
// way today from the current React components (`MachineFormModal.tsx`/`AdminModal.tsx`, inside
// `window.mutate((fresh) => saveMachine(fresh, ...))`) — not a legacy holdover, just their
// permanent name; only their internal parameters/locals are spelled out in full (PRINCIPLES.md
// E9).

import type { Machine, MaintSlot, MachineCategory, BookingData } from '../../../shared/types.ts';
import { mondayFirstWeekdayIndex, parseIsoDateString } from '../../../shared/dates.ts';

// ---------------------------------------------------------------------------------------
// 1. Types
// ---------------------------------------------------------------------------------------

/** One category's distinct group names (first-seen order), for the "Bereich" filter's
 *  `<optgroup>` structure. */
export interface CategoryGroups {
  category: MachineCategory;
  groups: string[];
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

// ---------------------------------------------------------------------------------------
// 2. Queries & predicates (read-only)
// ---------------------------------------------------------------------------------------

/** A machine's category: 'messtechnik' for measurement devices, else 'maschine'. */
export function categoryOf(machine: Machine | null | undefined): MachineCategory {
  return machine && machine.cat === 'messtechnik' ? 'messtechnik' : 'maschine';
}

/** The two categories, in display order, with their German label and sprite icon. Shared by
 *  the grid's category toggle buttons (B1) and the Statistik category filter (B5). */
export const CATEGORIES: ReadonlyArray<{ id: MachineCategory; label: string; icon: string }> = [
  { id: 'maschine', label: 'Maschinen', icon: 'factory' },
  { id: 'messtechnik', label: 'Messtechnik', icon: 'gauge' },
];

/** One category's distinct group names (first-seen order), for the "Bereich" filter's
 *  `<optgroup>` structure. A category with no groups is omitted entirely — an empty
 *  `<optgroup>` would render nothing anyway, so leaving it out is the same net result. */
export function groupsByCategory(machines: readonly Machine[]): CategoryGroups[] {
  const result: CategoryGroups[] = [];
  for (const { id: category } of CATEGORIES) {
    const seenGroupNames = new Set<string>();
    const groups: string[] = [];
    for (const machine of machines) {
      if (categoryOf(machine) !== category || seenGroupNames.has(machine.group)) continue;
      seenGroupNames.add(machine.group);
      groups.push(machine.group);
    }
    if (groups.length) result.push({ category, groups });
  }
  return result;
}

/**
 * The maintenance slots of a machine. Prefers the structured `maint` array; otherwise
 * synthesizes one slot from the legacy single-status fields (unless status is 'ok').
 */
export function maintenanceSlots(machine: Machine): MaintSlot[] {
  if (Array.isArray(machine.maint)) return machine.maint;
  if (machine.status && machine.status !== 'ok') {
    return [
      {
        type: machine.status,
        from: machine.statusFrom || '',
        until: machine.statusUntil || '',
        note: machine.statusNote || '',
      },
    ];
  }
  return [];
}

/** True if slot `slot` covers ISO date `isoDate` (open-ended when a bound is empty). */
export function slotCovers(slot: MaintSlot, isoDate: string): boolean {
  return (!slot.from || isoDate >= slot.from) && (!slot.until || isoDate <= slot.until);
}

/** The maintenance slot covering `isoDate`, or null if none. */
export function maintenanceSlotAt(machine: Machine, isoDate: string): MaintSlot | null {
  for (const slot of maintenanceSlots(machine)) {
    if (slotCovers(slot, isoDate)) return slot;
  }
  return null;
}

/** True if the machine is blocked (maintenance/defect) on ISO date `isoDate`. */
export function isBlockedOnDate(machine: Machine, isoDate: string): boolean {
  return !!maintenanceSlotAt(machine, isoDate);
}

/** True if the machine has any maintenance slot at all. */
export function hasAnyMaintenanceSlot(machine: Machine): boolean {
  return maintenanceSlots(machine).length > 0;
}

/**
 * True if the machine is available on the weekday of ISO date `isoDate`, per its `days`
 * mask (Mo..So, '1' = available). A missing or malformed mask means available every day.
 */
export function dayAvailable(machine: Machine, isoDate: string): boolean {
  if (!machine.days || machine.days.length !== 7) return true;
  return machine.days.charAt(mondayFirstWeekdayIndex(parseIsoDateString(isoDate))) !== '0';
}

/** True if a cell is bookable: not blocked AND available on that weekday. */
export function cellBookable(machine: Machine, isoDate: string): boolean {
  return !isBlockedOnDate(machine, isoDate) && dayAvailable(machine, isoDate);
}

// ---------------------------------------------------------------------------------------
// 3. Mutations (write-path reducers)
// ---------------------------------------------------------------------------------------

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
 * A short, deterministic hex digest of `input` (djb2 variant) — not a cryptographic hash, just
 * enough spread that two different names essentially never collide, and the same name always
 * maps to the same fallback id (`findUniqueMachineId` still appends `-2`/`-3`/… on the rare
 * collision, exactly as it does for a readable slug). `>>> 0` forces an unsigned 32-bit value
 * before hex-encoding so the result is always 8 hex digits regardless of sign, then trimmed to 6.
 */
function shortHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Derive a URL-safe machine id base from a name: lowercase, German umlauts/ß spelled out (so
 * "Prüfgerät" -> "pruefgeraet"), everything else that isn't a-z0-9 collapsed to a single hyphen,
 * leading/trailing hyphens trimmed. A name with no Latin-alphanumeric content at all to slug from
 * (a non-Latin script such as Cyrillic/CJK, or e.g. pure punctuation) falls back to a short hash
 * of the original name (`m_8f2a1c`) rather than a single generic id every such machine would
 * otherwise collide into — readable id when the name allows it, a stable unique one when it can't.
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
  return slug || `m_${shortHash(name)}`;
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
 * Saves the machine form: with `machineId` set, applies the fields onto that machine (aborting
 * if it's since vanished from the fresh data); otherwise creates a new machine — a unique
 * slugged id, inserted right after the last machine of the same group. Returns nothing on
 * success; only a failed edit (the machine is gone) returns `{abort: true}`.
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
  // A real Machine from the start (name/group already known from the form) — no unsound cast
  // through an object that's temporarily missing required fields.
  const newMachine: Machine = { id: newMachineId, name: form.name, group: form.group };
  applyFormFieldsToMachine(newMachine, form);
  freshServerData.machines.splice(insertionIndex, 0, newMachine);
}

/**
 * Removes machine `machineId` and all of its bookings. Returns `{abort: true}` instead if the
 * machine is already gone (deleted from elsewhere since the caller last read the data).
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
 * Reorders machine `machineId` one step within its own group, by swapping it with its immediate
 * neighbour (machines of one group are already stored contiguously, so swapping array
 * neighbours IS moving within the group). `direction` is -1 to move up (earlier in the array) or
 * +1 to move down (later).
 *
 * Aborts without changing anything if the move would leave the group: running off either end of
 * the array, or landing on a machine from a different group — reordering across a group
 * boundary isn't allowed.
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
