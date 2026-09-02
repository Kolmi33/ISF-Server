// =======================================================================================
// MACHINE DOMAIN MODULE (web/js/core/machines.ts)
// =======================================================================================
//
// Pure domain logic for machines (resources).
// This module provides:
// 1. Read-only queries & availability predicates (checking if machines are free, blocked, or in maintenance).
// 2. Write-path reducers (creating, editing, deleting, and reordering machines).
//
// Key Principles:
// - PURE FUNCTIONS: No DOM access, no network I/O, no global state mutations.
// - EXPLICIT NAMES: All domain concepts (categories, maintenance slots, availability masks) are spelled out in full.
// - IN-MEMORY REDUCERS: Mutates the dataset (BookingData) deterministically in place.
//
// =======================================================================================

import type {
  Machine,
  MaintSlot as MaintenanceSlot,
  MachineCategory,
  BookingData,
} from '../../../shared/types.ts';
import { mondayFirstWeekdayIndex, parseIsoDateString } from '../../../shared/dates.ts';

// Re-export MaintenanceSlot for callers
export type { MaintenanceSlot };

// ---------------------------------------------------------------------------------------
// 1. Types & Domain Interfaces
// ---------------------------------------------------------------------------------------

/**
 * Direction for reordering a machine in the visual list.
 * - 'up' or -1: Move machine earlier in the list.
 * - 'down' or 1: Move machine later in the list.
 */
export type MoveDirection = 'up' | 'down' | -1 | 1;

/**
 * Represents a resource category and its distinct group names in first-seen order.
 * Used to populate group filter dropdowns and grouped table headers.
 */
export interface CategoryGroups {
  category: MachineCategory;
  groups: string[];
}

/**
 * Validated input fields from the machine configuration dialog.
 * Used by saveMachine to create or update a machine.
 */
export interface MachineForm {
  /** Display name of the machine (e.g. "5-Achs Fräse DMU 50"). */
  name: string;
  /** Group / department name the machine belongs to (e.g. "Fräsen", "Drehen"). */
  group: string;
  /** Category: 'messtechnik' for measurement devices, or 'maschine' for standard machines. */
  category?: string;
  /** Legacy property alias for category */
  cat?: string;
  /** Optional free-form description or notes about the machine. */
  info: string;
  /** Optional redundancy group marker/label (used for automatic device substitution). */
  redundancyGroup?: string;
  /** Legacy property alias for redundancyGroup */
  redu?: string;
  /** 7-character Mo..So availability mask (e.g. '1111100' for Mo-Fr), or null for all days. */
  weekdayAvailabilityMask?: string | null;
  /** Legacy property alias for weekdayAvailabilityMask */
  daysMask?: string | null;
  /** Active maintenance and defect date ranges for this machine. */
  maintenanceSlots?: MaintenanceSlot[];
  /** Legacy property alias for maintenanceSlots */
  maint?: MaintenanceSlot[];
}

// ---------------------------------------------------------------------------------------
// 2. Read-Only Queries & Availability Predicates
// ---------------------------------------------------------------------------------------

/**
 * Determines a machine's category.
 * - If machine.cat is 'messtechnik', returns 'messtechnik'.
 * - Otherwise defaults to 'maschine' (standard machines).
 */
export function getMachineCategory(machine: Machine | null | undefined): MachineCategory {
  return machine && machine.cat === 'messtechnik' ? 'messtechnik' : 'maschine';
}

/** Legacy alias for getMachineCategory */
export const categoryOf = getMachineCategory;

/**
 * The standard list of resource categories in display order, including their German labels and icon names.
 */
export const CATEGORIES: ReadonlyArray<{ id: MachineCategory; label: string; icon: string }> = [
  { id: 'maschine', label: 'Maschinen', icon: 'factory' },
  { id: 'messtechnik', label: 'Messtechnik', icon: 'gauge' },
];

/**
 * Groups machines by their category, preserving the order in which groups first appear.
 * Categories with no machines are omitted from the result.
 *
 * Example Output:
 * [
 *   { category: 'maschine', groups: ['Fräsen', 'Drehen', 'Sägen'] },
 *   { category: 'messtechnik', groups: ['3D-Scanner', 'Messarme'] }
 * ]
 */
