import { describe, it, expect } from 'vitest';
import type { Booking, Machine } from '../../../shared/types.ts';
import { parseIsoDateString } from '../../../shared/dates.ts';
import {
  classifyCell,
  isMine,
  cellClass,
  classifyDot,
  displayGroup,
  orderedMachines,
  visibleWeeks,
  nameColor,
  categoryColor,
  maintenanceKindToday,
  buildGridRows,
  computeBookingBlocks,
  mineAccentLayers,
  FAVORITES_GROUP_LABEL,
  type BookingBlockSegment,
  type GridRow,
} from './grid.ts';

const machine = (over: Partial<Machine> = {}): Machine => ({
  id: 'm1',
  name: 'Fräse',
  group: 'Werkstatt',
  ...over,
});

const bk: Booking = { name: 'anna' };

describe('classifyCell', () => {
  // What: a blocked cell always classifies as blocked, even if it's also booked — blocking
  // outranks every other state.
  // How: checks blocked+booked and blocked+free-day both classify as blocked.
  it('ranks blocked highest, even over a booking', () => {
    expect(classifyCell(true, bk, true)).toBe('blocked');
    expect(classifyCell(true, null, false)).toBe('blocked');
  });
  // What: a booked, unblocked cell classifies as booked, even on a weekday the machine
  // wouldn't normally be available (a booking that already exists wins over unavailability).
  // How: checks not-blocked + a real booking + day-unavailable still classifies as booked.
  it('is booked when not blocked and a booking exists', () => {
    expect(classifyCell(false, bk, false)).toBe('booked'); // booking wins over unavailability
  });
  // What: with no block and no booking, an unavailable weekday classifies as unavail.
  // How: checks both a null and an undefined booking value on an unavailable day.
  it('is unavail when free of block/booking but the day is not available', () => {
    expect(classifyCell(false, null, false)).toBe('unavail');
    expect(classifyCell(false, undefined, false)).toBe('unavail');
  });
  // What: with none of the other conditions applying, the cell is genuinely free.
  // How: checks not-blocked + no booking + day-available classifies as free.
  it('is free otherwise', () => {
    expect(classifyCell(false, null, true)).toBe('free');
  });
});

describe('isMine', () => {
  // What: ownership matching is case-insensitive.
  // How: checks a differently-cased match returns true and a real mismatch returns false.
  it('matches case-insensitively', () => {
    expect(isMine('anna', 'ANNA')).toBe(true);
    expect(isMine('Anna', 'bob')).toBe(false);
  });
  // What: with no current user logged in (empty string), nothing is ever "mine".
  // How: checks an empty current-user string against a real booker name.
  it('is false when there is no current user', () => {
    expect(isMine('', 'anna')).toBe(false);
  });
});

describe('cellClass', () => {
  // What: each of the four cell states gets its own base class stem.
  // How: checks all four state strings produce "cell <state>".
  it('builds the stem for each state', () => {
    expect(cellClass('free')).toBe('cell free');
    expect(cellClass('blocked')).toBe('cell blocked');
    expect(cellClass('unavail')).toBe('cell unavail');
    expect(cellClass('booked')).toBe('cell booked');
  });
  // What: the "mine" modifier class only applies to booked cells — it's silently ignored on
  // any other state, since only a booking can belong to someone.
  // How: checks mine:true on 'booked' adds the class, but mine:true on 'free' has no effect.
  it('adds mine only for booked cells', () => {
    expect(cellClass('booked', { mine: true })).toBe('cell booked mine');
    expect(cellClass('free', { mine: true })).toBe('cell free'); // mine ignored off booked
  });
  // What: the today and weekend modifier classes append in a fixed order (today, then
  // weekend) regardless of which combination is present.
  // How: checks all three modifiers together, then today alone, then weekend alone.
  it('appends today then weekend, in that order', () => {
    expect(cellClass('booked', { mine: true, today: true, weekend: true })).toBe(
      'cell booked mine today wknd',
    );
    expect(cellClass('free', { today: true })).toBe('cell free today');
    expect(cellClass('free', { weekend: true })).toBe('cell free wknd');
  });
  // What: the merge-left/merge-right modifiers, like mine, only apply to booked cells — a
  // free/blocked/unavail cell never has a booking run to merge into.
  // How: checks both on 'booked' add their classes, but both on 'free' have no effect.
  it('adds merge-left/merge-right/merge-up/merge-down only for booked cells', () => {
    expect(
      cellClass('booked', { mergeLeft: true, mergeRight: true, mergeUp: true, mergeDown: true }),
    ).toBe('cell booked merge-left merge-right merge-up merge-down');
    expect(
      cellClass('free', { mergeLeft: true, mergeRight: true, mergeUp: true, mergeDown: true }),
    ).toBe('cell free');
  });
});

