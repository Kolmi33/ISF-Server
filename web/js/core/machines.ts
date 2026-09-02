// Pure machine logic extracted from the original monolith: resource category and
// the maintenance / weekday-availability predicates that decide whether a cell is
// bookable. No DOM, no global state — data → data. (Machine lookup by id and the
// German status-text formatters stay out: the former reads app state, the latter are
// presentation and move with the views.)
//
// `categoryOf`/`maintenanceSlots`/`maintenanceSlotAt`/`isBlockedOnDate`/
// `hasAnyMaintenanceSlot` were each called by an old abbreviated name (`catOf`/
// `maintSlots`/`maintAt`/`isBlockedM`/`anyMaint`) dozens of times across `legacy.js`, via
// window-bridge aliases — retired along with `legacy.js` itself in Phase 7 slice B10g.

import type { Machine, MaintSlot, MachineCategory } from '../../../shared/types.ts';
import { mondayFirstWeekdayIndex, parseIsoDateString } from '../../../shared/dates.ts';

/** A machine's category: 'messtechnik' for measurement devices, else 'maschine'. */
export function categoryOf(machine: Machine | null | undefined): MachineCategory {
  return machine && machine.cat === 'messtechnik' ? 'messtechnik' : 'maschine';
}

/** The two categories, in display order, with their German label and sprite icon. Faithful
 *  port of legacy's `CATS`/`catLabel`/`catIco`. Shared by the grid's category toggle buttons
 *  (B1) and the Statistik category filter (B5). */
export const CATEGORIES: ReadonlyArray<{ id: MachineCategory; label: string; icon: string }> = [
  { id: 'maschine', label: 'Maschinen', icon: 'factory' },
  { id: 'messtechnik', label: 'Messtechnik', icon: 'gauge' },
];

/** One category's distinct group names (first-seen order), for the "Bereich" filter's
 *  `<optgroup>` structure. A category with no groups is omitted entirely (legacy renders an
 *  empty `<optgroup>`, which shows nothing — omitting it is the same net result). Faithful
 *  port of the `CATS.map(...)`/`groupList()`/`groupCat()` expression in legacy
 *  `openAllBookings`. */
export interface CategoryGroups {
  category: MachineCategory;
  groups: string[];
}

export function groupsByCategory(machines: readonly Machine[]): CategoryGroups[] {
  const result: CategoryGroups[] = [];
  for (const { id: category } of CATEGORIES) {
    const seen = new Set<string>();
    const groups: string[] = [];
    for (const machine of machines) {
      if (categoryOf(machine) !== category || seen.has(machine.group)) continue;
      seen.add(machine.group);
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
