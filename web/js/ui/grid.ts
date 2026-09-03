// =======================================================================================
// GRID VIEW LOGIC MODULE (web/js/ui/grid.ts)
// =======================================================================================
//
// Pure view-layer calculations for rendering the interactive scheduling grid table.
//
// Responsibilities:
// 1. Cell State Classification: Determines the visual state of each calendar cell
//    ('blocked' | 'booked' | 'unavail' | 'free') based on maintenance, reservations, and workdays.
// 2. Machine Row Hierarchy: Groups and orders machines, prioritizing user favorites at the top,
//    followed by Maschinen and Messtechnik categories.
// 3. Grid Row Assembly (`buildGridRows`): Generates the flat list of category headers, group headers,
//    and machine data rows respecting user filter and collapse states.
// 4. Color Assignment (`nameColor`): Computes consistent, deterministic HSL colors hashed from booker names.
//
// =======================================================================================

import type { Booking, Machine, MachineCategory } from '../../../shared/types.ts';
import { addDays, formatDateAsIsoString } from '../../../shared/dates.ts';
import { getMachineCategory, getMaintenanceSlotAtDate } from '../core/machines.ts';

/** The four mutually exclusive states of a grid cell in priority order. */
export type CellState = 'blocked' | 'booked' | 'unavail' | 'free';

/**
 * Classifies the visual state of a grid cell:
 * 1. Maintenance / Defect (`blocked`): Overrides all other states.
 * 2. Active Reservation (`booked`): Machine is reserved by a user.
 * 3. Weekday Off (`unavail`): Machine is non-operational on that day of the week.
 * 4. Free (`free`): Available for booking.
 */
export function classifyCell(
  blocked: boolean,
  booking: Booking | null | undefined,
  available: boolean,
): CellState {
  if (blocked) return 'blocked';
  if (booking) return 'booked';
  if (!available) return 'unavail';
  return 'free';
}

/**
 * Checks if a booking was created by the currently logged-in user.
 */
export function isMine(user: string, name: string): boolean {
  return !!user && name.toLowerCase() === user.toLowerCase();
}

/** Styling options for generating CSS classes for a grid cell. */
export interface CellClassOpts {
  /** Highlights cells booked by the current user. */
  mine?: boolean;
  /** Highlights the column corresponding to today. */
  today?: boolean;
  /** Marks Saturday and Sunday columns. */
  weekend?: boolean;
  /** This booked cell merges into its left/right neighbor's same-name run — drops that side's
   *  border so the two visually join into one continuous bar (`weekBookingBarSegments`). */
  mergeLeft?: boolean;
  mergeRight?: boolean;
}

/**
 * Builds the composite CSS class string for a table cell (e.g. `cell booked mine today`).
 */
export function cellClass(state: CellState, opts: CellClassOpts = {}): string {
  let c = 'cell ' + state;
  if (state === 'booked' && opts.mine) c += ' mine';
  if (opts.today) c += ' today';
  if (opts.weekend) c += ' wknd';
  if (state === 'booked' && opts.mergeLeft) c += ' merge-left';
  if (state === 'booked' && opts.mergeRight) c += ' merge-right';
  return c;
}

/** One booked cell's position within the continuous "bar" of same-name bookings it's part of
 *  (`weekBookingBarSegments`). */
export interface BookingBarSegment {
  /** This cell visually merges with the previous day (same run) — drop the seam between them. */
  continuesLeft: boolean;
  /** This cell visually merges with the next day (same run) — drop the seam between them. */
  continuesRight: boolean;
  /** This is the one cell in its run that prints the booker's name (centered in the bar). */
  showName: boolean;
}

/**
 * Computes, for every day of one displayed week, its position within the "booking bar" it's
 * part of — the maximal run of calendar-consecutive days in this same week booked under the
 * exact same name. Consolidates what would otherwise be N identically-colored, individually
 * bordered, individually-labeled cells into a single continuous bar: a day continuing a run
 * into its left/right neighbor drops that border (so the two cells visually merge), and only
 * the run's middle day is marked to show the name — printed once, centered in the bar,
 * instead of once per day.
 *
 * Deliberately scoped to one displayed week, not the longer workday-skipping run
 * `core/bookings.ts`'s `findSameNameWorkdayRun` computes for the "delete whole series" flow:
 * weeks are separated by their own "gap" column in the grid (`GridBody.tsx`'s `MachineRow`),
 * so a bar can never visually continue past that gap anyway, and comparing by calendar day
 * here (not workday-skip) means a shown weekend cell merges into its visible neighbors
 * exactly like any other day, matching what's actually drawn next to it.
 */