describe('classifyDot', () => {
  const bk: Booking = { name: 'anna' };
  // What: an active maintenance slot outranks everything else for the today-dot, with
  // 'defekt' getting its own distinct dot state separate from any other maintenance type.
  // How: checks a 'defekt' slot classifies as 'defekt', and any other type (even booked)
  // classifies as the generic 'maint' state.
  it('ranks an active maintenance slot highest (defekt vs. any other type)', () => {
    expect(classifyDot('defekt', bk, true)).toBe('defekt');
    expect(classifyDot('wartung', bk, true)).toBe('maint');
    expect(classifyDot('irgendwas', null, false)).toBe('maint'); // any non-defekt type
  });
  // What: with no active maintenance, the dot falls back to busy/unavail/free depending on
  // the booking and availability state, same three-way split as the cell classifier.
  // How: checks each of the three combinations (booked+available, empty+unavailable,
  // empty+available) with no maintenance type given.
  it('is busy / unavail / free when no maintenance slot is active', () => {
    expect(classifyDot(null, bk, true)).toBe('busy');
    expect(classifyDot(null, null, false)).toBe('unavail');
    expect(classifyDot(undefined, null, true)).toBe('free');
  });
});

describe('displayGroup', () => {
  // What: a favorited machine displays under the special favorites pseudo-group label,
  // regardless of what its real stored group is.
  // How: marks a machine's id as a favorite and checks displayGroup returns the favorites label.
  it('floats a favorited machine to the favorites group regardless of its real group', () => {
    expect(displayGroup(machine({ id: 'fav' }), new Set(['fav']))).toBe(FAVORITES_GROUP_LABEL);
  });
  // What: a non-favorite machine displays under its own actual group name.
  // How: checks a machine not in the favorites set returns its real group.
  it('uses the machine`s own group when not a favorite', () => {
    expect(displayGroup(machine({ group: 'Halle 1' }), new Set())).toBe('Halle 1');
  });
});

describe('orderedMachines', () => {
  // What: favorite machines are moved to the front, preserving their relative order among
  // themselves (a stable partition, not a re-sort).
  // How: marks two of three machines as favorites (in a-then-c order in the favorites set,
  // but a-then-b-then-c in the source list) and checks favorites come first in their
  // ORIGINAL list order (a, c), followed by the non-favorite (b).
  it('lists favorites first, in their original relative order', () => {
    const a = machine({ id: 'a' });
    const b = machine({ id: 'b' });
    const c = machine({ id: 'c' });
    expect(orderedMachines([a, b, c], new Set(['c', 'a']))).toEqual([a, c, b]);
  });
  // What: among non-favorites, Maschinen sort before Messtechnik, and the sort is stable
  // (doesn't reorder machines beyond what the category split requires).
  // How: builds one of each category (messtechnik listed first in the input) and checks the
  // output puts maschine first regardless of input order.
  it('among non-favorites, keeps Maschinen before Messtechnik (stable sort)', () => {
    const messtechnik = machine({ id: 'mt', cat: 'messtechnik' });
    const maschine = machine({ id: 'ma' });
    expect(orderedMachines([messtechnik, maschine], new Set())).toEqual([maschine, messtechnik]);
  });
});

