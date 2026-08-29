// The statistics view model (Phase 4.3). The stats modal's segmented UI, drilldown, folding and
// per-mode row markup stay in the legacy adapter; what moves here is the pure aggregation kernel it
// builds once per date range: per-machine booking counts + who booked them, a person index, and the
// maintenance/downtime tally. Pure over `core/dates` + `core/machines`; the ordered machines,
// bookings and the (already-validated) from/to range are injected (E4). Faithful port of the stats
// `compute()` closure in legacy — the DOM read of the range and the `f>o` validation stay in legacy.

import type { Machine, Bookings } from '../../../../shared/types.ts';
import { weekdayRange, allDaysRange } from '../../core/dates.ts';
import { maintSlots, isBlockedM } from '../../core/machines.ts';

/** One person's day count on a single machine (the per-machine drilldown row). */
export interface StatsPersonDays {
  name: string;
  days: number;
}
/** A person across all machines: total booked machine-days + a per-machine breakdown. */
export interface StatsPerson {
  name: string;
  days: number;
  machines: Map<string, number>;
}
/** A machine's utilisation over the range: booked workdays `n`, percent, and who booked them. */
export interface StatsMachineRow {
  m: Machine;
  n: number;
  pct: number;
  persons: Map<string, StatsPersonDays>;
}
/** A machine's maintenance/downtime over the range: intersecting slots + blocked calendar days. */
export interface StatsMaintRow {
  m: Machine;
  inst: number;
  days: number;
}
/** The full aggregation the stats modal renders from (all four modes share it). */
export interface Stats {
  days: string[];
  machRows: StatsMachineRow[];
  persons: Map<string, StatsPerson>;
  maint: { rows: StatsMaintRow[]; inst: number; days: number };
}

function aggregateBookings(
  machines: readonly Machine[],
  bookings: Bookings,
  days: string[],
): { machRows: StatsMachineRow[]; persons: Map<string, StatsPerson> } {
  const machRows: StatsMachineRow[] = [];
  const persons = new Map<string, StatsPerson>();
  for (const m of machines) {
    const mb = bookings[m.id] || {};
    let n = 0;
    const pmap = new Map<string, StatsPersonDays>();
    for (const d of days) {
      const b = mb[d];
      if (!b || !b.name) continue;
      n++;
      const k = b.name.toLowerCase();
      pmap.set(k, { name: b.name, days: (pmap.get(k)?.days ?? 0) + 1 });
      if (!persons.has(k)) persons.set(k, { name: b.name, days: 0, machines: new Map() });
      const e = persons.get(k)!;
      e.days++;
      e.machines.set(m.name, (e.machines.get(m.name) || 0) + 1);
    }
    machRows.push({
      m,
      n,
      pct: days.length ? Math.round((n * 100) / days.length) : 0,
      persons: pmap,
    });
  }
  return { machRows, persons };
}

function aggregateMaint(
  machines: readonly Machine[],
  from: string,
  to: string,
  calDays: string[],
): Stats['maint'] {
  const rows: StatsMaintRow[] = [];
  let inst = 0;
  let days = 0;
  for (const m of machines) {
    const inRange = maintSlots(m).filter(
      (s) => (!s.until || s.until >= from) && (!s.from || s.from <= to),
    );
    let dc = 0;
    for (const d of calDays) if (isBlockedM(m, d)) dc++;
    if (inRange.length || dc) {
      rows.push({ m, inst: inRange.length, days: dc });
      inst += inRange.length;
      days += dc;
    }
  }
  return { rows, inst, days };
}

/**
 * Aggregate bookings + maintenance over the (validated) `from`..`to` range. `days` counts only
 * weekdays (utilisation denominator); `maint.days` counts blocked *calendar* days. Faithful port
 * of legacy stats `compute()`.
 */
export function computeStats(
  machines: readonly Machine[],
  bookings: Bookings,
  from: string,
  to: string,
): Stats {
  const days = weekdayRange(from, to);
  const calDays = allDaysRange(from, to);
  const { machRows, persons } = aggregateBookings(machines, bookings, days);
  const maint = aggregateMaint(machines, from, to, calDays);
  return { days, machRows, persons, maint };
}