export function weekBookingBarSegments(
  week: readonly string[],
  nameAt: (isoDate: string) => string | null,
): Map<string, BookingBarSegment> {
  const segments = new Map<string, BookingBarSegment>();
  let index = 0;
  while (index < week.length) {
    const runStart = index;
    const name = nameAt(week[runStart]!);
    let runEnd = runStart;
    while (runEnd + 1 < week.length && name !== null && nameAt(week[runEnd + 1]!) === name) {
      runEnd++;
    }
    const middle = runStart + Math.floor((runEnd - runStart) / 2);
    for (let i = runStart; i <= runEnd; i++) {
      segments.set(week[i]!, {
        continuesLeft: name !== null && i > runStart,
        continuesRight: name !== null && i < runEnd,
        showName: name !== null && i === middle,
      });
    }
    index = runEnd + 1;
  }
  return segments;
}

/** Visual status dot state displayed in the machine row header. */
export type DotState = 'defekt' | 'maint' | 'busy' | 'unavail' | 'free';

/**
 * Classifies the row header status dot representing the machine's current operational state today.
 */
export function classifyDot(
  maintType: string | null | undefined,
  booking: Booking | null | undefined,
  available: boolean,
): DotState {
  if (maintType) return maintType === 'defekt' ? 'defekt' : 'maint';
  if (booking) return 'busy';
  if (!available) return 'unavail';
  return 'free';
}

/** Group header label under which pinned favorite machines are displayed. */
export const FAVORITES_GROUP_LABEL = '★ Favoriten';

/**
 * Returns the effective group header under which a machine should be rendered.
 * Pinned favorite machines float into the dedicated '★ Favoriten' group.
 */
export function displayGroup(machine: Machine, favoriteIds: ReadonlySet<string>): string {
  return favoriteIds.has(machine.id) ? FAVORITES_GROUP_LABEL : machine.group;
}

/**
 * Sorts machines for visual grid display:
 * 1. Favorited machines float to the top of the table.
 * 2. Standard machines ('maschine') appear before measurement tools ('messtechnik').
 */
export function orderedMachines(
  machines: readonly Machine[],
  favoriteIds: ReadonlySet<string>,
): Machine[] {
  const isMesstechnik = (machine: Machine): number =>
    getMachineCategory(machine) === 'messtechnik' ? 1 : 0;
  const favorites = machines.filter((machine) => favoriteIds.has(machine.id));
  const everyoneElse = machines
    .filter((machine) => !favoriteIds.has(machine.id))
    .slice()
    .sort((machineA, machineB) => isMesstechnik(machineA) - isMesstechnik(machineB));
  return favorites.concat(everyoneElse);
}

/**
 * Generates the 2D array of visible date columns grouped by week blocks.
 */