describe('visibleWeeks', () => {
  // What: builds the requested number of weeks, each with the requested number of
  // consecutive ISO dates starting from the given Monday.
  // How: builds 2 weeks of 5 days from a known Monday and checks the exact date grid.
  it('builds weekCount weeks of daysPerWeek consecutive ISO dates from startMonday', () => {
    expect(visibleWeeks(parseIsoDateString('2021-01-04'), 2, 5)).toEqual([
      ['2021-01-04', '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08'],
      ['2021-01-11', '2021-01-12', '2021-01-13', '2021-01-14', '2021-01-15'],
    ]);
  });
  // What: with daysPerWeek set to 7, Saturday and Sunday are included in the grid too.
  // How: builds 1 week of 7 days and checks all seven consecutive dates appear.
  it('includes the weekend when daysPerWeek is 7', () => {
    expect(visibleWeeks(parseIsoDateString('2021-01-04'), 1, 7)).toEqual([
      [
        '2021-01-04',
        '2021-01-05',
        '2021-01-06',
        '2021-01-07',
        '2021-01-08',
        '2021-01-09',
        '2021-01-10',
      ],
    ]);
  });
});

describe('nameColor', () => {
  // What: the same name always produces the same color under the same theme — a stable,
  // deterministic hash-based color, not a random one.
  // How: calls nameColor twice with identical arguments and checks the results match.
  it('is deterministic for the same name and theme', () => {
    expect(nameColor('Kolmanovskyi', false)).toBe(nameColor('Kolmanovskyi', false));
  });
  // What: the dark theme uses a darker lightness value than the light theme, for legible
  // text-on-background contrast in each theme.
  // How: checks the same name's dark-theme color string contains the darker lightness value
  // and its light-theme color contains the lighter one.
  it('uses a darker lightness for the dark theme', () => {
    expect(nameColor('anna', true)).toMatch(/35% 30%/);
    expect(nameColor('anna', false)).toMatch(/55% 88%/);
  });
});

describe('categoryColor', () => {
  // What: each resource category gets its own fixed hue (not hashed) — blue for Maschinen,
  // green for Messtechnik (user request) — so equipment reads as "which kind" at a glance,
  // consistently across every device regardless of its own name.
  // How: checks the two categories' colors differ, and that the same category always returns
  // the exact same color.
  it('gives each category its own fixed, deterministic hue', () => {
    const machineColor = categoryColor('maschine', false);
    const measColor = categoryColor('messtechnik', false);
    expect(machineColor).not.toBe(measColor);
    expect(categoryColor('maschine', false)).toBe(machineColor);
  });
  // What: the dark theme uses a darker lightness value than the light theme, matching
  // nameColor's own light/dark convention.
  // How: checks a category's dark-theme color contains the darker lightness value and its
  // light-theme color contains the lighter one.
  it('uses a darker lightness for the dark theme', () => {
    expect(categoryColor('maschine', true)).toMatch(/35% 30%/);
    expect(categoryColor('maschine', false)).toMatch(/55% 88%/);
  });
});

describe('maintenanceKindToday', () => {
  // What: returns the active maintenance slot's type for "today", or null when nothing is active.
  // How: checks a machine with a covering slot returns its type, and a bare machine returns null.
  it('is the active slot type, or null when none is active today', () => {
    const blocked = machine({
      maint: [{ type: 'defekt', from: '2021-01-01', until: '2021-12-31' }],
    });
    expect(maintenanceKindToday(blocked, '2021-06-01')).toBe('defekt');
    expect(maintenanceKindToday(machine(), '2021-06-01')).toBeNull();
  });
});

