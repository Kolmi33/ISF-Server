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
  maintenanceKindToday,
  buildGridRows,
  weekBookingBarSegments,
  FAVORITES_GROUP_LABEL,
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
  it('adds merge-left/merge-right only for booked cells', () => {
    expect(cellClass('booked', { mergeLeft: true, mergeRight: true })).toBe(
      'cell booked merge-left merge-right',
    );
    expect(cellClass('free', { mergeLeft: true, mergeRight: true })).toBe('cell free');
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

  // What: the grid emits one category header and one group header the first time each new
  // category/group is encountered, then machine rows for each machine under it.
  // How: builds three machines across two groups/categories, opens both categories, and
  // checks the exact sequence of row kinds plus the machine order.
  it('emits one category header and one group header per new category/group', () => {
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

  // What: a closed category hides everything beneath it (its groups and machines), but its
  // own header row still renders (marked collapsed) so it can be reopened.
  // How: builds one machine with its category closed and checks the result is just the single
  // collapsed category header row, nothing else.
  it('a closed category hides its group headers and machine rows, but the category header stays', () => {
    const a = machine({ id: 'a', group: 'G1' });
    const rows = buildGridRows([a], { ...noFilter, openCategories: new Set() }); // maschine not open
    expect(rows).toEqual([{ kind: 'category', category: 'maschine', collapsed: true }]);
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
  it('an active machine filter overrides both a closed category and a collapsed group', () => {
    const a = machine({ id: 'a', group: 'G1' });
    const rows = buildGridRows([a], {
      ...noFilter,
      openCategories: new Set(), // category closed
      collapsedGroups: new Set(['G1']), // group collapsed
      selectedMachineIds: new Set(['a']), // but explicitly filtered in
    });
    expect(machineRows(rows)).toEqual(['a']);
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
});

describe('weekBookingBarSegments', () => {
  const week = ['2021-01-04', '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08'];

  // What: an unbooked day never continues in either direction and never shows a name.
  // How: a week with no bookings at all — checks every day's segment is all-false.
  it('is all-false for a day with no booking', () => {
    const segments = weekBookingBarSegments(week, () => null);
    for (const date of week) {
      expect(segments.get(date)).toEqual({
        continuesLeft: false,
        continuesRight: false,
        showName: false,
      });
    }
  });

  // What: a single isolated booked day (different names on both sides, or no neighbor at all)
  // neither continues left nor right, but does show its own name — a run of exactly one day
  // is still its own run, with itself as the midpoint.
  // How: books only the middle day of the week under 'anna', leaving every other day free.
  it('a lone booked day shows its name but continues neither direction', () => {
    const nameAt = (date: string) => (date === '2021-01-06' ? 'anna' : null);
    const segment = weekBookingBarSegments(week, nameAt).get('2021-01-06');
    expect(segment).toEqual({ continuesLeft: false, continuesRight: false, showName: true });
  });

  // What: a run of several consecutive same-name days merges into one bar — every interior
  // day continues both directions, the two ends continue only inward, and only the
  // (floor-rounded) middle day is marked to show the name, so it's printed once, not per day.
  // How: books all 5 days under 'anna' and checks each day's segment individually.
  it('merges a full-week run into one bar, naming only its middle day', () => {
    const segments = weekBookingBarSegments(week, () => 'anna');
    expect(segments.get('2021-01-04')).toEqual({
      continuesLeft: false,
      continuesRight: true,
      showName: false,
    });
    expect(segments.get('2021-01-05')).toEqual({
      continuesLeft: true,
      continuesRight: true,
      showName: false,
    });
    expect(segments.get('2021-01-06')).toEqual({
      // floor((4-0)/2) = 2 → index 2, the exact middle of 5 days
      continuesLeft: true,
      continuesRight: true,
      showName: true,
    });
    expect(segments.get('2021-01-07')).toEqual({
      continuesLeft: true,
      continuesRight: true,
      showName: false,
    });
    expect(segments.get('2021-01-08')).toEqual({
      continuesLeft: true,
      continuesRight: false,
      showName: false,
    });
  });

  // What: a name change or a free-day gap both break a run — the day after either one starts
  // a fresh run of its own, not a continuation.
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
    const segments = weekBookingBarSegments(week, (date) => names[date] ?? null);
    expect(segments.get('2021-01-05')).toMatchObject({ continuesRight: false });
    expect(segments.get('2021-01-06')).toEqual({
      continuesLeft: false,
      continuesRight: false,
      showName: false,
    });
    expect(segments.get('2021-01-07')).toMatchObject({ continuesLeft: false });
  });

  // What: two consecutive days booked by two DIFFERENT people never merge, even though
  // they're adjacent and both booked — only a matching name continues a bar.
  // How: books day 1 as 'anna' and day 2 as 'bob' and checks neither continues toward the other.
  it('does not merge adjacent days booked by different people', () => {
    const names: Record<string, string> = { '2021-01-04': 'anna', '2021-01-05': 'bob' };
    const segments = weekBookingBarSegments(week.slice(0, 2), (date) => names[date] ?? null);
    expect(segments.get('2021-01-04')).toMatchObject({ continuesRight: false });
    expect(segments.get('2021-01-05')).toMatchObject({ continuesLeft: false });
  });
});
