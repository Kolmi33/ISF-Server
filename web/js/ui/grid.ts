// The grid view layer (Phase 4.1). Starts with the per-cell decision that was duplicated
// between the full renderer `render()` and the targeted `refreshCell()` in legacy: which of
// the four states a cell is in, whether a booking is the current user's, and the resulting
// CSS class stem. These are pure functions of their inputs (DOM-free, unit-tested to 100%),
// so both callers share one source of truth. The HTML/attribute assembly and the DOM writes
// stay in the legacy adapter for now (E3/E5); they legitimately differ per caller (the full
// render carries aria/data attributes and richer titles that the patch path does not).

import type { Booking, Machine, MachineCategory } from '../../../shared/types.ts';
import { addDays, formatDateAsIsoString } from '../core/dates.ts';
import { categoryOf, maintenanceSlotAt } from '../core/machines.ts';

/** The four mutually exclusive states a grid cell can be in, in priority order. */
export type CellState = 'blocked' | 'booked' | 'unavail' | 'free';

/**
 * Classify a cell. Priority (faithful to legacy): a maintenance/defect block wins, then a
 * booking, then day-unavailability, else free. The impure inputs are injected (E4).
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

/** Whether a booking name belongs to the current user (case-insensitive; empty user = no). */
export function isMine(user: string, name: string): boolean {
  return !!user && name.toLowerCase() === user.toLowerCase();
}

export interface CellClassOpts {
  /** Only meaningful for the 'booked' state (a booking of the current user). */
  mine?: boolean;
  today?: boolean;
  weekend?: boolean;
}

/**
 * The cell's CSS class stem, e.g. `cell booked mine today`. `mine` applies only to 'booked';
 * `weekend` is added by the full render but not by the patch path — pass it accordingly to
 * preserve that asymmetry (see ARCHITECTURE §15).
 */
export function cellClass(state: CellState, opts: CellClassOpts = {}): string {
  let c = 'cell ' + state;
  if (state === 'booked' && opts.mine) c += ' mine';
  if (opts.today) c += ' today';
  if (opts.weekend) c += ' wknd';
  return c;
}

/** The state of a machine's "today" indicator dot in its row header. */
export type DotState = 'defekt' | 'maint' | 'busy' | 'unavail' | 'free';

/**
 * Classify the today-dot. Priority (faithful to legacy): an active maintenance/defect slot wins
 * (a `defekt` type → 'defekt', any other → 'maint'; both render as the static `statdot`), then a
 * booking → 'busy', then day-unavailability → 'unavail', else 'free'. `maintType` is the type of
 * the slot active today, or null/undefined when none (the patch path passes null — a row with a
 * maintenance slot shows a `statdot`, not a `dot`, so `refreshDot` never runs on it).
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

/** The group header a machine's row appears under: its favorite label, or its own group. */
export const FAVORITES_GROUP_LABEL = '★ Favoriten';

/** Which group header `machine`'s row appears under (favorites float to their own group). */
export function displayGroup(machine: Machine, favoriteIds: ReadonlySet<string>): string {
  return favoriteIds.has(machine.id) ? FAVORITES_GROUP_LABEL : machine.group;
}

/**
 * The grid's row order: favorited machines first (in their original relative order), then
 * everyone else with Maschinen before Messtechnik (a stable sort, so ties keep their
 * existing order). Faithful port of legacy `orderedMachines`.
 */
export function orderedMachines(
  machines: readonly Machine[],
  favoriteIds: ReadonlySet<string>,
): Machine[] {
  const isMesstechnik = (machine: Machine): number =>
    categoryOf(machine) === 'messtechnik' ? 1 : 0;
  const favorites = machines.filter((machine) => favoriteIds.has(machine.id));
  const everyoneElse = machines
    .filter((machine) => !favoriteIds.has(machine.id))
    .slice()
    .sort((machineA, machineB) => isMesstechnik(machineA) - isMesstechnik(machineB));
  return favorites.concat(everyoneElse);
}

