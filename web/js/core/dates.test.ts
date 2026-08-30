import { describe, it, expect } from 'vitest';
import {
  formatDateAsIsoString,
  parseIsoDateString,
  addDays,
  mondayOfDate,
  isWeekend,
  formatDateShort,
  formatDateLong,
  formatWeekdayName,
  getIsoWeekNumber,
  todayAsIsoDateString,
  getWeekdaysInRange,
  getAllDaysInRange,
} from './dates.ts';

// Anchor week: 2021-01-04 is a Monday (ISO week 1 of 2021); 2021-01-09 Sat, 2021-01-10 Sun.
// Tests run with TZ=UTC (test/setup.ts) so local- and UTC-based helpers agree deterministically.

describe('formatDateAsIsoString / parseIsoDateString', () => {
  it('formatDateAsIsoString renders the UTC calendar day', () => {
    expect(formatDateAsIsoString(new Date(Date.UTC(2021, 0, 4)))).toBe('2021-01-04');
  });
  it('parseIsoDateString builds UTC midnight of the given day', () => {
    const parsedDate = parseIsoDateString('2026-08-28');
    expect(parsedDate.getUTCFullYear()).toBe(2026);
    expect(parsedDate.getUTCMonth()).toBe(7);
    expect(parsedDate.getUTCDate()).toBe(28);
    expect(parsedDate.getUTCHours()).toBe(0);
  });
  it('round-trips formatDateAsIsoString(parseIsoDateString(isoDateString)) === isoDateString', () => {
    for (const isoDateString of ['2020-02-29', '2021-01-04', '2026-12-31']) {
      expect(formatDateAsIsoString(parseIsoDateString(isoDateString))).toBe(isoDateString);
    }
  });
  it('parseIsoDateString on malformed input yields an Invalid Date', () => {
    expect(Number.isNaN(parseIsoDateString('2021').getTime())).toBe(true);
    expect(Number.isNaN(parseIsoDateString('not-a-date').getTime())).toBe(true);
  });
});

describe('addDays', () => {
  it('adds across a month boundary', () => {
    expect(formatDateAsIsoString(addDays(parseIsoDateString('2021-01-31'), 1))).toBe('2021-02-01');
  });
  it('subtracts with a negative offset', () => {
    expect(formatDateAsIsoString(addDays(parseIsoDateString('2021-03-01'), -1))).toBe('2021-02-28');
  });
  it('does not mutate its input', () => {
    const baseDate = parseIsoDateString('2021-01-04');
    addDays(baseDate, 5);
    expect(formatDateAsIsoString(baseDate)).toBe('2021-01-04');
  });
});

describe('mondayOfDate', () => {
  it('returns the same day when already Monday', () => {
    expect(formatDateAsIsoString(mondayOfDate(parseIsoDateString('2021-01-04')))).toBe(
      '2021-01-04',
    );
  });
  it('maps mid-week to that week Monday', () => {
    expect(formatDateAsIsoString(mondayOfDate(parseIsoDateString('2021-01-06')))).toBe(
      '2021-01-04',
    ); // Wed
    expect(formatDateAsIsoString(mondayOfDate(parseIsoDateString('2021-01-08')))).toBe(
      '2021-01-04',
    ); // Fri
  });
  it('maps Sunday back to the same ISO week Monday', () => {
    expect(formatDateAsIsoString(mondayOfDate(parseIsoDateString('2021-01-10')))).toBe(
      '2021-01-04',
    ); // Sun
  });
  it('always lands on a Monday', () => {
    expect(mondayOfDate(parseIsoDateString('2026-08-28')).getUTCDay()).toBe(1);
  });
});

describe('isWeekend', () => {
  it('is true for Saturday and Sunday', () => {
    expect(isWeekend(parseIsoDateString('2021-01-09'))).toBe(true); // Sat
    expect(isWeekend(parseIsoDateString('2021-01-10'))).toBe(true); // Sun
  });
  it('is false for weekdays', () => {
    expect(isWeekend(parseIsoDateString('2021-01-04'))).toBe(false); // Mon
    expect(isWeekend(parseIsoDateString('2021-01-08'))).toBe(false); // Fri
  });
});

describe('formatWeekdayName', () => {
  it('gives the German 2-letter abbreviation (UTC)', () => {
    expect(formatWeekdayName(parseIsoDateString('2021-01-04'))).toBe('Mo');
    expect(formatWeekdayName(parseIsoDateString('2021-01-09'))).toBe('Sa');
    expect(formatWeekdayName(parseIsoDateString('2021-01-10'))).toBe('So');
  });
});

describe('getIsoWeekNumber', () => {
  it('numbers well-known ISO weeks correctly', () => {
    expect(getIsoWeekNumber(parseIsoDateString('2021-01-04'))).toBe(1); // Mon of week 1, 2021
    expect(getIsoWeekNumber(parseIsoDateString('2020-12-31'))).toBe(53); // 2020 is a 53-week ISO year
    expect(getIsoWeekNumber(parseIsoDateString('2021-01-01'))).toBe(53); // Fri belongs to 2020-W53
  });
});

describe('formatDateShort / formatDateLong', () => {
  it('formatDateShort is day.month, 2-digit (UTC)', () => {
    expect(formatDateShort(parseIsoDateString('2021-01-04'))).toMatch(/^04\.01\.?$/);
  });
  it('formatDateLong carries weekday, date and year (UTC)', () => {
    const longLabel = formatDateLong('2021-01-04');
    expect(longLabel).toMatch(/04\.01\.2021/);
    expect(longLabel).toMatch(/Mo/);
  });
});

describe('todayAsIsoDateString', () => {
  it('is a well-formed local ISO day', () => {
    expect(todayAsIsoDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getWeekdaysInRange / getAllDaysInRange', () => {
  it('getWeekdaysInRange lists Mon–Fri only, inclusive', () => {
    expect(getWeekdaysInRange('2021-01-04', '2021-01-10')).toEqual([
      '2021-01-04',
      '2021-01-05',
      '2021-01-06',
      '2021-01-07',
      '2021-01-08',
    ]);
  });
  it('getAllDaysInRange lists every calendar day, inclusive', () => {
    expect(getAllDaysInRange('2021-01-04', '2021-01-06')).toEqual([
      '2021-01-04',
      '2021-01-05',
      '2021-01-06',
    ]);
  });
  it('a single-day range yields that one day', () => {
    expect(getAllDaysInRange('2021-01-04', '2021-01-04')).toEqual(['2021-01-04']);
  });
  it('an inverted range (from > to) yields nothing', () => {
    expect(getWeekdaysInRange('2021-01-10', '2021-01-04')).toEqual([]);
    expect(getAllDaysInRange('2021-01-10', '2021-01-04')).toEqual([]);
  });
});
