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

import type { Booking, Bookings, Machine, MachineCategory } from '../../../shared/types.ts';
import { addDays, formatDateAsIsoString } from '../../../shared/dates.ts';
import { getMachineCategory, getMaintenanceSlotAtDate } from '../core/machines.ts';
import { getBooking } from '../core/bookings.ts';

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
  /** This booked cell merges into its left/right/upper/lower neighbor's same-name block —
   *  drops that side's border so the two visually join into one continuous block
   *  (`computeBookingBlocks`). */
  mergeLeft?: boolean;
  mergeRight?: boolean;
  mergeUp?: boolean;
  mergeDown?: boolean;
}

/** The merge-* modifier classes (booked cells only) — split out of `cellClass` purely to stay
 *  under the function-complexity budget. */
function mergeModifierClasses(opts: CellClassOpts): string {
  let c = '';
  if (opts.mergeLeft) c += ' merge-left';
  if (opts.mergeRight) c += ' merge-right';
  if (opts.mergeUp) c += ' merge-up';
  if (opts.mergeDown) c += ' merge-down';
  return c;
}

/**
 * Builds the composite CSS class string for a table cell (e.g. `cell booked mine today`).
 */
export function cellClass(state: CellState, opts: CellClassOpts = {}): string {
  let c = 'cell ' + state;
  if (state === 'booked') {
    if (opts.mine) c += ' mine';
    c += mergeModifierClasses(opts);
  }
  if (opts.today) c += ' today';
  if (opts.weekend) c += ' wknd';
  return c;
}

/** One booked cell's position within the rectangular "block" of same-name bookings it's part
 *  of (`computeBookingBlocks`) — which neighbor directions it visually merges into, and
 *  whether it's the block's one cell that prints the booker's name. */
export interface BookingBlockSegment {
  /** This cell visually merges with its left/right/upper/lower neighbor (same block) — drop
   *  the seam on that side so the two cells visually join. */
  continuesLeft: boolean;
  continuesRight: boolean;
  continuesUp: boolean;
  continuesDown: boolean;
  /** This is the one cell in its block that prints the booker's name (centered in the block). */
  showName: boolean;
}

/** An inert, effectively-invisible box-shadow layer value — used as the "this edge has no
 *  accent" placeholder below (as opposed to CSS `none`, which isn't valid as one item inside a
 *  comma-separated multi-shadow list). */
const NO_ACCENT = '0 0 0 0 transparent';

/**
 * The four `--mine-top`/`--mine-bottom`/`--mine-left`/`--mine-right` box-shadow layer values
 * (app.css's `td.cell` base rule composes all four, plus the weekend tint, into one
 * `box-shadow`) for a booked cell belonging to the current user — set directly as inline
 * style by the caller (`GridBody.tsx`'s `BookedCell`), not via CSS classes: only an element's
 * own inline style is guaranteed to win over every class-based rule regardless of what other
 * classes it carries, which a plain `.mine.merge-*` class cascade turned out not to reliably
 * be in practice. Each edge shows the thin accent border only when this cell is that whole
 * block's true outer edge in that direction (`!segment.continuesX`) — an interior edge
 * (merging into a same-block neighbor) stays blank, so the accent traces the merged block's
 * outer boundary exactly once, never once per day/machine inside it.
 */
export function mineAccentLayers(segment: BookingBlockSegment): Record<string, string> {
  return {
    '--mine-top': segment.continuesUp ? NO_ACCENT : '0 1px 0 0 var(--app-accent)',
    '--mine-bottom': segment.continuesDown ? NO_ACCENT : '0 -1px 0 0 var(--app-accent)',
    '--mine-left': segment.continuesLeft ? NO_ACCENT : '1px 0 0 0 var(--app-accent)',
    '--mine-right': segment.continuesRight ? NO_ACCENT : '-1px 0 0 0 var(--app-accent)',
  };
}

/** One row's per-day run membership within a displayed week: `null` for an unbooked day, else
 *  the [start,end] column range and name of the run that day belongs to. Two cells (even in
 *  different rows) belong to the same run only when this whole triple matches exactly. */
type DayRun = { start: number; end: number; name: string } | null;

/** Computes each row's own per-day horizontal runs for one displayed week — the same
 *  same-name/calendar-adjacency grouping `computeBookingBlocks` merges vertically afterward,
 *  computed once per row up front so the vertical pass can compare rows by simple equality. */
