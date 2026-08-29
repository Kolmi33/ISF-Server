// Date-navigation geometry (Phase 4.2b). The "next free working day" scans behind the ⏭/⏮
// per-machine jump buttons: walk the calendar from an anchor date until a day the machine is
// bookable is found. The scan is pure over `core/dates` plus an injected free-day predicate
// (E4) — the booking / blocking / day-availability lookups stay in the legacy adapter, as do
// every side effect of an actual jump (scroll, window rebuild, `paintSel`, `toast`, and the
// `nextFreePtr` bookkeeping). Weekends are skipped here, faithful to legacy: the scan hops
// Sat/Sun regardless of whether weekend columns are currently shown.

import { parseYmd, addDays, ymd, isWeekend } from '../core/dates.ts';

/** Predicate: is this working day (ISO `YYYY-MM-DD`) bookable for the machine in question? */
export type FreeDay = (iso: string) => boolean;

/**
 * The next free working day strictly after `fromIso` — or from `today` inclusive when `fromIso`
 * is null (the first jump on a machine) — skipping weekends, searching up to `horizon` days.
 * Returns the ISO date, or null if none is found in range. Faithful port of `nextFreeAfter`.
 */
export function nextFreeDay(
  fromIso: string | null,
  today: string,
  isFree: FreeDay,
  horizon = 730,
): string | null {
  let d = fromIso ? addDays(parseYmd(fromIso), 1) : parseYmd(today);
  for (let i = 0; i < horizon; i++) {
    if (!isWeekend(d)) {
      const iso = ymd(d);
      if (isFree(iso)) return iso;
    }
    d = addDays(d, 1);
  }
  return null;
}

/**
 * The previous free working day strictly before `fromIso` but not earlier than `today`, skipping
 * weekends. Returns the ISO date, or null if none. Faithful port of `prevFreeBefore` (the caller
 * only invokes it with a real anchor — the pointer set by a prior forward jump).
 */
export function prevFreeDay(fromIso: string, today: string, isFree: FreeDay): string | null {
  let d = addDays(parseYmd(fromIso), -1);
  while (ymd(d) >= today) {
    if (!isWeekend(d)) {
      const iso = ymd(d);
      if (isFree(iso)) return iso;
    }
    d = addDays(d, -1);
  }
  return null;
}