/**
 * The grid's visible date columns, grouped into weeks: `weekCount` weeks of `daysPerWeek`
 * days each (5 for Mon–Fri, 7 for Mon–Sun), starting at `startMonday`. Faithful port of
 * legacy `visibleDates`.
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
 * A deterministic background color for a booking, hashed from the booker's name so the same
 * person always gets the same color. `isDarkTheme` is injected (E4) rather than read from
 * `document.documentElement.dataset.theme` directly. Faithful port of legacy `nameColor`.
 */
export function nameColor(name: string, isDarkTheme: boolean): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return isDarkTheme ? `hsl(${hue} 35% 30%)` : `hsl(${hue} 55% 88%)`;
}

/** The type of the maintenance/defect slot active on `machine` today, or null if none. */
export function maintenanceKindToday(machine: Machine, today: string): string | null {
  const slot = maintenanceSlotAt(machine, today);
  return slot ? slot.type : null;
}

/** One row of the grid body: a category header, a group header, or a machine's data row. */
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

export interface BuildGridRowsOptions {
  /** Groups checked in the "Gruppen" filter; empty means no group filter is active. */
  selectedGroups: ReadonlySet<string>;
  /** Machines checked in the "Filtern" picker; empty means no machine filter is active. */
  selectedMachineIds: ReadonlySet<string>;
  /** Categories currently expanded (their machines/groups shown). */
  openCategories: ReadonlySet<string>;
  /** Groups currently collapsed (their machine rows hidden, but the group header still shows). */
  collapsedGroups: ReadonlySet<string>;
  favoriteIds: ReadonlySet<string>;
}

/** How many machines display under each group header (favorites counted in their own group). */
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

/** True if `machine` is hidden entirely by an active group or machine filter (not even a row
 *  is emitted for it — unlike a closed category/collapsed group, which still shows a header). */
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

/** Tracks which category/group `buildGridRows` is currently walking through, and whether the
 *  current category is closed — the small state machine `render()`'s loop used to carry
 *  as three local variables. */
class GridRowsCursor {
  category: MachineCategory | null = null;
  group: string | null = null;
  isCategoryClosed = false;

  /** Advance into `machine`'s category, pushing a header row if it's a new one. Returns
   *  `false` when the category is closed and everything under it should stay hidden. */
  enterCategory(
    machine: Machine,
    isFavoritesGroup: boolean,
    openCategories: ReadonlySet<string>,
    isMachineFilterActive: boolean,
    rows: GridRow[],
  ): boolean {
    const category = categoryOf(machine);
    if (!isFavoritesGroup && category !== this.category) {
      this.category = category;
      this.group = null; // force the new category's first group header to (re-)emit
      const isOpen = openCategories.has(category);
      this.isCategoryClosed = !isOpen && !isMachineFilterActive;
      rows.push({ kind: 'category', category, collapsed: !isOpen });
    }
    return isFavoritesGroup || !this.isCategoryClosed;
  }

  /** Advance into `machine`'s group, pushing a header row if it's a new one. */
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
 * The flat list of rows `render()` builds the grid body from, in order. This is the trickiest
 * part of `render()` to port faithfully: as it walks `orderedMachines()`, it tracks the
 * category and group it is currently inside and emits a header row whenever either changes.
 * A closed category hides everything under it, including its group headers; a collapsed group
 * hides only its machine rows — its own header stays visible so it can be reopened. An active
 * machine filter ("Filtern") overrides both category and group collapsing, so a filtered-in
 * machine is never hidden by a fold the user made before filtering.
 *
 * Kept as a pure function returning data (not building HTML) precisely because this state
 * machine is easy to get subtly wrong — testing it in isolation, once, is worth more than
 * re-reading a large JSX loop every time the grid changes.
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
    if (!categoryIsOpen) continue; // category closed: hide its group headers and rows

    cursor.enterGroup(group, isFavoritesGroup, machineCountByGroup, collapsedGroups, rows);
    if (collapsedGroups.has(group) && !isMachineFilterActive) continue; // group collapsed: hide row only

    rows.push({ kind: 'machine', machine });
  }
  return rows;
}
