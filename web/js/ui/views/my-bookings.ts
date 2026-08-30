// The "My bookings" view model (Phase 4.3). The modal itself — the `openModal(html)` shell, the
// expand/goto/delete wiring — stays in the legacy adapter; what moves here is the pure kernel that
// turns the raw state into the list the modal draws: the current user's future bookings, grouped
// into consecutive-workday runs (series). Pure over `core/dates`; the machine order, bookings, user
// and today are injected (E4). Faithful port of legacy `computeMyRuns`.

import type { Machine, Bookings } from '../../../../shared/types.ts';
import { parseIsoDateString, addDays, isWeekend, formatDateAsIsoString } from '../../core/dates.ts';

/** A run of consecutive workdays the user has booked on one machine (a bookable "series"). */
export interface BookingRun {
  m: Machine;
  dates: string[];
}

/**
 * Group the user's future bookings into consecutive-workday runs. For each machine (in the given
 * display order) it takes that user's bookings from `today` onward, drops weekends, and splits the
 * sorted days into runs where each day is the next workday after the previous one (so Fri→Mon is
 * one run). Runs are returned sorted by their first date. Faithful port of legacy `computeMyRuns`.
 */
export function computeMyRuns(
  machines: readonly Machine[],
  bookings: Bookings,
  user: string,
  today: string,
): BookingRun[] {
  const pl = user.toLowerCase();
  const nextWorkday = (isoDateString: string): string => {
    let candidateDate = addDays(parseIsoDateString(isoDateString), 1);
    while (isWeekend(candidateDate)) {
      candidateDate = addDays(candidateDate, 1);
    }
    return formatDateAsIsoString(candidateDate);
  };
  const runs: BookingRun[] = [];
  for (const m of machines) {
    const mb = bookings[m.id] || {};
    const ds = Object.keys(mb)
      .filter(
        (d) => d >= today && !isWeekend(parseIsoDateString(d)) && mb[d]!.name.toLowerCase() === pl,
      )
      .sort();
    let cur: string[] = [];
    for (const d of ds) {
      if (cur.length && nextWorkday(cur[cur.length - 1]!) === d) cur.push(d);
      else {
        if (cur.length) runs.push({ m, dates: cur });
        cur = [d];
      }
    }
    if (cur.length) runs.push({ m, dates: cur });
  }
  runs.sort((a, b) => (a.dates[0]! < b.dates[0]! ? -1 : 1));
  return runs;
}