describe('buildGridRows', () => {
  const noFilter = {
    selectedGroups: new Set<string>(),
    selectedMachineIds: new Set<string>(),
    openCategories: new Set<string>(),
    collapsedGroups: new Set<string>(),
    favoriteIds: new Set<string>(),
  };

  const machineRows = (rows: GridRow[]): string[] =>
    rows.filter((r) => r.kind === 'machine').map((r) => r.machine.id);

  it('emits category headings before their group and machine rows', () => {
    const a = machine({ id: 'a', group: 'G1' });
    const b = machine({ id: 'b', group: 'G1' });
    const c = machine({ id: 'c', group: 'G2', cat: 'messtechnik' });
    const rows = buildGridRows([a, b, c], {
      ...noFilter,
      openCategories: new Set(['maschine', 'messtechnik']),
    });
    expect(rows.map((r) => r.kind)).toEqual([
      'category',
      'group',
      'machine',
      'machine',
      'category',
      'group',
      'machine',
    ]);
    expect(machineRows(rows)).toEqual(['a', 'b', 'c']);
  });

  // What: a group header's machine count always reflects the group's TOTAL membership, not
  // just how many of its machines happen to currently be visible — so a filtered-out count
  // doesn't misleadingly shrink the displayed total.
  // How: builds a 2-machine group with no filters applied and checks the header's machineCount is 2.
  it('gives the group header the total machine count for that group, not the visible count', () => {
    const a = machine({ id: 'a', group: 'G1' });
    const b = machine({ id: 'b', group: 'G1' });
    const rows = buildGridRows([a, b], { ...noFilter, openCategories: new Set(['maschine']) });
    const groupRow = rows.find((r) => r.kind === 'group');
    expect(groupRow).toMatchObject({ machineCount: 2 });
  });

  // A category not selected in the segmented switch contributes no body rows.
  it('a category not selected by the segmented switch is hidden completely', () => {
    const a = machine({ id: 'a', group: 'G1' });
    const rows = buildGridRows([a], { ...noFilter, openCategories: new Set() }); // maschine not open
    expect(rows).toEqual([]);
  });

  // What: a collapsed group (its category open, but the group itself folded) hides its
  // machine rows but still shows its own group header (marked collapsed) so it can reopen.
  // How: opens the category but collapses the one group and checks the result is
  // category+group headers only, with the group row marked collapsed.
  it('a collapsed group hides its machine row, but the group header stays (so it can reopen)', () => {
    const a = machine({ id: 'a', group: 'G1' });
    const rows = buildGridRows([a], {
      ...noFilter,
      openCategories: new Set(['maschine']),
      collapsedGroups: new Set(['G1']),
    });
    expect(rows.map((r) => r.kind)).toEqual(['category', 'group']);
    expect(rows[1]).toMatchObject({ collapsed: true });
  });

  // What: the group filter (selectedGroups) hides non-matching machines entirely — EXCEPT a
  // favorite, which is always shown regardless of which group filter is active, and favorites
  // list before the group-matched machines.
  // How: builds a kept machine (matches the filter), a dropped one (doesn't), and a favorite
  // in a non-matching group, and checks only the favorite and the kept machine appear, favorite first.
  it('the group filter hides non-matching machines entirely, but never a favorite', () => {
    const kept = machine({ id: 'kept', group: 'G1' });
    const dropped = machine({ id: 'dropped', group: 'G2' });
    const favoriteInOtherGroup = machine({ id: 'fav', group: 'G2' });
    const rows = buildGridRows([kept, dropped, favoriteInOtherGroup], {
      ...noFilter,
      openCategories: new Set(['maschine']),
      selectedGroups: new Set(['G1']),
      favoriteIds: new Set(['fav']),
    });
    expect(machineRows(rows)).toEqual(['fav', 'kept']); // favorites are listed first
  });

  // What: an explicit machine-id filter overrides BOTH a closed category and a collapsed
  // group — if a machine is explicitly selected, it shows even when its containers are folded.
  // How: closes the category, collapses the group, but explicitly selects the one machine in
  // it, and checks it still appears.
  it('an active machine filter does not override the selected category tab', () => {
    const a = machine({ id: 'a', group: 'G1' });
    const rows = buildGridRows([a], {
      ...noFilter,
      openCategories: new Set(), // category closed
      collapsedGroups: new Set(['G1']), // group collapsed
      selectedMachineIds: new Set(['a']), // but explicitly filtered in
    });
    expect(machineRows(rows)).toEqual([]);
  });

  // What: conversely, a machine filter that excludes a machine hides it even when its
  // category and group are both fully open — the filter is exclusionary, not just additive.
  // How: opens the category, selects only machine 'a' out of two, and checks 'b' is excluded.
  it('a machine filter that excludes a machine hides it, even with everything else open', () => {
    const a = machine({ id: 'a', group: 'G1' });
    const b = machine({ id: 'b', group: 'G1' });
    const rows = buildGridRows([a, b], {
      ...noFilter,
      openCategories: new Set(['maschine']),
      selectedMachineIds: new Set(['a']),
    });
    expect(machineRows(rows)).toEqual(['a']);
  });

  // What: favorites render as their own leading pseudo-group (with a special isFavoritesGroup
  // flag) that has no category header of its own — it sits above the real categories entirely.
  // How: builds one favorite and one ordinary machine in the same real group, and checks the
  // very first row is the favorites group header (not a category header), followed by the
  // favorite's machine row, then the real category/group/machine rows.
  it('favorites form their own leading pseudo-group with no category header of its own', () => {
    const fav = machine({ id: 'fav', group: 'G1' });
    const other = machine({ id: 'other', group: 'G1' });
    const rows = buildGridRows([fav, other], {
      ...noFilter,
      openCategories: new Set(['maschine']),
      favoriteIds: new Set(['fav']),
    });
    expect(rows[0]).toMatchObject({
      kind: 'group',
      group: FAVORITES_GROUP_LABEL,
      isFavoritesGroup: true,
    });
    expect(rows.map((r) => r.kind)).toEqual(['group', 'machine', 'category', 'group', 'machine']);
  });

  it('ignores stale favorite ids without creating an empty favorites list', () => {
    const rows = buildGridRows([machine({ id: 'real', group: 'G1' })], {
      ...noFilter,
      openCategories: new Set(['maschine']),
      favoriteIds: new Set(['deleted-machine']),
    });
    expect(rows.some((row) => row.kind === 'group' && row.isFavoritesGroup)).toBe(false);
    expect(machineRows(rows)).toEqual(['real']);
  });

  it.each([['messtechnik'], []])(
    'keeps favorites visible with category selection %j',
    (...categories) => {
      const production = machine({ id: 'machine-fav', group: 'G1' });
      const measurement = machine({ id: 'sensor-fav', group: 'Messung', cat: 'messtechnik' });
      const rows = buildGridRows([production, measurement], {
        ...noFilter,
        openCategories: new Set(categories),
        favoriteIds: new Set(['machine-fav', 'sensor-fav']),
      });
      expect(machineRows(rows)).toEqual(['machine-fav', 'sensor-fav']);
      expect(rows[0]).toMatchObject({ kind: 'group', machineCount: 2, isFavoritesGroup: true });
    },
  );
});

