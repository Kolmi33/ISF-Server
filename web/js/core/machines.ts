// Pure machine logic extracted from the monolith (legacy.js): resource category and
// the maintenance / weekday-availability predicates that decide whether a cell is
// bookable. No DOM, no global state — data → data. (Machine lookup by id and the
// German status-text formatters stay out: the former reads app state, the latter are
// presentation and move with the views.)

import type { Machine, MaintSlot, MachineCategory } from '../../../shared/types.ts';
import { parseIsoDateString } from './dates.ts';

/** A machine's category: 'messtechnik' for measurement devices, else 'maschine'. */
export function catOf(m: Machine | null | undefined): MachineCategory {
  return m && m.cat === 'messtechnik' ? 'messtechnik' : 'maschine';
}

/**
 * The maintenance slots of a machine. Prefers the structured `maint` array; otherwise
 * synthesizes one slot from the legacy single-status fields (unless status is 'ok').
 */
export function maintSlots(m: Machine): MaintSlot[] {
  if (Array.isArray(m.maint)) return m.maint;
  if (m.status && m.status !== 'ok') {
    return [
      {
        type: m.status,
        from: m.statusFrom || '',
        until: m.statusUntil || '',
        note: m.statusNote || '',
      },
    ];
  }
  return [];
}

/** True if slot `s` covers ISO date `d` (open-ended when a bound is empty). */
export function slotCovers(s: MaintSlot, d: string): boolean {
  return (!s.from || d >= s.from) && (!s.until || d <= s.until);
}

/** The maintenance slot covering `d`, or null if none. */
export function maintAt(m: Machine, d: string): MaintSlot | null {
  for (const s of maintSlots(m)) if (slotCovers(s, d)) return s;
  return null;
}

/** True if the machine is blocked (maintenance/defect) on ISO date `d`. */
export function isBlockedM(m: Machine, d: string): boolean {
  return !!maintAt(m, d);
}

/** True if the machine has any maintenance slot at all. */
export function anyMaint(m: Machine): boolean {
  return maintSlots(m).length > 0;
}

/**
 * True if the machine is available on the weekday of ISO date `d`, per its `days` mask
 * (Mo..So, '1' = available). A missing or malformed mask means available every day.
 */
export function dayAvailable(m: Machine, d: string): boolean {
  if (!m.days || m.days.length !== 7) return true;
  const wd = (parseIsoDateString(d).getUTCDay() + 6) % 7; // Mo=0 … So=6
  return m.days.charAt(wd) !== '0';
}

/** True if a cell is bookable: not blocked AND available on that weekday. */
export function cellBookable(m: Machine, d: string): boolean {
  return !isBlockedM(m, d) && dayAvailable(m, d);
}