function rowRunsForWeek(
  week: readonly string[],
  nameAt: (isoDate: string) => string | null,
): DayRun[] {
  const runs: DayRun[] = new Array(week.length).fill(null);
  let index = 0;
  while (index < week.length) {
    const name = nameAt(week[index]!);
    if (name === null) {
      index++;
      continue;
    }
    let end = index;
    while (end + 1 < week.length && nameAt(week[end + 1]!) === name) end++;
    for (let day = index; day <= end; day++) runs[day] = { start: index, end, name };
    index = end + 1;
  }
  return runs;
}

const sameDayRun = (a: DayRun, b: DayRun): boolean =>
  !!a && !!b && a.start === b.start && a.end === b.end && a.name === b.name;

/**
 * Computes, for one displayed week and an ordered list of currently-visible machine rows, the
 * rectangular "block" each booked cell belongs to — consolidating what would otherwise be many
 * individually-bordered, individually-labeled cells into one continuous colored block, both
 * across days (a multi-day booking) AND across machines (several adjacent rows booked
 * together, e.g. by the Assistant or a group booking): a cell continuing a block into a
 * neighbor drops the border on that side, and only the block's one center cell — centered
 * both horizontally and vertically — prints the booker's name.
 *
 * The vertical merge is driven purely by an exact match (same name, same calendar day range),
 * same as the horizontal one — not by a booking-group id: two machines happening to be booked
 * by the same person for the same days already read as one visual block, group or not. A row
 * that breaks the match (a different name, no booking, or a differently-shaped run) — "someone
 * else's machine in between" — splits the block there; each side becomes its own independent
 * block with its own centered name, never one shared name spanning the gap.
 *
 * Deliberately scoped to one displayed week, not the longer workday-skipping run
 * `core/bookings.ts`'s `findSameNameWorkdayRun` computes for the "delete whole series" flow:
 * weeks are separated by their own "gap" column in the grid (`GridBody.tsx`'s `MachineRow`),
 * so a block can never visually continue past that gap anyway, and comparing by calendar day
 * here (not workday-skip) means a shown weekend cell merges into its visible neighbors exactly
 * like any other day, matching what's actually drawn next to it.
 */
/** One discovered rectangle: the row/day index ranges (inclusive) it spans. */
interface Block {
  rowStart: number;
  rowEnd: number;
  dayStart: number;
  dayEnd: number;
}

/** Discovers every maximal rectangle across `rowRuns`: scanning top-to-bottom, left-to-right,
 *  a run not yet claimed by an earlier discovery starts a new block, extended downward through
 *  every immediately-following row sharing that exact same run shape. Split out of
 *  `computeBookingBlocks` purely to stay under the function-complexity budget. */
function discoverBookingBlocks(rowCount: number, week: readonly string[], rowRuns: DayRun[][]) {
  const blockAt = new Map<string, Block>(); // keyed by `${rowIndex}|${dayIndex}`
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    for (let dayIndex = 0; dayIndex < week.length; dayIndex++) {
      const run = rowRuns[rowIndex]![dayIndex];
      if (!run || run.start !== dayIndex || blockAt.has(`${rowIndex}|${dayIndex}`)) continue;
      let rowEnd = rowIndex;
      while (rowEnd + 1 < rowCount && sameDayRun(rowRuns[rowEnd + 1]![dayIndex]!, run)) {
        rowEnd++;
      }
      const block: Block = { rowStart: rowIndex, rowEnd, dayStart: run.start, dayEnd: run.end };
      for (let r = rowIndex; r <= rowEnd; r++) {
        for (let d = run.start; d <= run.end; d++) blockAt.set(`${r}|${d}`, block);
      }
    }
  }
  return blockAt;
}

/** Turns one cell's discovered block (or lack of one) into its final segment — the merge
 *  flags toward each neighbor still inside the same block, and whether it's that block's one
 *  geometric center cell. Split out of `computeBookingBlocks` purely to stay under the
 *  function-complexity budget. */
function segmentFor(
  rowIndex: number,
  dayIndex: number,
  block: Block | undefined,
): BookingBlockSegment {
  if (!block) {
    return {
      continuesLeft: false,
      continuesRight: false,
      continuesUp: false,
      continuesDown: false,
      showName: false,
    };
  }
  const centerRow = block.rowStart + Math.floor((block.rowEnd - block.rowStart) / 2);
  const centerDay = block.dayStart + Math.floor((block.dayEnd - block.dayStart) / 2);
  return {
    continuesLeft: dayIndex > block.dayStart,
    continuesRight: dayIndex < block.dayEnd,
    continuesUp: rowIndex > block.rowStart,
    continuesDown: rowIndex < block.rowEnd,
    showName: rowIndex === centerRow && dayIndex === centerDay,
  };
}

