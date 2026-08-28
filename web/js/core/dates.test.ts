import { describe, it, expect } from 'vitest';
import {
  ymd,
  parseYmd,
  addDays,
  mondayOf,
  isWeekend,
  fmtShort,
  fmtLong,
  weekdayName,
  isoWeek,
  todayStr,
  weekdayRange,
  allDaysRange,
} from './dates.ts';

// Anchor week: 2021-01-04 is a Monday (ISO week 1 of 2021); 2021-01-09 Sat, 2021-01-10 Sun.
// Tests run with TZ=UTC (test/setup.ts) so local- and UTC-based helpers agree deterministically.

describe('ymd / parseYmd', () => {
  it('ymd renders the UTC calendar day', () => {
    expect(ymd(new Date(Date.UTC(2021, 0, 4)))).toBe('2021-01-04');
  });
  it('parseYmd builds UTC midnight of the given day', () => {
    const d = parseYmd('2026-08-28');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(7);
    expect(d.getUTCDate()).toBe(28);
    expect(d.getUTCHours()).toBe(0);
  });
  it('round-trips ymd(parseYmd(s)) === s', () => {
    for (const s of ['2020-02-29', '2021-01-04', '2026-12-31']) {
      expect(ymd(parseYmd(s))).toBe(s);
    }
  });
  it('parseYmd on malformed input yields an Invalid Date', () => {
    expect(Number.isNaN(parseYmd('2021').getTime())).toBe(true);
    expect(Number.isNaN(parseYmd('not-a-date').getTime())).toBe(true);
  });
});

describe('addDays', () => {
  it('adds across a month boundary', () => {
    expect(ymd(addDays(parseYmd('2021-01-31'), 1))).toBe('2021-02-01');
  });
  it('subtracts with a negative offset', () => {
    expect(ymd(addDays(parseYmd('2021-03-01'), -1))).toBe('2021-02-28');
  });
  it('does not mutate its input', () => {
    const base = parseYmd('2021-01-04');
    addDays(base, 5);
    expect(ymd(base)).toBe('2021-01-04');
  });
});

describe('mondayOf', () => {
  it('returns the same day when already Monday', () => {
    expect(ymd(mondayOf(parseYmd('2021-01-04')))).toBe('2021-01-04');
  });
  it('maps mid-week to that week Monday', () => {
    expect(ymd(mondayOf(parseYmd('2021-01-06')))).toBe('2021-01-04'); // Wed
    expect(ymd(mondayOf(parseYmd('2021-01-08')))).toBe('2021-01-04'); // Fri
  });
  it('maps Sunday back to the same ISO week Monday', () => {
    expect(ymd(mondayOf(parseYmd('2021-01-10')))).toBe('2021-01-04'); // Sun
  });
  it('always lands on a Monday', () => {
    expect(mondayOf(parseYmd('2026-08-28')).getUTCDay()).toBe(1);
  });
});

describe('isWeekend', () => {
  it('is true for Saturday and Sunday', () => {
    expect(isWeekend(parseYmd('2021-01-09'))).toBe(true); // Sat
    expect(isWeekend(parseYmd('2021-01-10'))).toBe(true); // Sun
  });
  it('is false for weekdays', () => {
    expect(isWeekend(parseYmd('2021-01-04'))).toBe(false); // Mon
    expect(isWeekend(parseYmd('2021-01-08'))).toBe(false); // Fri
  });
});

describe('weekdayName', () => {
  it('gives the German 2-letter abbreviation (UTC)', () => {
    expect(weekdayName(parseYmd('2021-01-04'))).toBe('Mo');
    expect(weekdayName(parseYmd('2021-01-09'))).toBe('Sa');
    expect(weekdayName(parseYmd('2021-01-10'))).toBe('So');
  });
});

describe('isoWeek', () => {
  it('numbers well-known ISO weeks correctly', () => {
    expect(isoWeek(parseYmd('2021-01-04'))).toBe(1); // Mon of week 1, 2021
    expect(isoWeek(parseYmd('2020-12-31'))).toBe(53); // 2020 is a 53-week ISO year
    expect(isoWeek(parseYmd('2021-01-01'))).toBe(53); // Fri belongs to 2020-W53
  });
});

describe('fmtShort / fmtLong', () => {
  it('fmtShort is day.month, 2-digit (UTC)', () => {
    expect(fmtShort(parseYmd('2021-01-04'))).toMatch(/^04\.01\.?$/);
  });
  it('fmtLong carries weekday, date and year (UTC)', () => {
    const s = fmtLong('2021-01-04');
    expect(s).toMatch(/04\.01\.2021/);
    expect(s).toMatch(/Mo/);
  });
});

describe('todayStr', () => {
  it('is a well-formed local ISO day', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('weekdayRange / allDaysRange', () => {
  it('weekdayRange lists Mon–Fri only, inclusive', () => {
    expect(weekdayRange('2021-01-04', '2021-01-10')).toEqual([
      '2021-01-04',
      '2021-01-05',
      '2021-01-06',
      '2021-01-07',
      '2021-01-08',
    ]);
  });
  it('allDaysRange lists every calendar day, inclusive', () => {
    expect(allDaysRange('2021-01-04', '2021-01-06')).toEqual([
      '2021-01-04',
      '2021-01-05',
      '2021-01-06',
    ]);
  });
  it('a single-day range yields that one day', () => {
    expect(allDaysRange('2021-01-04', '2021-01-04')).toEqual(['2021-01-04']);
  });
  it('an inverted range (from > to) yields nothing', () => {
    expect(weekdayRange('2021-01-10', '2021-01-04')).toEqual([]);
    expect(allDaysRange('2021-01-10', '2021-01-04')).toEqual([]);
  });
});
