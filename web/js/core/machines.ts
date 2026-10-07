// =======================================================================================
// MACHINE DOMAIN MODULE (web/js/core/machines.ts)
// =======================================================================================
//
// Core business rules and state transformations for physical resources (machines and measurement equipment).
//
// Responsibilities:
// 1. Availability Evaluation: Determines whether resources can be booked based on operational calendars,
//    scheduled maintenance periods, and equipment breakdowns.
// 2. Resource Hierarchy: Organizes machines into production categories and organizational department groups.
// 3. Resource Lifecycle Management: Handles creation with unique identifier generation, configuration updates,
//    deletions, and relative position reordering within department groups.
//
// =======================================================================================

import type {
  Machine,
  MaintenanceSlot,
  MachineCategory,
  BookingData,
} from '../../../shared/types.ts';
import { mondayFirstWeekdayIndex, parseIsoDateString } from '../../../shared/dates.ts';

// ---------------------------------------------------------------------------------------
// 1. Types & Domain Interfaces
// ---------------------------------------------------------------------------------------

/**
 * Relative movement offset when adjusting the display order of machines within a department group:
 * - `-1`: Shifts the resource upwards (earlier in sequence).
 * - `1`: Shifts the resource downwards (later in sequence).
 */
export type MoveDirection = -1 | 1;

/**
 * Structured group summary representing an entire equipment category along with all unique
 * department groups currently associated with it, ordered by first appearance in the dataset.
 */
export interface CategoryGroups {
  category: MachineCategory;
  groups: string[];
}

/**
 * Form payload capturing user input from the machine creation or edit dialog.
 */
export interface MachineForm {
  /** Human-readable display label (e.g. "5-Achs Fräse DMU 50"). */
  name: string;
  /** Department or workshop group to which this resource is assigned (e.g. "Fräsen", "Drehen"). */
  group: string;
  /** Equipment category: `'messtechnik'` for quality assurance / measurement devices, or `'maschine'` for production machinery. */
  cat?: string;
  /** Free-form technical specifications, location details, or operator notes. */
  info: string;
  /** Optional redundancy group identifier used by the booking assistant to find equivalent substitute machines. */
  redu?: string;
  /** 7-character Monday-to-Sunday mask (e.g. `'1111100'` for workdays only) indicating which days of the week the machine operates. */
  daysMask?: string | null;
  /** Scheduled maintenance downtime and active defect periods. */
  maint?: MaintenanceSlot[];
}

// ---------------------------------------------------------------------------------------
// 2. Read-Only Queries & Availability Predicates
// ---------------------------------------------------------------------------------------

/**
 * Resolves the equipment category for a machine.
 *
 * Business Rule:
 * In the workshop schedule, equipment is partitioned into production machinery and measurement devices.
 * Resources default to standard machines (`'maschine'`) unless specifically flagged as metrology instruments (`'messtechnik'`).
 */
export function getMachineCategory(machine: Machine | null | undefined): MachineCategory {
  return machine && machine.cat === 'messtechnik' ? 'messtechnik' : 'maschine';
}

/**
 * Global definitions for all supported resource categories, defining their display labels and visual iconography.
 */
export const CATEGORIES: ReadonlyArray<{ id: MachineCategory; label: string; icon: string }> = [
  { id: 'maschine', label: 'Maschinen', icon: 'factory' },
  { id: 'messtechnik', label: 'Messtechnik', icon: 'gauge' },
];

/**
 * Discovers and organizes all distinct department groups under their parent category.
 *
 * Business Rule:
 * Preserves the natural workshop ordering (first-seen sequence) so department groupings remain
 * consistent in dropdowns and table views. Categories containing no active machines are omitted.
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

/** A "Bereich" filter value's prefix for a whole-category selection (e.g. `"cat:messtechnik"`),
 *  as opposed to an exact department-group name (e.g. `"Halle 1"`) — lets one filter field
 *  offer both "just this department" and "every department in this category" without a second
 *  field. Shared by every view that offers a Bereich filter (`AllBookingsModal.tsx`,
 *  `MyBookingsModal.tsx`), so the encoding and its matching rule below live in one place. */
export const CATEGORY_FILTER_PREFIX = 'cat:';

/** Whether `machine` matches a "Bereich" filter value: an exact group name, or (given the
 *  `CATEGORY_FILTER_PREFIX`) membership in that whole category regardless of department group. */