export function groupsByCategory(machines: readonly Machine[]): CategoryGroups[] {
  const result: CategoryGroups[] = [];

  for (const { id: category } of CATEGORIES) {
    const seenGroupNames = new Set<string>();
    const groups: string[] = [];

    for (const machine of machines) {
      if (getMachineCategory(machine) !== category) continue;
      if (seenGroupNames.has(machine.group)) continue;

      seenGroupNames.add(machine.group);
      groups.push(machine.group);
    }

    if (groups.length > 0) {
      result.push({ category, groups });
    }
  }

  return result;
}

/**
 * Returns all maintenance/defect date ranges (slots) for a machine.
 *
 * How it works:
 * 1. Checks if the machine has a modern `maint` array. If found, returns it directly.
 * 2. If no `maint` array exists, checks legacy single-status fields (`status`, `statusFrom`, `statusUntil`).
 *    If status is not 'ok', synthesizes a temporary maintenance slot from those fields.
 * 3. If machine is fully operational with no maintenance, returns an empty array `[]`.
 */
export function getMaintenanceSlots(machine: Machine): MaintenanceSlot[] {
  // 1. Modern structured array
  if (Array.isArray(machine.maint)) {
    return machine.maint;
  }

  // 2. Legacy fallback
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

  // 3. No maintenance
  return [];
}

/** Legacy alias for getMaintenanceSlots */
export const maintenanceSlots = getMaintenanceSlots;

/**
 * Checks whether a maintenance slot covers a given ISO date ('YYYY-MM-DD').
 *
 * How date range boundaries work:
 * - If `from` is empty: Open-ended start (covers all dates up to `until`).
 * - If `until` is empty: Open-ended end (covers all dates from `from` onwards).
 * - If both are set: Date must fall inside `from <= isoDate <= until`.
 */
export function isSlotCoveringDate(slot: MaintenanceSlot, isoDate: string): boolean {
  const isAfterOrAtStart = !slot.from || isoDate >= slot.from;
  const isBeforeOrAtEnd = !slot.until || isoDate <= slot.until;
  return isAfterOrAtStart && isBeforeOrAtEnd;
}

/** Legacy alias for isSlotCoveringDate */
export const slotCovers = isSlotCoveringDate;

/**
 * Finds the maintenance or defect slot covering a specific ISO date.
 *
 * Returns:
 * - The matching `MaintenanceSlot` object if the machine is blocked on that date.
 * - `null` if the machine is operational and free of maintenance on that date.
 */
export function getMaintenanceSlotAtDate(
  machine: Machine,
  isoDate: string,
): MaintenanceSlot | null {
  const activeSlots = getMaintenanceSlots(machine);
  for (const slot of activeSlots) {
    if (isSlotCoveringDate(slot, isoDate)) {
      return slot;
    }
  }
  return null;
}

/** Legacy alias for getMaintenanceSlotAtDate */
export const maintenanceSlotAt = getMaintenanceSlotAtDate;

/**
 * Checks if a machine is blocked by maintenance or defect on a specific ISO date.
 * Returns `true` if any maintenance slot covers that date; otherwise `false`.
 */
export function isMachineBlockedOnDate(machine: Machine, isoDate: string): boolean {
  return getMaintenanceSlotAtDate(machine, isoDate) !== null;
}

/** Legacy alias for isMachineBlockedOnDate */
export const isBlockedOnDate = isMachineBlockedOnDate;

/**
 * Checks if a machine has any maintenance or defect slots defined at all.
 * Used by UI icons to highlight machines with pending or active maintenance.
 */
export function hasAnyMaintenanceSlot(machine: Machine): boolean {
  return getMaintenanceSlots(machine).length > 0;
}

/**
 * Checks if a machine is scheduled to work on the day of the week of `isoDate`.
 *
 * How the Weekday Mask works:
 * - `machine.days` is a 7-character string corresponding to Monday through Sunday:
 *   Index 0 = Monday, Index 1 = Tuesday, ..., Index 5 = Saturday, Index 6 = Sunday.
 * - '1' = Operational (can be booked).
 * - '0' = Off / Unavailable (cannot be booked).
 *
 * Examples:
 * - '1111100' ➔ Monday-Friday only (Weekends off).
 * - '1111111' ➔ Available 7 days a week.
 * - Missing or invalid mask ➔ Defaults to `true` (available every day).
 */
export function isMachineAvailableOnWeekday(machine: Machine, isoDate: string): boolean {
  if (!machine.days || machine.days.length !== 7) {
    return true; // No mask = available every day
  }
  const weekdayIndex = mondayFirstWeekdayIndex(parseIsoDateString(isoDate));
  return machine.days.charAt(weekdayIndex) !== '0';
}