describe('computeBookingBlocks', () => {
  const week = ['2021-01-04', '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08'];
  const FALSE_SEGMENT = {
    continuesLeft: false,
    continuesRight: false,
    continuesUp: false,
    continuesDown: false,
    showName: false,
  };

  /** One row of a single-machine, always-null-name test — the horizontal-only cases below
   *  don't need a second row to prove nothing merges vertically by accident. */
  const oneRow = (nameAt: (isoDate: string) => string | null) => [{ machineId: 'm1', nameAt }];
  const key = (isoDate: string) => `m1|${isoDate}`;

  // What: an unbooked day never continues in any direction and never shows a name.
  // How: a week with no bookings at all — checks every day's segment is all-false.
  it('is all-false for a day with no booking', () => {
    const segments = computeBookingBlocks(
      week,
      oneRow(() => null),
    );
    for (const isoDate of week) expect(segments.get(key(isoDate))).toEqual(FALSE_SEGMENT);
  });

  // What: a single isolated booked day (different names on both sides, or no neighbor at all)
  // continues in no direction, but does show its own name — a 1×1 block is still its own
  // block, with itself as the center.
  // How: books only the middle day of the week under 'anna', leaving every other day free.
  it('a lone booked day shows its name but continues in no direction', () => {
    const nameAt = (isoDate: string) => (isoDate === '2021-01-06' ? 'anna' : null);
    expect(computeBookingBlocks(week, oneRow(nameAt)).get(key('2021-01-06'))).toEqual({
      ...FALSE_SEGMENT,
      showName: true,
    });
  });

  // What: a run of several consecutive same-name days merges into one horizontal block —
  // every interior day continues both directions, the two ends continue only inward, and
  // only the (floor-rounded) middle day is marked to show the name.
  // How: books all 5 days under 'anna' (one machine row) and checks each day's segment.
  it('merges a full-week run into one horizontal block, naming only its middle day', () => {
    const segments = computeBookingBlocks(
      week,
      oneRow(() => 'anna'),
    );
    expect(segments.get(key('2021-01-04'))).toEqual({
      ...FALSE_SEGMENT,
      continuesRight: true,
    });
    expect(segments.get(key('2021-01-05'))).toEqual({
      ...FALSE_SEGMENT,
      continuesLeft: true,
      continuesRight: true,
    });
    expect(segments.get(key('2021-01-06'))).toEqual({
      // floor((4-0)/2) = 2 → index 2, the exact middle of 5 days
      ...FALSE_SEGMENT,
      continuesLeft: true,
      continuesRight: true,
      showName: true,
    });
    expect(segments.get(key('2021-01-07'))).toEqual({
      ...FALSE_SEGMENT,
      continuesLeft: true,
      continuesRight: true,
    });
    expect(segments.get(key('2021-01-08'))).toEqual({
      ...FALSE_SEGMENT,
      continuesLeft: true,
    });
  });

  // What: a name change or a free-day gap both break a run — the day after either one starts
  // a fresh block of its own, not a continuation.
  // How: books days 1–2 as 'anna', day 3 free, days 4–5 as 'bob' — checks the run boundaries
  // land exactly where the name/gap changes.
  it('breaks the run on a name change or a free-day gap', () => {
    const names: Record<string, string | null> = {
      '2021-01-04': 'anna',
      '2021-01-05': 'anna',
      '2021-01-06': null,
      '2021-01-07': 'bob',
      '2021-01-08': 'bob',
    };
    const segments = computeBookingBlocks(
      week,
      oneRow((isoDate) => names[isoDate] ?? null),
    );
    expect(segments.get(key('2021-01-05'))).toMatchObject({ continuesRight: false });
    expect(segments.get(key('2021-01-06'))).toEqual(FALSE_SEGMENT);
    expect(segments.get(key('2021-01-07'))).toMatchObject({ continuesLeft: false });
  });

  // What: two consecutive days booked by two DIFFERENT people never merge, even though
  // they're adjacent and both booked — only a matching name continues a block.
  // How: books day 1 as 'anna' and day 2 as 'bob' and checks neither continues toward the other.
  it('does not merge adjacent days booked by different people', () => {
    const names: Record<string, string> = { '2021-01-04': 'anna', '2021-01-05': 'bob' };
    const segments = computeBookingBlocks(
      week.slice(0, 2),
      oneRow((isoDate) => names[isoDate] ?? null),
    );
    expect(segments.get(key('2021-01-04'))).toMatchObject({ continuesRight: false });
    expect(segments.get(key('2021-01-05'))).toMatchObject({ continuesLeft: false });
  });

  // What: two ADJACENT machine rows booked by the same person for the exact same day range
  // merge vertically into one rectangular block — every cell in it continues toward every
  // neighbor still inside the rectangle, and only its one geometric center cell (the middle
  // row, middle day) shows the name; every other cell in the block, including the middle day
  // of the OTHER row, stays blank.
  // How: books m1 and m2 both solid across all 5 days as 'anna' and checks the corner/edge/
  // center cells across both rows.
  it('merges two adjacent machine rows with an identical run into one 2×5 block', () => {
    const rows = [
      { machineId: 'm1', nameAt: () => 'anna' },
      { machineId: 'm2', nameAt: () => 'anna' },
    ];
    const segments = computeBookingBlocks(week, rows);
    // Row 0 (m1) is the block's top edge: continues down, and right/left same as before.
    expect(segments.get('m1|2021-01-04')).toEqual({
      ...FALSE_SEGMENT,
      continuesRight: true,
      continuesDown: true,
    });
    // Row 1 (m2) is the block's bottom edge: continues up instead of down.
    expect(segments.get('m2|2021-01-04')).toEqual({
      ...FALSE_SEGMENT,
      continuesRight: true,
      continuesUp: true,
    });
    // The center of a 2-row block is floor((1-0)/2) = row 0 (m1) — so only m1's middle day
    // shows the name; m2's middle day is inside the same block but not its center.
    expect(segments.get('m1|2021-01-06')).toMatchObject({ showName: true });
    expect(segments.get('m2|2021-01-06')).toMatchObject({ showName: false, continuesUp: true });
  });

  // What: "if someone has a booking in between of the machine list" — a row that breaks the
  // vertical match (a different name, here) splits what would otherwise be one tall block
  // into two independent ones, each with its own centered name — never one name spanning the
  // gap, and never silently merging through the interruption.
  // How: books m1 and m3 as 'anna' across the same days, with m2 in between booked by 'bob'
  // instead, and checks m1's and m3's blocks are each their own 1-row block (their own single
  // day, i.e. their own row, shows the name), not part of one shared block.
  it('splits into two independent blocks (top and bottom) around a differently-booked row in between', () => {
    const rows = [
      { machineId: 'm1', nameAt: () => 'anna' },
      { machineId: 'm2', nameAt: () => 'bob' },
      { machineId: 'm3', nameAt: () => 'anna' },
    ];
    const segments = computeBookingBlocks(week, rows);
    expect(segments.get('m1|2021-01-04')).toMatchObject({ continuesDown: false });
    expect(segments.get('m3|2021-01-04')).toMatchObject({ continuesUp: false });
    // Each machine's own row is a 1-row block, so its own (horizontal) middle day shows the
    // name independently — "the top and the bottom one".
    expect(segments.get('m1|2021-01-06')).toMatchObject({ showName: true });
    expect(segments.get('m3|2021-01-06')).toMatchObject({ showName: true });
  });

  // What: two adjacent rows booked by the same person but over DIFFERENT day ranges don't
  // merge vertically — an identical run shape (same start/end day, not just an overlapping
  // one) is required, since a partial overlap isn't a genuine rectangle.
  // How: books m1 across days 1–3 and m2 across days 2–4 (both 'anna', overlapping but not
  // identical) and checks neither row reports continuing toward the other.
  it('does not merge rows whose runs overlap but are not identical in shape', () => {
    const rows = [
      { machineId: 'm1', nameAt: (isoDate: string) => (isoDate <= '2021-01-06' ? 'anna' : null) },
      { machineId: 'm2', nameAt: (isoDate: string) => (isoDate >= '2021-01-05' ? 'anna' : null) },
    ];
    const segments = computeBookingBlocks(week, rows);
    expect(segments.get('m1|2021-01-05')).toMatchObject({ continuesDown: false });
    expect(segments.get('m2|2021-01-05')).toMatchObject({ continuesUp: false });
  });
});