export function matchesGroupFilter(machine: Machine, groupFilter: string): boolean {
  if (groupFilter.startsWith(CATEGORY_FILTER_PREFIX)) {
    return getMachineCategory(machine) === groupFilter.slice(CATEGORY_FILTER_PREFIX.length);
  }
  return machine.group === groupFilter;
}

/**
 * Extracts all scheduled maintenance intervals and defect downtimes for a machine.
 *
 * Data Compatibility:
 * Reads structured maintenance ranges when present. If an older machine record contains only
 * legacy status properties (`status`, `statusFrom`, `statusUntil`), this function seamlessly
 * converts those properties into a normalized maintenance slot so modern blocking rules apply uniformly.
 */
export function getMaintenanceSlots(machine: Machine): MaintenanceSlot[] {
  if (Array.isArray(machine.maint)) {
    return machine.maint;
  }

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

/**
 * Evaluates whether a maintenance or breakdown interval overlaps with a specific calendar date.
 *
 * Calendar Logic:
 * Supports open-ended ranges where a start or end date is omitted (e.g. ongoing breakdown without an ETA),
 * as well as strictly bounded maintenance windows.
 */
export function isSlotCoveringDate(slot: MaintenanceSlot, isoDate: string): boolean {
  const isAfterOrAtStart = !slot.from || isoDate >= slot.from;
  const isBeforeOrAtEnd = !slot.until || isoDate <= slot.until;
  return isAfterOrAtStart && isBeforeOrAtEnd;
}

/**
 * Retrieves the specific maintenance slot causing a machine to be unavailable on a given date.
 * Returns `null` if the machine is operational on that date.
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

/**
 * Checks whether a machine is blocked by maintenance or downtime on a given calendar date.
 */
export function isMachineBlockedOnDate(machine: Machine, isoDate: string): boolean {
  return getMaintenanceSlotAtDate(machine, isoDate) !== null;
}

/**
 * Determines whether a machine has any planned or active maintenance downtime configured.
 * Used to display warning badges and maintenance indicators in the UI headers.
 */
export function hasAnyMaintenanceSlot(machine: Machine): boolean {
  return getMaintenanceSlots(machine).length > 0;
}

/**
 * Evaluates whether a machine is scheduled for operation on the specific day of the week of `isoDate`.
 *
 * Business Rule:
 * Operating schedules are defined by a 7-character bitmask representing Monday through Sunday
 * (where index 0 is Monday and index 6 is Sunday). A `'1'` indicates regular working hours,
 * while `'0'` indicates planned downtime (e.g. weekend closures or non-working days).
 * If no mask is configured, the machine is assumed to operate 7 days a week.
 */
export function isMachineAvailableOnWeekday(machine: Machine, isoDate: string): boolean {
  return isMachineAvailableOnWeekdayIndex(
    machine,
    mondayFirstWeekdayIndex(parseIsoDateString(isoDate)),
  );
}

/** Index-based counterpart for renderers that already know the Monday-first column index. */
export function isMachineAvailableOnWeekdayIndex(
  machine: Machine,
  mondayFirstIndex: number,
): boolean {
  if (!machine.days || machine.days.length !== 7) {
    return true;
  }
  return machine.days.charAt(mondayFirstIndex) !== '0';
}

/**
 * Determines whether an individual calendar cell (machine on a given date) is open for reservations.
 *
 * Invariant:
 * A cell is only bookable if the machine is both operational on that weekday AND not blocked by maintenance or breakdown.
 */
export function isCellBookable(machine: Machine, isoDate: string): boolean {
  return !isMachineBlockedOnDate(machine, isoDate) && isMachineAvailableOnWeekday(machine, isoDate);
}

// ---------------------------------------------------------------------------------------
// 3. Write-Path Reducers (Mutations)
// ---------------------------------------------------------------------------------------

/**
 * Updates a machine entity with validated values from the machine management form.
 *
 * Invariant:
 * Synchronizes core properties (`name`, `group`, `info`), updates optional configuration attributes
 * (redundancy group, weekday operating mask, maintenance intervals), and purges superseded legacy fields.
 */
export function applyFormFieldsToMachine(machine: Machine, form: MachineForm): void {
  machine.name = form.name;
  machine.group = form.group;
  machine.info = form.info;

  if (form.redu) {
    machine.redu = form.redu;
  } else {
    delete machine.redu;
  }

  if (form.daysMask) {
    machine.days = form.daysMask;
  } else {
    delete machine.days;
  }

  if (form.maint && form.maint.length > 0) {
    machine.maint = form.maint;
  } else {
    delete machine.maint;
  }

  delete machine.status;
  delete machine.statusNote;
  delete machine.statusFrom;
  delete machine.statusUntil;

  if (form.cat === 'messtechnik') {
    machine.cat = 'messtechnik';
  } else {
    delete machine.cat;
  }
}

/**
 * Computes a deterministic 6-character hexadecimal hash using the DJB2 hashing algorithm.
 * Used as a collision-free ID fallback when machine names cannot be transliterated into ASCII slugs.
 */
function generateShortHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Generates a stable, URL-safe resource identifier from a human-readable machine name.
 *
 * Multi-Language Strategy:
 * 1. Standardizes Latin names by expanding German umlauts (`ä` -> `ae`) and stripping diacritics via Unicode NFKD.
 * 2. Produces clean, readable ASCII slugs (e.g. "5-Achs Fräse" -> "5-achs-fraese").
 * 3. Fallback for Non-Latin Scripts: If the machine name consists entirely of non-Latin characters
 *    (such as Cyrillic, Chinese, Arabic, or symbols), a deterministic unique hash (e.g. "m_8f2a1c")
 *    is produced instead of a generic placeholder, preventing ID collisions.
 */
export function generateMachineIdFromName(name: string): string {
  if (!name || typeof name !== 'string') {
    return 'machine';
  }

  const trimmed = name.trim().toLowerCase();

  const umlautsExpanded = trimmed
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');

  const asciiNormalized = umlautsExpanded.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

  const slug = asciiNormalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  if (slug.length > 0) {
    return slug;
  }

  return `m_${generateShortHash(trimmed)}`;
}

/**
 * Resolves naming collisions by verifying that the candidate machine ID is globally unique across the workspace.
 * If another machine already uses the desired ID, appends incrementing numeric suffixes (`-2`, `-3`, ...) until an available ID is found.
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
 * Determines the insertion index for a new machine to preserve department grouping in the UI.
 *
 * Business Rule:
 * New machines are positioned immediately following existing machines belonging to the same department group.
 * If the machine belongs to a brand new department, it is appended to the end of the list.
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
 * Persists machine configuration changes to the in-memory dataset:
 * - Update Mode (`machineId` is provided): Modifies the existing machine entity in place.
 * - Create Mode (`machineId` is null): Derives a unique ID from the machine name and inserts it into its department group.
 */
export function saveMachine(
  data: BookingData,
  machineId: string | null,
  form: MachineForm,
): { abort: true } | void {
  if (machineId) {
    const existingMachine = data.machines.find((candidate) => candidate.id === machineId);
    if (!existingMachine) {
      return { abort: true };
    }
    applyFormFieldsToMachine(existingMachine, form);
    return;
  }

  const desiredId = generateMachineIdFromName(form.name);
  const uniqueMachineId = ensureUniqueMachineId(data.machines, desiredId);
  const insertionIndex = findGroupInsertionIndex(data.machines, form.group);

  const newMachine: Machine = { id: uniqueMachineId, name: form.name, group: form.group };
  applyFormFieldsToMachine(newMachine, form);
  data.machines.splice(insertionIndex, 0, newMachine);
}

/**
 * Permanently removes a machine from the resource registry and deletes all corresponding reservations.
 * Returns `{ abort: true }` if the target machine was not found in the dataset.
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
 * Adjusts the display sequence of a machine by swapping positions with its immediate neighbor within the same department.
 *
 * Business Rules & Invariants:
 * 1. Existence: The requested machine must exist in the dataset.
 * 2. Bounds: Movement cannot exceed array limits (cannot move above the first item or below the last).
 * 3. Department Isolation: Machines can only be reordered within their own department group. Cross-group swaps are rejected.
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

  const targetNeighborIndex = currentIndex + direction;

  const isOutOfBounds = targetNeighborIndex < 0 || targetNeighborIndex >= machines.length;
  if (isOutOfBounds) {
    return { abort: true };
  }

  const currentMachine = machines[currentIndex]!;
  const neighborMachine = machines[targetNeighborIndex]!;

  const isDifferentGroup = currentMachine.group !== neighborMachine.group;
  if (isDifferentGroup) {
    return { abort: true };
  }

  machines[currentIndex] = neighborMachine;
  machines[targetNeighborIndex] = currentMachine;
}
/** Shared list membership: favorites appear once, separately from category departments. */
export function partitionFavoriteMachines(
  machines: readonly Machine[],
  favoriteIds: ReadonlySet<string>,
) {
  return {
    favorites: machines.filter((machine) => favoriteIds.has(machine.id)),
    rest: machines.filter((machine) => !favoriteIds.has(machine.id)),
  };
}