/** Legacy alias for isMachineAvailableOnWeekday */
export const dayAvailable = isMachineAvailableOnWeekday;

/**
 * Determines if a specific cell (machine × date) can be booked.
 *
 * A cell is bookable ONLY when BOTH conditions are met:
 * 1. The machine is NOT blocked by maintenance or defect on that date (`!isMachineBlockedOnDate`).
 * 2. The machine is scheduled to work on that weekday (`isMachineAvailableOnWeekday`).
 */
export function isCellBookable(machine: Machine, isoDate: string): boolean {
  return !isMachineBlockedOnDate(machine, isoDate) && isMachineAvailableOnWeekday(machine, isoDate);
}

/** Legacy alias for isCellBookable */
export const cellBookable = isCellBookable;

// ---------------------------------------------------------------------------------------
// 3. Write-Path Reducers (Mutations)
// ---------------------------------------------------------------------------------------

/**
 * Applies form values onto an existing machine object in place.
 *
 * Logic:
 * - Sets required properties (`name`, `group`, `info`).
 * - Sets optional properties if provided, or deletes them if empty (avoids cluttering JSON).
 * - Cleans up legacy status fields (`status`, `statusNote`, etc.) superseded by `maint`.
 */
export function applyFormFieldsToMachine(machine: Machine, form: MachineForm): void {
  machine.name = form.name;
  machine.group = form.group;
  machine.info = form.info;

  // 1. Redundancy Group
  const redundancyGroup = form.redundancyGroup || form.redu;
  if (redundancyGroup) {
    machine.redu = redundancyGroup;
  } else {
    delete machine.redu;
  }

  // 2. Weekday Availability Mask
  const weekdayMask =
    form.weekdayAvailabilityMask !== undefined ? form.weekdayAvailabilityMask : form.daysMask;
  if (weekdayMask) {
    machine.days = weekdayMask;
  } else {
    delete machine.days;
  }

  // 3. Maintenance Slots
  const activeMaintenanceSlots = form.maintenanceSlots || form.maint;
  if (activeMaintenanceSlots && activeMaintenanceSlots.length > 0) {
    machine.maint = activeMaintenanceSlots;
  } else {
    delete machine.maint;
  }

  // 4. Remove obsolete legacy single-status fields
  delete machine.status;
  delete machine.statusNote;
  delete machine.statusFrom;
  delete machine.statusUntil;

  // 5. Category ('messtechnik' vs default 'maschine')
  const category = form.category || form.cat;
  if (category === 'messtechnik') {
    machine.cat = 'messtechnik';
  } else {
    delete machine.cat;
  }
}

/**
 * Generates a short, deterministic 6-character hex hash from any string.
 * Used to construct unique IDs for machine names written in non-Latin scripts (e.g. Cyrillic, Chinese, Arabic).
 */
function generateShortHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Derives a clean, URL-safe machine ID from a human-readable name.
 *
 * Multi-Language Logic:
 * 1. Converts to lowercase and expands German umlauts (ä->ae, ö->oe, ü->ue, ß->ss).
 * 2. Normalizes Latin diacritics via Unicode NFKD (é->e, ñ->n, å->a, č->c, etc.).
 * 3. Replaces non-alphanumeric characters with hyphens and trims leading/trailing hyphens (max 40 chars).
 * 4. Non-Latin Fallback: If the name contains no Latin letters (e.g. Cyrillic "Фрезерный" or Chinese "铣床"),
 *    generates a unique deterministic ID from its hash (e.g. "m_8f2a1c") to avoid ID collisions.
 */
export function generateMachineIdFromName(name: string): string {
  if (!name || typeof name !== 'string') {
    return 'machine';
  }

  const trimmed = name.trim().toLowerCase();

  // 1. Expand German umlauts
  const umlautsExpanded = trimmed
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');

  // 2. Normalize Latin diacritics (removes accents from é, ñ, å, etc.)
  const asciiNormalized = umlautsExpanded.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

  // 3. Keep only ASCII a-z and 0-9
  const slug = asciiNormalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  // 4. Any readable Latin slug at all (even one character, e.g. a machine literally named "Z")
  //    is used as-is; only a genuinely empty result falls through to the hash below.
  if (slug.length > 0) {
    return slug;
  }

  // 5. Non-Latin / symbol fallback: deterministic hash from the input string
  return `m_${generateShortHash(trimmed)}`;
}

