// Pure machine logic extracted from the monolith (legacy.js): resource category and
// the maintenance / weekday-availability predicates that decide whether a cell is
// bookable. No DOM, no global state — data → data. (Machine lookup by id and the
// German status-text formatters stay out: the former reads app state, the latter are
// presentation and move with the views.)
//
// Naming note: `categoryOf`, `maintenanceSlots`, `maintenanceSlotAt`, `isBlockedOnDate`
// and `hasAnyMaintenanceSlot` are each called by their OLD abbreviated name (`catOf`,
// `maintSlots`, `maintAt`, `isBlockedM`, `anyMaint`) dozens of times across `legacy.js`,
// via the window bridge. Those old names survive only as the aliases at the bottom of
// this file; `legacy.js` itself is not edited (E3/E8 — deleted whole in Phase 7 slice
// B10). `dayAvailable`, `slotCovers` and `cellBookable` were already full words, so they
// keep their names.

import type { Machine, MaintSlot, MachineCategory } from '../../../shared/types.ts';
import { parseIsoDateString } from './dates.ts';

/** A machine's category: 'messtechnik' for measurement devices, else 'maschine'. */
export function categoryOf(machine: Machine | null | undefined): MachineCategory {
  return machine && machine.cat === 'messtechnik' ? 'messtechnik' : 'maschine';
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
  // getUTCDay() returns Sunday=0..Saturday=6; shift it so the mask's Monday-first
  // character order (Mo..So) lines up with the right index.
  const weekdayWithMondayFirst = (parseIsoDateString(isoDate).getUTCDay() + 6) % 7;
  return machine.days.charAt(weekdayWithMondayFirst) !== '0';
}

/** True if a cell is bookable: not blocked AND available on that weekday. */
export function cellBookable(machine: Machine, isoDate: string): boolean {
  return !isBlockedOnDate(machine, isoDate) && dayAvailable(machine, isoDate);
}

// ---- Legacy bridge aliases -------------------------------------------------------
// `legacy.js` calls these by their OLD abbreviated names as bare globals (see app.ts's
// `Object.assign(window, machines)`) and is deliberately NOT edited by this pass — it
// is retired whole in Phase 7 slice B10. Delete this entire block in that slice. No new
// code may import from here.
export const catOf = categoryOf;
export const maintSlots = maintenanceSlots;
export const maintAt = maintenanceSlotAt;
export const isBlockedM = isBlockedOnDate;
export const anyMaint = hasAnyMaintenanceSlot;