export function computeBookingBlocks(
  week: readonly string[],
  rows: readonly { machineId: string; nameAt: (isoDate: string) => string | null }[],
): Map<string, BookingBlockSegment> {
  const rowRuns = rows.map(({ nameAt }) => rowRunsForWeek(week, nameAt));
  const blockAt = discoverBookingBlocks(rows.length, week, rowRuns);

  const segments = new Map<string, BookingBlockSegment>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (let dayIndex = 0; dayIndex < week.length; dayIndex++) {
      const key = `${rows[rowIndex]!.machineId}|${week[dayIndex]}`;
      segments.set(key, segmentFor(rowIndex, dayIndex, blockAt.get(`${rowIndex}|${dayIndex}`)));
    }
  }
  return segments;
}

/**
 * Runs `computeBookingBlocks` once per displayed week across a full grid row sequence —
 * including category/group HEADER rows, given a `nameAt` that always returns `null`. Header
 * rows must stay in the list rather than being filtered out first: a category or group header
 * sitting between two machine rows genuinely breaks their visual adjacency (the same way a
 * differently-booked row does), so two machines in different groups must never merge just
 * because they'd be "adjacent" once headers are stripped out. A machine hidden by an active
 * filter, by contrast, correctly closes the gap — `buildGridRows` simply omits its row
 * entirely, no header takes its place, so its neighbors truly are adjacent and are free to
 * merge.
 *
 * `weeks` are passed and combined separately (not one flat day list) since
 * `computeBookingBlocks` merges purely by array adjacency: a run must never bridge the visual
 * gap column between two weeks, so each week's own days need their own separate pass.
 *
 * The one shared recipe both `Grid.tsx`'s full render AND `cell-patch.ts`'s targeted DOM
 * patch (after a booking write/delete/undo) use to compute a cell's segment — the merge/
 * "only the block's one center cell shows the name" logic must stay correct after EVERY write
 * path, not just a full re-render, or an undo (etc.) can leave a merged block's name back in
 * every cell instead of just its center.
 */
export function computeVisibleBookingBlocks(
  weeks: readonly (readonly string[])[],
  gridRows: readonly GridRow[],
  bookings: Bookings,
): Map<string, BookingBlockSegment> {
  const rows = gridRows.map(
    (row, index) =>
      row.kind === 'machine'
        ? {
            machineId: row.machine.id,
            nameAt: (isoDate: string) =>
              getBooking(bookings, row.machine.id, isoDate)?.name ?? null,
          }
        : { machineId: `__header_${index}__`, nameAt: () => null }, // never looked up; just a break
  );
  const combined = new Map<string, BookingBlockSegment>();
  for (const week of weeks) {
    for (const [key, segment] of computeBookingBlocks(week, rows)) combined.set(key, segment);
  }
  return combined;
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

/** A fixed (not hashed) hue per resource category — blue for Maschinen, green for Messtechnik
 *  (user request) — so equipment reads as "which kind of resource" at a glance in the
 *  Assistant's selection chips and result pills, the same faint-background/dark-text style
 *  `nameColor` above already establishes for per-person coloring elsewhere. */
const CATEGORY_HUES: Record<MachineCategory, number> = { maschine: 210, messtechnik: 140 };

export function categoryColor(category: MachineCategory, isDarkTheme: boolean): string {
  const hue = CATEGORY_HUES[category];
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
  /** Facet-filter result. `null` means inactive; an empty Set intentionally means no rows. */
  visibleMachineIds?: ReadonlySet<string> | null;
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
  options: Pick<
    BuildGridRowsOptions,
    'selectedGroups' | 'selectedMachineIds' | 'visibleMachineIds'
  >,
): boolean {
  const { selectedGroups, selectedMachineIds } = options;
  if (options.visibleMachineIds && !options.visibleMachineIds.has(machine.id)) return true;
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
  const isMachineFilterActive =
    selectedMachineIds.size > 0 ||
    (options.visibleMachineIds !== null && options.visibleMachineIds !== undefined);
  const orderedList = orderedMachines(machines, favoriteIds);
  const visibleOrderedList = orderedList.filter((machine) => {
    const group = displayGroup(machine, favoriteIds);
    return !isHiddenByFilter(machine, group === FAVORITES_GROUP_LABEL, options);
  });
  const machineCountByGroup = countMachinesByGroup(visibleOrderedList, favoriteIds);

  const rows: GridRow[] = [];
  const cursor = new GridRowsCursor();

  for (const machine of visibleOrderedList) {
    const group = displayGroup(machine, favoriteIds);
    const isFavoritesGroup = group === FAVORITES_GROUP_LABEL;
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
