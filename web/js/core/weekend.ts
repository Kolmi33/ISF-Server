// Pure weekend-bridge logic extracted from the monolith (legacy.js). No DOM, no I/O.
//
// A weekend day (Sat/Sun) only belongs in the plan as part of a continuous booking
// series that spans it — i.e. the Friday before AND the Monday after are also booked.
// sweepWeekends removes orphaned weekend days (series broken on one side). It mutates
// the passed-in bookings (deletes keys) and returns undo entries, exactly as the
// original — the caller relies on that contract.

import type { BookingData } from '../../../shared/types.ts';
import { parseIsoDateString, formatDateAsIsoString, addDays } from './dates.ts';

/** An orphaned weekend day that was removed, with the previous value for undo. */
export interface WeekendUndo {
  mid: string;
  date: string;
  prev: { name: string; ts?: string };
}

/**
 * Remove orphaned Sat/Sun entries for machine `mid`: a weekend day survives only while
 * both the Friday before and the Monday after are booked (by anyone). Mutates
 * `fresh.bookings[mid]`; returns the removed entries as undo records.
 */
export function sweepWeekends(fresh: BookingData, mid: string): WeekendUndo[] {
  const mb = fresh.bookings[mid];
  if (!mb) return [];
  const undo: WeekendUndo[] = [];
  for (const [d, prev] of Object.entries(mb)) {
    const dt = parseIsoDateString(d);
    const wd = dt.getUTCDay();
    if (wd !== 0 && wd !== 6) continue;
    const fri = formatDateAsIsoString(addDays(dt, wd === 6 ? -1 : -2));
    const mon = formatDateAsIsoString(addDays(dt, wd === 6 ? 2 : 1));
    // The bridge holds as long as Friday AND Monday are booked (any person).
    if (!(mb[fri] && mb[mon])) {
      undo.push({ mid, date: d, prev: { ...prev } });
      delete mb[d];
    }
  }
  return undo;
}
