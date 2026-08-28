import { describe, it, expect } from 'vitest';
import type { Booking } from '../../../shared/types.ts';
import { classifyCell, isMine, cellClass, weekHeaderCells, classifyDot } from './grid.ts';

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
