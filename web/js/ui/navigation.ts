// =======================================================================================
// DATE NAVIGATION MODULE (web/js/ui/navigation.ts)
// =======================================================================================
//
// The "next free working day" scans behind the ⏭/⏮ per-machine jump buttons: walks the
// calendar from an anchor date until a day the machine is bookable is found.
//
// Key Principles:
// - PURE SCAN, INJECTED AVAILABILITY: this module is pure over `shared/dates` plus an
//   injected free-day predicate (`FreeDay`) — the actual booking/blocking/day-availability
//   lookups, and every side effect of a real jump (scrolling, repainting the selection,
//   toasting, the `nextFreePtr` bookkeeping), live in `ui/favorite-jump.ts`.
// - WEEKENDS ARE ALWAYS SKIPPED: the scan hops Sat/Sun regardless of whether weekend
//   columns are currently shown in the grid — "next free day" means the next free WORKDAY.
//
// =======================================================================================

import {
  parseIsoDateString,
  addDays,
  formatDateAsIsoString,
  isWeekend,
} from '../../../shared/dates.ts';

/** Predicate: is this working day (ISO `YYYY-MM-DD`) bookable for the machine in question? */
export type FreeDay = (iso: string) => boolean;

/**
 * Finds the next free working day strictly after `fromIso` — or from `today` inclusive when
 * `fromIso` is null, i.e. the first jump on a machine that has no pointer yet — skipping
 * weekends, searching up to `horizon` days ahead. Returns the ISO date, or null if none is
 * found within that horizon.
 */
export function nextFreeDay(
  fromIso: string | null,
  today: string,
  isFree: FreeDay,
  horizon = 730,
): string | null {
  let candidateDate = fromIso ? addDays(parseIsoDateString(fromIso), 1) : parseIsoDateString(today);
  for (let daysChecked = 0; daysChecked < horizon; daysChecked++) {
    if (!isWeekend(candidateDate)) {
      const candidateIsoDate = formatDateAsIsoString(candidateDate);
      if (isFree(candidateIsoDate)) return candidateIsoDate;
    }
    candidateDate = addDays(candidateDate, 1);
  }
  return null;
}

/** Finds the previous free working day strictly before `fromIso` but not earlier than
 *  `today`, skipping weekends. Returns the ISO date, or null if none — the caller only ever
 *  invokes this with a real anchor (the pointer left by a prior forward jump), never null. */
export function prevFreeDay(fromIso: string, today: string, isFree: FreeDay): string | null {
  let candidateDate = addDays(parseIsoDateString(fromIso), -1);
  while (formatDateAsIsoString(candidateDate) >= today) {
    if (!isWeekend(candidateDate)) {
      const candidateIsoDate = formatDateAsIsoString(candidateDate);
      if (isFree(candidateIsoDate)) return candidateIsoDate;
    }
    candidateDate = addDays(candidateDate, -1);
  }
  return null;
}
