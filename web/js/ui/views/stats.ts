// =======================================================================================
// STATS VIEW MODEL MODULE (web/js/ui/views/stats.ts)
// =======================================================================================
//
// The statistics view model: the pure aggregation kernel built once per date range —
// per-machine booking + blocked-day counts and a person index — plus the row-building/
// filter/sort logic the Ressourcen overview and both drilldowns render from. Maintenance is
// folded directly into each machine's own row (a stacked Used/Wartung/Frei bar) rather than
// living as a separate mode/list — a resource's downtime is a state of that resource, not a
// bookable category of its own (user request).
//
// =======================================================================================

import type { Machine, Bookings, MachineCategory } from '../../../../shared/types.ts';
import { getWeekdaysInRange } from '../../../../shared/dates.ts';
import { isMachineBlockedOnDate, getMachineCategory } from '../../core/machines.ts';

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
/** A machine's utilisation over the range: booked workdays, blocked (maintenance) workdays,
 *  percent booked, and who booked it. `blockedWorkdayCount` only counts workdays that are
 *  blocked and NOT also booked — an (invalid, but possible) day that's somehow both counts as
 *  booked, matching the grid's own "a real booking always wins" priority rule elsewhere. */
export interface StatsMachineRow {
  machine: Machine;
  bookedWorkdayCount: number;
  blockedWorkdayCount: number;
  percent: number;
  persons: Map<string, StatsPersonDays>;
}
/** The full aggregation the stats modal renders from. */
export interface Stats {
  days: string[];
  machRows: StatsMachineRow[];
  persons: Map<string, StatsPerson>;
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
    let blockedWorkdayCount = 0;
    const personDaysOnThisMachine = new Map<string, StatsPersonDays>();
    for (const date of days) {
      const booking = machineBookings[date];
      if (!booking || !booking.name) {
        if (isMachineBlockedOnDate(machine, date)) blockedWorkdayCount++;
        continue;
      }
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
      machine,
      bookedWorkdayCount,
      blockedWorkdayCount,
      percent: days.length ? Math.round((bookedWorkdayCount * 100) / days.length) : 0,
      persons: personDaysOnThisMachine,
    });
  }
  return { machRows, persons };
}

/**
 * Aggregates bookings over the (already-validated) `from`..`to` range. `days` counts only
 * weekdays — the shared denominator for both the booked and blocked-by-maintenance shares of
 * each machine's stacked utilisation bar.
 */
export function computeStats(
  machines: readonly Machine[],
  bookings: Bookings,
  from: string,
  to: string,
): Stats {
  const days = getWeekdaysInRange(from, to);
  const { machRows, persons } = aggregateBookings(machines, bookings, days);
  return { days, machRows, persons };
}

// ---- The "Ressourcen" mode's group folding ----------------------------------

/** One row of the Ressourcen-mode list: a group header or one machine's utilisation row.
 *  Mirrors `ui/grid.ts`'s `GridRow` — the same "emit a flat list of header/data rows, let the
 *  renderer just map over it" shape. No category level here: the category is chosen by the
 *  modal's own top-level tabs (`StatsControls.tsx`) now, not filtered/folded per row — only
 *  one category's machines are ever passed in to begin with. */
export type ResourceRow =
  | { kind: 'group'; group: string; collapsed: boolean; averagePercent: number }
  | { kind: 'machine'; row: StatsMachineRow };

export interface BuildResourceRowsOptions {
  /** Case-insensitive substring filter on the machine name (the "filtern…" box). */
  filterQuery: string;
  /** Which category's machines to include — the modal's own top-level tab selection. */
  activeCategory: MachineCategory;
  /** Folded group keys, as `g:<group>`. */
  closedKeys: ReadonlySet<string>;
}

function average(values: readonly number[]): number {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

/**
 * Buckets the active category's matching rows by group, preserving first-seen order.
 */
function bucketResourceRows(
  machRows: readonly StatsMachineRow[],
  filterQuery: string,
  activeCategory: MachineCategory,
): { groupsInOrder: string[]; rowsByGroup: Map<string, StatsMachineRow[]> } {
  const lowercaseQuery = filterQuery.trim().toLowerCase();
  const groupsInOrder: string[] = [];
  const rowsByGroup = new Map<string, StatsMachineRow[]>();
  for (const row of machRows) {
    if (lowercaseQuery && !row.machine.name.toLowerCase().includes(lowercaseQuery)) continue;
    if (getMachineCategory(row.machine) !== activeCategory) continue;
    const group = row.machine.group;
    if (!rowsByGroup.has(group)) {
      rowsByGroup.set(group, []);
      groupsInOrder.push(group);
    }
    rowsByGroup.get(group)!.push(row);
  }
  return { groupsInOrder, rowsByGroup };
}

/**
 * Builds the Ressourcen-mode list for the active category, grouped, each group foldable and
 * carrying its own average utilisation. Folding a group hides its machine rows; the group
 * header itself always stays visible so it can be unfolded again.
 */
export function buildResourceRows(
  machRows: readonly StatsMachineRow[],
  options: BuildResourceRowsOptions,
): ResourceRow[] {
  const { filterQuery, activeCategory, closedKeys } = options;
  const { groupsInOrder, rowsByGroup } = bucketResourceRows(machRows, filterQuery, activeCategory);

  const rows: ResourceRow[] = [];
  for (const group of groupsInOrder) {
    const rowsInGroup = rowsByGroup
      .get(group)!
      .slice()
      .sort((a, b) => b.percent - a.percent || a.machine.name.localeCompare(b.machine.name, 'de'));
    const groupClosed = closedKeys.has(`g:${group}`);
    rows.push({
      kind: 'group',
      group,
      collapsed: groupClosed,
      averagePercent: average(rowsInGroup.map((row) => row.percent)),
    });
    if (groupClosed) continue; // the group header stays; only its machine rows hide

    for (const row of rowsInGroup) rows.push({ kind: 'machine', row });
  }
  return rows;
}

// ---- The "Personen" overview mode's filter + sort ---------------------

/**
 * Builds the Personen-mode overview list: people matching `filterQuery` (name,
 * case-insensitive substring), most booked days first, then German name order.
 */
export function buildPersonRows(
  persons: ReadonlyMap<string, StatsPerson>,
  filterQuery: string,
): StatsPerson[] {
  const lowercaseQuery = filterQuery.trim().toLowerCase();
  return [...persons.values()]
    .filter((person) => !lowercaseQuery || person.name.toLowerCase().includes(lowercaseQuery))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'de'));
}
