// The statistics view model (Phase 4.3). The stats modal's segmented UI, drilldown, folding and
// per-mode row markup stay in the legacy adapter; what moves here is the pure aggregation kernel it
// builds once per date range: per-machine booking counts + who booked them, a person index, and the
// maintenance/downtime tally. Pure over `core/dates` + `core/machines`; the ordered machines,
// bookings and the (already-validated) from/to range are injected (E4). Faithful port of the stats
// `compute()` closure in legacy — the DOM read of the range and the `f>o` validation stay in legacy.

import type { Machine, Bookings } from '../../../../shared/types.ts';
import { getWeekdaysInRange, getAllDaysInRange } from '../../core/dates.ts';
import { maintenanceSlots, isBlockedOnDate } from '../../core/machines.ts';

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
  for (const machine of machines) {
    const machineBookings = bookings[machine.id] || {};
    let bookedWorkdayCount = 0;
    const personDaysOnThisMachine = new Map<string, StatsPersonDays>();
    for (const date of days) {
      const booking = machineBookings[date];
      if (!booking || !booking.name) continue;
      bookedWorkdayCount++;
      const personKey = booking.name.toLowerCase();

      // Tally this person's days on this one machine (the per-machine drilldown row).
      const priorDaysOnThisMachine = personDaysOnThisMachine.get(personKey)?.days ?? 0;
      personDaysOnThisMachine.set(personKey, {
        name: booking.name,
        days: priorDaysOnThisMachine + 1,
      });

      // Also tally this person's cross-machine total (the persons-mode overview).
      if (!persons.has(personKey)) {
        persons.set(personKey, { name: booking.name, days: 0, machines: new Map() });
      }
      const personEntry = persons.get(personKey)!;
      personEntry.days++;
      personEntry.machines.set(machine.name, (personEntry.machines.get(machine.name) || 0) + 1);
    }
    machRows.push({
      m: machine,
      n: bookedWorkdayCount,
      pct: days.length ? Math.round((bookedWorkdayCount * 100) / days.length) : 0,
      persons: personDaysOnThisMachine,
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
  let totalSlotCount = 0;
  let totalBlockedDayCount = 0;
  for (const machine of machines) {
    const slotsInRange = maintenanceSlots(machine).filter(
      (slot) => (!slot.until || slot.until >= from) && (!slot.from || slot.from <= to),
    );
    let blockedDayCount = 0;
    for (const date of calDays) {
      if (isBlockedOnDate(machine, date)) blockedDayCount++;
    }
    if (slotsInRange.length || blockedDayCount) {
      rows.push({ m: machine, inst: slotsInRange.length, days: blockedDayCount });
      totalSlotCount += slotsInRange.length;
      totalBlockedDayCount += blockedDayCount;
    }
  }
  return { rows, inst: totalSlotCount, days: totalBlockedDayCount };
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
  const days = getWeekdaysInRange(from, to);
  const calDays = getAllDaysInRange(from, to);
  const { machRows, persons } = aggregateBookings(machines, bookings, days);
  const maint = aggregateMaint(machines, from, to, calDays);
  return { days, machRows, persons, maint };
}