describe('mineAccentLayers', () => {
  const segment = (over: Partial<BookingBlockSegment> = {}): BookingBlockSegment => ({
    continuesLeft: false,
    continuesRight: false,
    continuesUp: false,
    continuesDown: false,
    showName: false,
    ...over,
  });
  const NO_ACCENT = '0 0 0 0 transparent';

  // What: a 1×1 block (no continuation in any direction) gets the accent on all four edges —
  // it IS its own outer boundary on every side.
  // How: an all-false segment; every --mine-* layer should be a real accent, none inert.
  it('accents all four edges of an isolated block', () => {
    const layers = mineAccentLayers(segment());
    expect(layers['--mine-top']).not.toBe(NO_ACCENT);
    expect(layers['--mine-bottom']).not.toBe(NO_ACCENT);
    expect(layers['--mine-left']).not.toBe(NO_ACCENT);
    expect(layers['--mine-right']).not.toBe(NO_ACCENT);
  });

  // What: an edge that continues into a same-block neighbor is an interior edge, not the
  // block's outer boundary, and must stay blank — otherwise the accent would trace every
  // cell's own rectangle instead of the merged block's outer edge exactly once.
  // How: a segment continuing in every direction — every --mine-* layer should be inert.
  it('leaves every edge blank when the block continues in that direction', () => {
    const layers = mineAccentLayers(
      segment({
        continuesLeft: true,
        continuesRight: true,
        continuesUp: true,
        continuesDown: true,
      }),
    );
    expect(layers['--mine-top']).toBe(NO_ACCENT);
    expect(layers['--mine-bottom']).toBe(NO_ACCENT);
    expect(layers['--mine-left']).toBe(NO_ACCENT);
    expect(layers['--mine-right']).toBe(NO_ACCENT);
  });

  // What: a block that's merged in only SOME directions (e.g. the left end of a horizontal
  // run) shows the accent only on its true outer edges, blank on the side it continues.
  // How: a segment continuing only right — left/top/bottom stay accented, right goes blank.
  it('mixes accented and blank edges for a partial (multi-cell) block', () => {
    const layers = mineAccentLayers(segment({ continuesRight: true }));
    expect(layers['--mine-right']).toBe(NO_ACCENT);
    expect(layers['--mine-left']).not.toBe(NO_ACCENT);
    expect(layers['--mine-top']).not.toBe(NO_ACCENT);
    expect(layers['--mine-bottom']).not.toBe(NO_ACCENT);
  });
});