export function visibleWeeks(
  startMonday: Date,
  weekCount: number,
  daysPerWeek: number,
): string[][] {
  const weeks: string[][] = [];
  for (let weekIndex = 0; weekIndex < weekCount; weekIndex++) {
    const week: string[] = [];
    for (let dayIndex = 0; dayIndex < daysPerWeek; dayIndex++) {
      week.push(formatDateAsIsoString(addDays(startMonday, weekIndex * 7 + dayIndex)));
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * Computes a deterministic HSL background color from the user's name so that bookings by
 * the same individual share a consistent, recognizable color across the entire schedule.
 */
export function nameColor(name: string, isDarkTheme: boolean): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return isDarkTheme ? `hsl(${hue} 35% 30%)` : `hsl(${hue} 55% 88%)`;
}

/**
 * Returns the maintenance slot type active on `machine` today, or null if operational.
 */
export function maintenanceKindToday(machine: Machine, today: string): string | null {
  const slot = getMaintenanceSlotAtDate(machine, today);
  return slot ? slot.type : null;
}

/** Discriminator union of all row types rendered in the table body. */
export type GridRow =
  | { kind: 'category'; category: MachineCategory; collapsed: boolean }
  | {
      kind: 'group';
      group: string;
      isFavoritesGroup: boolean;
      collapsed: boolean;
      machineCount: number;
    }
  | { kind: 'machine'; machine: Machine };

/** Filter and collapse options passed into buildGridRows. */
export interface BuildGridRowsOptions {
  selectedGroups: ReadonlySet<string>;
  selectedMachineIds: ReadonlySet<string>;
  openCategories: ReadonlySet<string>;
  collapsedGroups: ReadonlySet<string>;
  favoriteIds: ReadonlySet<string>;
}

/**
 * Counts the number of visible machines per group header.
 */
function countMachinesByGroup(
  orderedList: readonly Machine[],
  favoriteIds: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const machine of orderedList) {
    const group = displayGroup(machine, favoriteIds);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return counts;
}

/**
 * Checks if a machine is hidden by an active group or machine filter.
 */
function isHiddenByFilter(
  machine: Machine,
  isFavoritesGroup: boolean,
  options: Pick<BuildGridRowsOptions, 'selectedGroups' | 'selectedMachineIds'>,
): boolean {
  const { selectedGroups, selectedMachineIds } = options;
  if (selectedGroups.size > 0 && !isFavoritesGroup && !selectedGroups.has(machine.group)) {
    return true;
  }
  return selectedMachineIds.size > 0 && !selectedMachineIds.has(machine.id);
}

/**
 * State machine cursor tracking category and group boundaries during row assembly.
 */
class GridRowsCursor {
  category: MachineCategory | null = null;
  group: string | null = null;
  isCategoryClosed = false;

  /**
   * Evaluates category boundaries, emitting a category header when entering a new category.
   */
  enterCategory(
    machine: Machine,
    isFavoritesGroup: boolean,
    openCategories: ReadonlySet<string>,
    isMachineFilterActive: boolean,
    rows: GridRow[],
  ): boolean {
    const category = getMachineCategory(machine);
    if (!isFavoritesGroup && category !== this.category) {
      this.category = category;
      this.group = null;
      const isOpen = openCategories.has(category);
      this.isCategoryClosed = !isOpen && !isMachineFilterActive;
      rows.push({ kind: 'category', category, collapsed: !isOpen });
    }
    return isFavoritesGroup || !this.isCategoryClosed;
  }

  /**
   * Evaluates group boundaries, emitting a group header when entering a new department group.
   */
  enterGroup(
    group: string,
    isFavoritesGroup: boolean,
    machineCountByGroup: ReadonlyMap<string, number>,
    collapsedGroups: ReadonlySet<string>,
    rows: GridRow[],
  ): void {
    if (group === this.group) return;
    this.group = group;
    rows.push({
      kind: 'group',
      group,
      isFavoritesGroup,
      collapsed: collapsedGroups.has(group),
      machineCount: machineCountByGroup.get(group) ?? 0,
    });
  }
}

/**
 * Assembles the flat sequence of rows (category headers, group headers, machine rows)
 * for rendering in the grid body, applying filtering and folding rules.
 */
export function buildGridRows(
  machines: readonly Machine[],
  options: BuildGridRowsOptions,
): GridRow[] {
  const { openCategories, collapsedGroups, favoriteIds, selectedMachineIds } = options;
  const isMachineFilterActive = selectedMachineIds.size > 0;
  const orderedList = orderedMachines(machines, favoriteIds);
  const machineCountByGroup = countMachinesByGroup(orderedList, favoriteIds);

  const rows: GridRow[] = [];
  const cursor = new GridRowsCursor();

  for (const machine of orderedList) {
    const group = displayGroup(machine, favoriteIds);
    const isFavoritesGroup = group === FAVORITES_GROUP_LABEL;
    if (isHiddenByFilter(machine, isFavoritesGroup, options)) continue;

    const categoryIsOpen = cursor.enterCategory(
      machine,
      isFavoritesGroup,
      openCategories,
      isMachineFilterActive,
      rows,
    );
    if (!categoryIsOpen) continue;

    cursor.enterGroup(group, isFavoritesGroup, machineCountByGroup, collapsedGroups, rows);
    if (collapsedGroups.has(group) && !isMachineFilterActive) continue;

    rows.push({ kind: 'machine', machine });
  }
  return rows;
}