/**
 * Guarantees that a machine ID is unique across the entire machine list.
 * If `desiredId` already exists, appends numeric suffixes (-2, -3, ...) until an unused ID is found.
 */
export function ensureUniqueMachineId(
  existingMachines: readonly Machine[],
  desiredId: string,
): string {
  let candidateId = desiredId;
  let suffixNumber = 2;

  while (existingMachines.some((machine) => machine.id === candidateId)) {
    candidateId = `${desiredId}-${suffixNumber}`;
    suffixNumber++;
  }

  return candidateId;
}

/**
 * Calculates the array index where a new machine should be inserted:
 * - Inserts immediately AFTER the last existing machine of the same group so that machines
 *   belonging to the same department stay visually grouped in the UI.
 * - If the group is new (no siblings exist), places the new machine at the end of the array.
 */
export function findGroupInsertionIndex(
  existingMachines: readonly Machine[],
  targetGroupName: string,
): number {
  for (let index = existingMachines.length - 1; index >= 0; index--) {
    if (existingMachines[index]!.group === targetGroupName) {
      return index + 1;
    }
  }
  return existingMachines.length;
}

/**
 * Saves machine configuration:
 * - Edit mode (`machineId` is string): Updates the existing machine's fields in place.
 *   Returns `{ abort: true }` if the machine was deleted concurrently.
 * - Create mode (`machineId` is null): Generates a unique ID from the name and inserts the new machine
 *   adjacent to its group siblings.
 */
export function saveMachine(
  data: BookingData,
  machineId: string | null,
  form: MachineForm,
): { abort: true } | void {
  // 1. Edit existing machine
  if (machineId) {
    const existingMachine = data.machines.find((candidate) => candidate.id === machineId);
    if (!existingMachine) {
      return { abort: true };
    }
    applyFormFieldsToMachine(existingMachine, form);
    return;
  }

  // 2. Create new machine
  const desiredId = generateMachineIdFromName(form.name);
  const uniqueMachineId = ensureUniqueMachineId(data.machines, desiredId);
  const insertionIndex = findGroupInsertionIndex(data.machines, form.group);

  const newMachine: Machine = { id: uniqueMachineId, name: form.name, group: form.group };
  applyFormFieldsToMachine(newMachine, form);
  data.machines.splice(insertionIndex, 0, newMachine);
}

/**
 * Deletes a machine from the list and removes all of its associated bookings.
 * Returns `{ abort: true }` if the machine does not exist in `data.machines`.
 */
export function deleteMachine(data: BookingData, machineId: string): { abort: true } | void {
  const machineIndex = data.machines.findIndex((candidate) => candidate.id === machineId);
  if (machineIndex < 0) {
    return { abort: true };
  }

  data.machines.splice(machineIndex, 1);
  delete data.bookings[machineId];
}

/**
 * Reorders a machine one step up or down within its group by swapping positions with its neighbor.
 *
 * Validation Rules (Guards):
 * 1. The target machine must exist in data.machines.
 * 2. Movement cannot exceed list boundaries (cannot move 'up' past index 0 or 'down' past the last item).
 * 3. Movement is strictly restricted to machines within the EXACT same group (group boundaries are preserved).
 *
 * Returns `{ abort: true }` if any validation rule is violated; otherwise performs the swap in place.
 */
export function moveMachine(
  data: BookingData,
  machineId: string,
  direction: MoveDirection,
): { abort: true } | void {
  const machines = data.machines;
  const currentIndex = machines.findIndex((machine) => machine.id === machineId);
  if (currentIndex < 0) {
    return { abort: true };
  }

  const stepOffset = direction === 'up' || direction === -1 ? -1 : 1;
  const targetNeighborIndex = currentIndex + stepOffset;

  // 1. Boundary check: ensure target index is within array range
  const isOutOfBounds = targetNeighborIndex < 0 || targetNeighborIndex >= machines.length;
  if (isOutOfBounds) {
    return { abort: true };
  }

  const currentMachine = machines[currentIndex]!;
  const neighborMachine = machines[targetNeighborIndex]!;

  // 2. Group boundary check: reordering is only permitted within the same group
  const isDifferentGroup = currentMachine.group !== neighborMachine.group;
  if (isDifferentGroup) {
    return { abort: true };
  }

  // 3. Perform swap
  machines[currentIndex] = neighborMachine;
  machines[targetNeighborIndex] = currentMachine;
}
