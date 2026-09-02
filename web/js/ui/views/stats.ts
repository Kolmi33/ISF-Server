// The statistics view model (Phase 4.3). The stats modal's segmented UI, drilldown, folding and
// per-mode row markup stay in the legacy adapter; what moves here is the pure aggregation kernel it
// builds once per date range: per-machine booking counts + who booked them, a person index, and the
// maintenance/downtime tally. Pure over `core/dates` + `core/machines`; the ordered machines,
// bookings and the (already-validated) from/to range are injected (E4). Faithful port of the stats
// `compute()` closure in legacy — the DOM read of the range and the `f>o` validation stay in legacy.

import type { Machine, Bookings, MachineCategory } from '../../../../shared/types.ts';
import { getWeekdaysInRange, getAllDaysInRange } from '../../../../shared/dates.ts';
import {
  getMaintenanceSlots,
  isMachineBlockedOnDate,
  getMachineCategory,
} from '../../core/machines.ts';

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
/** A machine's utilisation over the range: booked workdays, percent, and who booked them. */
export interface StatsMachineRow {
  machine: Machine;
  bookedWorkdayCount: number;
  percent: number;
  persons: Map<string, StatsPersonDays>;
}
/** A machine's maintenance/downtime over the range: intersecting slots + blocked calendar days. */
export interface StatsMaintRow {
  machine: Machine;
  slotCount: number;
  days: number;
}
/** The full aggregation the stats modal renders from (all four modes share it). */
export interface Stats {
  days: string[];
  machRows: StatsMachineRow[];
  persons: Map<string, StatsPerson>;
  maint: { rows: StatsMaintRow[]; slotCount: number; days: number };
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
      machine,
      bookedWorkdayCount,
      percent: days.length ? Math.round((bookedWorkdayCount * 100) / days.length) : 0,
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
    const slotsInRange = getMaintenanceSlots(machine).filter(
      (slot) => (!slot.until || slot.until >= from) && (!slot.from || slot.from <= to),
    );
    let blockedDayCount = 0;
    for (const date of calDays) {
      if (isMachineBlockedOnDate(machine, date)) blockedDayCount++;
    }
    if (slotsInRange.length || blockedDayCount) {
      rows.push({ machine, slotCount: slotsInRange.length, days: blockedDayCount });
      totalSlotCount += slotsInRange.length;
      totalBlockedDayCount += blockedDayCount;
    }
  }
  return { rows, slotCount: totalSlotCount, days: totalBlockedDayCount };
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

// ---- The "Ressourcen" mode's category/group folding ----------------------------------

/** One row of the Ressourcen-mode list: a category header, a group header, or one machine's
 *  utilisation row. Mirrors `ui/grid.ts`'s `GridRow` — the same "emit a flat list of header/
 *  data rows, let the renderer just map over it" shape, for the same reason: the fold state
 *  machine below is the trickiest part of this view to port faithfully, so it gets its own
 *  pure function and its own tests instead of being re-derived inline in JSX. */
export type ResourceRow =
  | { kind: 'category'; category: MachineCategory; collapsed: boolean; averagePercent: number }
  | { kind: 'group'; group: string; collapsed: boolean; averagePercent: number }
  | { kind: 'machine'; row: StatsMachineRow };

export interface BuildResourceRowsOptions {
  /** Case-insensitive substring filter on the machine name (the "filtern…" box). */
  filterQuery: string;
  /** Categories the show/hide segmented buttons currently have on. */
  visibleCategories: ReadonlySet<string>;
  /** Folded category/group keys, as `c:<category>` or `g:<group>`. */
  closedKeys: ReadonlySet<string>;
}

