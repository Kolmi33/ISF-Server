import { describe, it, expect } from 'vitest';
import type { Booking, Machine } from '../../../shared/types.ts';
import { parseIsoDateString } from '../core/dates.ts';
import {
  classifyCell,
  isMine,
  cellClass,
  classifyDot,
  displayGroup,
  orderedMachines,
  getBooking,
  visibleWeeks,
  nameColor,
  maintenanceKindToday,
  buildGridRows,
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
  it('ranks blocked highest, even over a booking', () => {
    expect(classifyCell(true, bk, true)).toBe('blocked');
    expect(classifyCell(true, null, false)).toBe('blocked');
  });
  it('is booked when not blocked and a booking exists', () => {
    expect(classifyCell(false, bk, false)).toBe('booked'); // booking wins over unavailability
  });
  it('is unavail when free of block/booking but the day is not available', () => {
    expect(classifyCell(false, null, false)).toBe('unavail');
    expect(classifyCell(false, undefined, false)).toBe('unavail');
  });
  it('is free otherwise', () => {
    expect(classifyCell(false, null, true)).toBe('free');
  });
});

describe('isMine', () => {
  it('matches case-insensitively', () => {
    expect(isMine('anna', 'ANNA')).toBe(true);
    expect(isMine('Anna', 'bob')).toBe(false);
  });
  it('is false when there is no current user', () => {
    expect(isMine('', 'anna')).toBe(false);
  });
});

describe('cellClass', () => {
  it('builds the stem for each state', () => {
    expect(cellClass('free')).toBe('cell free');
    expect(cellClass('blocked')).toBe('cell blocked');
    expect(cellClass('unavail')).toBe('cell unavail');
    expect(cellClass('booked')).toBe('cell booked');
  });
  it('adds mine only for booked cells', () => {
    expect(cellClass('booked', { mine: true })).toBe('cell booked mine');
    expect(cellClass('free', { mine: true })).toBe('cell free'); // mine ignored off booked
  });
  it('appends today then weekend, in that order', () => {
    expect(cellClass('booked', { mine: true, today: true, weekend: true })).toBe(
      'cell booked mine today wknd',
    );
    expect(cellClass('free', { today: true })).toBe('cell free today');
    expect(cellClass('free', { weekend: true })).toBe('cell free wknd');
  });
});

describe('classifyDot', () => {
  const bk: Booking = { name: 'anna' };
  it('ranks an active maintenance slot highest (defekt vs. any other type)', () => {
    expect(classifyDot('defekt', bk, true)).toBe('defekt');
    expect(classifyDot('wartung', bk, true)).toBe('maint');
    expect(classifyDot('irgendwas', null, false)).toBe('maint'); // any non-defekt type
  });
  it('is busy / unavail / free when no maintenance slot is active', () => {
    expect(classifyDot(null, bk, true)).toBe('busy');
    expect(classifyDot(null, null, false)).toBe('unavail');
    expect(classifyDot(undefined, null, true)).toBe('free');
  });
});

describe('displayGroup', () => {
  it('floats a favorited machine to the favorites group regardless of its real group', () => {
    expect(displayGroup(machine({ id: 'fav' }), new Set(['fav']))).toBe(FAVORITES_GROUP_LABEL);
  });
  it('uses the machine`s own group when not a favorite', () => {
    expect(displayGroup(machine({ group: 'Halle 1' }), new Set())).toBe('Halle 1');
  });
});

describe('orderedMachines', () => {
  it('lists favorites first, in their original relative order', () => {
    const a = machine({ id: 'a' });
    const b = machine({ id: 'b' });
    const c = machine({ id: 'c' });
    expect(orderedMachines([a, b, c], new Set(['c', 'a']))).toEqual([a, c, b]);
  });
  it('among non-favorites, keeps Maschinen before Messtechnik (stable sort)', () => {
    const messtechnik = machine({ id: 'mt', cat: 'messtechnik' });
    const maschine = machine({ id: 'ma' });
    expect(orderedMachines([messtechnik, maschine], new Set())).toEqual([maschine, messtechnik]);
  });
});

describe('getBooking', () => {
  it('returns the booking when the cell is occupied', () => {
    const bookings = { m1: { '2021-01-04': bk } };
    expect(getBooking(bookings, 'm1', '2021-01-04')).toBe(bk);
  });
  it('is undefined for an unknown machine or an empty day', () => {
    expect(getBooking({}, 'm1', '2021-01-04')).toBeUndefined();
    expect(getBooking({ m1: {} }, 'm1', '2021-01-04')).toBeUndefined();
  });
});

describe('visibleWeeks', () => {
  it('builds weekCount weeks of daysPerWeek consecutive ISO dates from startMonday', () => {
    expect(visibleWeeks(parseIsoDateString('2021-01-04'), 2, 5)).toEqual([
      ['2021-01-04', '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08'],
      ['2021-01-11', '2021-01-12', '2021-01-13', '2021-01-14', '2021-01-15'],
    ]);
  });
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
  it('is deterministic for the same name and theme', () => {
    expect(nameColor('Kolmanovskyi', false)).toBe(nameColor('Kolmanovskyi', false));
  });
  it('uses a darker lightness for the dark theme', () => {
    expect(nameColor('anna', true)).toMatch(/35% 30%/);
    expect(nameColor('anna', false)).toMatch(/55% 88%/);
  });
});

describe('maintenanceKindToday', () => {
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

  it('gives the group header the total machine count for that group, not the visible count', () => {
    const a = machine({ id: 'a', group: 'G1' });
    const b = machine({ id: 'b', group: 'G1' });
    const rows = buildGridRows([a, b], { ...noFilter, openCategories: new Set(['maschine']) });
    const groupRow = rows.find((r) => r.kind === 'group');
    expect(groupRow).toMatchObject({ machineCount: 2 });
  });

  it('a closed category hides its group headers and machine rows, but the category header stays', () => {
    const a = machine({ id: 'a', group: 'G1' });
    const rows = buildGridRows([a], { ...noFilter, openCategories: new Set() }); // maschine not open
    expect(rows).toEqual([{ kind: 'category', category: 'maschine', collapsed: true }]);
  });

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
