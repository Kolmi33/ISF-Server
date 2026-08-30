import { describe, it, expect } from 'vitest';
import type { Booking, Machine } from '../../../shared/types.ts';
import { parseIsoDateString } from '../core/dates.ts';
import {
  classifyCell,
  isMine,
  cellClass,
  weekHeaderCells,
  classifyDot,
  displayGroup,
  orderedMachines,
  getBooking,
  visibleWeeks,
  nameColor,
  maintenanceKindToday,
  FAVORITES_GROUP_LABEL,
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

describe('weekHeaderCells', () => {
  // Real ISO anchors (TZ=UTC pinned): 2021-01-04 is Mon of ISO week 1; 2021-01-11 week 2.
  const w1 = ['2021-01-04', '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08'];
  const w2 = ['2021-01-11', '2021-01-12', '2021-01-13', '2021-01-14', '2021-01-15'];

  it('builds one KW header per week with a rowspan-2 gap between them', () => {
    const { kwRow } = weekHeaderCells([w1, w2], 5, '2021-01-05');
    expect(kwRow).toContain('KW 1');
    expect(kwRow).toContain('KW 2');
    expect(kwRow).toContain('colspan="5"');
    expect((kwRow.match(/class="gap"/g) || []).length).toBe(1); // only between weeks
  });

  it('builds one day header per date and marks exactly the today column', () => {
    const { dayRow } = weekHeaderCells([w1, w2], 5, '2021-01-05');
    expect((dayRow.match(/<th /g) || []).length).toBe(10);
    expect((dayRow.match(/class="today /g) || []).length).toBe(1); // 2021-01-05, not weekend
    expect(dayRow).not.toContain('wknd'); // Mon–Fri only
  });

  it('marks weekend columns with wknd and leaves weekdays unmarked', () => {
    // 2021-01-09 Sat, 2021-01-10 Sun are weekend; 2021-01-04 Mon is not.
    const { dayRow } = weekHeaderCells([['2021-01-04', '2021-01-09', '2021-01-10']], 3, 'x');
    expect((dayRow.match(/wknd/g) || []).length).toBe(2);
    expect(dayRow).toContain('class=" "'); // the Monday: neither today nor weekend
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