function average(values: readonly number[]): number {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

interface ResourceRowBuckets {
  categoriesInOrder: MachineCategory[];
  groupsByCategory: Map<MachineCategory, string[]>;
  rowsByGroupInCategory: Map<string, StatsMachineRow[]>;
}

/**
 * Bucket the matching rows by category, then by group, preserving first-seen order. Legacy
 * buckets by the bare group NAME across categories — a real (if obscure) bug there: a group
 * name shared by a "Maschinen" resource and a "Messtechnik" one would silently merge their rows
 * into whichever category's bucket happened to be created first, and the other category would
 * render an empty group list. Fixed here (E2, flagged) by bucketing on category+group together;
 * the fold state in `buildResourceRows` still keys on the bare group name, unchanged from legacy.
 */
function bucketResourceRows(
  machRows: readonly StatsMachineRow[],
  filterQuery: string,
  visibleCategories: ReadonlySet<string>,
): ResourceRowBuckets {
  const lowercaseQuery = filterQuery.trim().toLowerCase();
  const categoriesInOrder: MachineCategory[] = [];
  const groupsByCategory = new Map<MachineCategory, string[]>();
  const rowsByGroupInCategory = new Map<string, StatsMachineRow[]>();
  for (const row of machRows) {
    if (lowercaseQuery && !row.machine.name.toLowerCase().includes(lowercaseQuery)) continue;
    const category = getMachineCategory(row.machine);
    if (!visibleCategories.has(category)) continue;
    if (!groupsByCategory.has(category)) {
      groupsByCategory.set(category, []);
      categoriesInOrder.push(category);
    }
    const group = row.machine.group;
    const bucketKey = `${category}::${group}`;
    if (!rowsByGroupInCategory.has(bucketKey)) {
      rowsByGroupInCategory.set(bucketKey, []);
      groupsByCategory.get(category)!.push(group);
    }
    rowsByGroupInCategory.get(bucketKey)!.push(row);
  }
  return { categoriesInOrder, groupsByCategory, rowsByGroupInCategory };
}

/**
 * The Ressourcen-mode list, grouped by category then by group, each level foldable and each
 * carrying its own average utilisation. A category header only appears when more than one
 * category actually has matching rows (a single-category result skips straight to its groups);
 * a category's average covers every row in it regardless of which of its groups are folded, but
 * folding the category itself hides its groups and their rows entirely. Faithful port of the
 * `mode==='m'` (non-drilldown) branch of legacy `renderStats`.
 */
export function buildResourceRows(
  machRows: readonly StatsMachineRow[],
  options: BuildResourceRowsOptions,
): ResourceRow[] {
  const { filterQuery, visibleCategories, closedKeys } = options;
  const { categoriesInOrder, groupsByCategory, rowsByGroupInCategory } = bucketResourceRows(
    machRows,
    filterQuery,
    visibleCategories,
  );

  const showCategoryHeaders = categoriesInOrder.length > 1;
  const rows: ResourceRow[] = [];
  for (const category of categoriesInOrder) {
    const groupsInCategory = groupsByCategory.get(category)!;
    const allRowsInCategory = groupsInCategory.flatMap((group) =>
      rowsByGroupInCategory.get(`${category}::${group}`)!,
    );
    const categoryClosed = closedKeys.has(`c:${category}`);
    if (showCategoryHeaders) {
      rows.push({
        kind: 'category',
        category,
        collapsed: categoryClosed,
        averagePercent: average(allRowsInCategory.map((row) => row.percent)),
      });
    }
    if (categoryClosed) continue; // hides every group (and row) under this category

    for (const group of groupsInCategory) {
      const rowsInGroup = rowsByGroupInCategory
        .get(`${category}::${group}`)!
        .slice()
        .sort(
          (a, b) => b.percent - a.percent || a.machine.name.localeCompare(b.machine.name, 'de'),
        );
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
  }
  return rows;
}

// ---- The "Wartung" and "Personen" overview modes' filter + sort ---------------------

/**
 * The Wartung-mode list: maintenance rows matching `filterQuery` (machine name, case-
 * insensitive substring), most blocked-days first, then most instances, then German name
 * order. Faithful port of the `mode==='w'` branch of legacy `renderStats`.
 */
export function buildMaintRows(
  maintRows: readonly StatsMaintRow[],
  filterQuery: string,
): StatsMaintRow[] {
  const lowercaseQuery = filterQuery.trim().toLowerCase();
  return maintRows
    .filter((row) => !lowercaseQuery || row.machine.name.toLowerCase().includes(lowercaseQuery))
    .sort(
      (a, b) =>
        b.days - a.days ||
        b.slotCount - a.slotCount ||
        a.machine.name.localeCompare(b.machine.name, 'de'),
    );
}

/**
 * The Personen-mode overview list: people matching `filterQuery` (name, case-insensitive
 * substring), most booked days first, then German name order. Faithful port of the `else`
 * (Personen overview) branch of legacy `renderStats`.
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
