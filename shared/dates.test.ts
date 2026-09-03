import { describe, it, expect } from 'vitest';
import {
  formatDateAsIsoString,
  parseIsoDateString,
  addDays,
  mondayFirstWeekdayIndex,
  mondayOfDate,
  isWeekend,
  formatDateShort,
  formatTimestamp,
  formatDateLong,
  formatWeekdayName,
  getIsoWeekNumber,
  todayAsIsoDateString,
  getWeekdaysInRange,
  getAllDaysInRange,
  nextWeekday,
  previousWeekday,
} from './dates.ts';

// Anchor week: 2021-01-04 is a Monday (ISO week 1 of 2021); 2021-01-09 Sat, 2021-01-10 Sun.
// Tests run with TZ=UTC (test/setup.ts) so local- and UTC-based helpers agree deterministically.

describe('formatDateAsIsoString / parseIsoDateString', () => {
  // What: formatDateAsIsoString renders a Date's UTC calendar day as 'YYYY-MM-DD'.
  // How: builds a Date from explicit UTC components and checks the formatted string.
  it('formatDateAsIsoString renders the UTC calendar day', () => {
    expect(formatDateAsIsoString(new Date(Date.UTC(2021, 0, 4)))).toBe('2021-01-04');
  });
  // What: parseIsoDateString builds a Date at UTC midnight of the given ISO day, not local midnight.
  // How: parses a known date and checks its UTC year/month/date/hour components directly.
  it('parseIsoDateString builds UTC midnight of the given day', () => {
    const parsedDate = parseIsoDateString('2026-08-28');
    expect(parsedDate.getUTCFullYear()).toBe(2026);
    expect(parsedDate.getUTCMonth()).toBe(7);
    expect(parsedDate.getUTCDate()).toBe(28);
    expect(parsedDate.getUTCHours()).toBe(0);
  });
  // What: the two functions are exact inverses for any well-formed ISO date, including a leap day.
  // How: round-trips a small table of dates (a leap day, an ordinary day, a year-end) through
  // parse then format and checks each comes back unchanged.
  it('round-trips formatDateAsIsoString(parseIsoDateString(isoDateString)) === isoDateString', () => {
    for (const isoDateString of ['2020-02-29', '2021-01-04', '2026-12-31']) {
      expect(formatDateAsIsoString(parseIsoDateString(isoDateString))).toBe(isoDateString);
    }
  });
  // What: malformed input produces an Invalid Date rather than throwing or silently guessing.
  // How: parses a too-short string and a non-date string and checks getTime() is NaN for both.
  it('parseIsoDateString on malformed input yields an Invalid Date', () => {
    expect(Number.isNaN(parseIsoDateString('2021').getTime())).toBe(true);
    expect(Number.isNaN(parseIsoDateString('not-a-date').getTime())).toBe(true);
  });
});

describe('addDays', () => {
  // What: adding days correctly rolls over into the next month.
  // How: adds 1 day to the last day of January and checks the result is February 1st.
  it('adds across a month boundary', () => {
    expect(formatDateAsIsoString(addDays(parseIsoDateString('2021-01-31'), 1))).toBe('2021-02-01');
  });
  // What: a negative offset subtracts days, correctly rolling back into the previous month.
  // How: adds -1 day to March 1st and checks the result is February 28th.
  it('subtracts with a negative offset', () => {
    expect(formatDateAsIsoString(addDays(parseIsoDateString('2021-03-01'), -1))).toBe('2021-02-28');
  });
  // What: addDays returns a new Date rather than mutating the one it was given.
  // How: calls addDays on a Date, discards the result, then checks the original Date is unchanged.
  it('does not mutate its input', () => {
    const baseDate = parseIsoDateString('2021-01-04');
    addDays(baseDate, 5);
    expect(formatDateAsIsoString(baseDate)).toBe('2021-01-04');
  });
});

describe('mondayFirstWeekdayIndex', () => {
  // What: the weekday index is Monday=0..Sunday=6 (not JS's native Sunday=0..Saturday=6).
  // How: checks all four distinct index values across a known Mon/Fri/Sat/Sun in the anchor week.
  it('re-indexes Monday=0 .. Sunday=6', () => {
    expect(mondayFirstWeekdayIndex(parseIsoDateString('2021-01-04'))).toBe(0); // Mon
    expect(mondayFirstWeekdayIndex(parseIsoDateString('2021-01-08'))).toBe(4); // Fri
    expect(mondayFirstWeekdayIndex(parseIsoDateString('2021-01-09'))).toBe(5); // Sat
    expect(mondayFirstWeekdayIndex(parseIsoDateString('2021-01-10'))).toBe(6); // Sun
  });
});

describe('mondayOfDate', () => {
  // What: a Monday input maps to itself (the identity case of the week-start computation).
  // How: calls mondayOfDate on a known Monday and checks the formatted result is that same date.
  it('returns the same day when already Monday', () => {
    expect(formatDateAsIsoString(mondayOfDate(parseIsoDateString('2021-01-04')))).toBe(
      '2021-01-04',
    );
  });
  // What: any mid-week day maps back to that same ISO week's Monday.
  // How: checks a Wednesday and a Friday in the anchor week both resolve to that week's Monday.
  it('maps mid-week to that week Monday', () => {
    expect(formatDateAsIsoString(mondayOfDate(parseIsoDateString('2021-01-06')))).toBe(
      '2021-01-04',
    ); // Wed
    expect(formatDateAsIsoString(mondayOfDate(parseIsoDateString('2021-01-08')))).toBe(
      '2021-01-04',
    ); // Fri
  });
  // What: Sunday maps back to the Monday that started ITS OWN week, not the following week's.
  // How: checks the anchor week's Sunday resolves to that same week's Monday (the trickiest
  // boundary case, since Sunday is both the last day of one ISO week and adjacent to the next).
  it('maps Sunday back to the same ISO week Monday', () => {
    expect(formatDateAsIsoString(mondayOfDate(parseIsoDateString('2021-01-10')))).toBe(
      '2021-01-04',
    ); // Sun
  });
  // What: the result is always a Monday, regardless of which weekday the input falls on.
  // How: picks an arbitrary Friday outside the anchor week and checks getUTCDay() === 1.
  it('always lands on a Monday', () => {
    expect(mondayOfDate(parseIsoDateString('2026-08-28')).getUTCDay()).toBe(1);
  });
});

describe('isWeekend', () => {
  // What: Saturday and Sunday are both classified as weekend.
  // How: checks the anchor week's Saturday and Sunday both return true.
  it('is true for Saturday and Sunday', () => {
    expect(isWeekend(parseIsoDateString('2021-01-09'))).toBe(true); // Sat
    expect(isWeekend(parseIsoDateString('2021-01-10'))).toBe(true); // Sun
  });
  // What: Monday through Friday are all classified as NOT weekend.
  // How: checks the anchor week's Monday and Friday (the two boundary weekdays nearest the
  // weekend) both return false.
  it('is false for weekdays', () => {
    expect(isWeekend(parseIsoDateString('2021-01-04'))).toBe(false); // Mon
    expect(isWeekend(parseIsoDateString('2021-01-08'))).toBe(false); // Fri
  });
});

describe('formatWeekdayName', () => {
  // What: renders the German 2-letter weekday abbreviation (Mo/Di/Mi/.../Sa/So).
  // How: checks a Monday, a Saturday, and a Sunday each render their correct German label.
  it('gives the German 2-letter abbreviation (UTC)', () => {
    expect(formatWeekdayName(parseIsoDateString('2021-01-04'))).toBe('Mo');
    expect(formatWeekdayName(parseIsoDateString('2021-01-09'))).toBe('Sa');
    expect(formatWeekdayName(parseIsoDateString('2021-01-10'))).toBe('So');
  });
});

describe('getIsoWeekNumber', () => {
  // What: ISO week numbering follows the standard rule (a week belongs to the year that owns
  // its Thursday), including the two trickiest edge cases: a 53-week year, and a late-December
  // day that actually belongs to the FOLLOWING year's week 1 (not tested here) or a January day
  // that belongs to the PRECEDING year's last week (which is tested).
  // How: checks a known week-1 Monday, a year-end day that's still week 53 of the old year, and
  // a January 1st that's actually week 53 of the previous ISO year.
  it('numbers well-known ISO weeks correctly', () => {
    expect(getIsoWeekNumber(parseIsoDateString('2021-01-04'))).toBe(1); // Mon of week 1, 2021
    expect(getIsoWeekNumber(parseIsoDateString('2020-12-31'))).toBe(53); // 2020 is a 53-week ISO year
    expect(getIsoWeekNumber(parseIsoDateString('2021-01-01'))).toBe(53); // Fri belongs to 2020-W53
  });
});

describe('formatDateShort / formatDateLong', () => {
  // What: formatDateShort renders as zero-padded day.month (German short-date convention).
  // How: matches the result against a regex allowing an optional trailing dot after the month.
  it('formatDateShort is day.month, 2-digit (UTC)', () => {
    expect(formatDateShort(parseIsoDateString('2021-01-04'))).toMatch(/^04\.01\.?$/);
  });
  // What: formatDateLong includes the weekday name, full date, and year.
  // How: checks the rendered label contains both the numeric date and the weekday abbreviation.
  it('formatDateLong carries weekday, date and year (UTC)', () => {
    const longLabel = formatDateLong('2021-01-04');
    expect(longLabel).toMatch(/04\.01\.2021/);
    expect(longLabel).toMatch(/Mo/);
  });
});

describe('formatTimestamp', () => {
  // What: renders an ISO timestamp as a German-locale date+time label.
  // How: formats a known UTC timestamp and checks the result contains both the de-DE date and
  // the 24-hour time (the test environment pins TZ=UTC, so this is deterministic).
  it('renders a de-DE date+time label (test env runs TZ=UTC, test/setup.ts)', () => {
    expect(formatTimestamp('2021-01-04T14:30:00Z')).toMatch(/4\.1\.2021.*14:30/);
  });
});

describe('todayAsIsoDateString', () => {
  // What: returns today's date as a well-formed local ISO day string.
  // How: since "today" isn't a fixed value, only checks the shape (YYYY-MM-DD), not a specific date.
  it('is a well-formed local ISO day', () => {
    expect(todayAsIsoDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getWeekdaysInRange / getAllDaysInRange', () => {
  // What: getWeekdaysInRange lists only Monday-Friday days in the range, both ends inclusive.
  // How: spans a range that includes one weekend and checks the weekend days are excluded.
  it('getWeekdaysInRange lists Mon–Fri only, inclusive', () => {
    expect(getWeekdaysInRange('2021-01-04', '2021-01-10')).toEqual([
      '2021-01-04',
      '2021-01-05',
      '2021-01-06',
      '2021-01-07',
      '2021-01-08',
    ]);
  });
  // What: getAllDaysInRange lists every calendar day in the range, weekends included.
  // How: spans a short range and checks all three days come back, unlike the weekday-only variant.
  it('getAllDaysInRange lists every calendar day, inclusive', () => {
    expect(getAllDaysInRange('2021-01-04', '2021-01-06')).toEqual([
      '2021-01-04',
      '2021-01-05',
      '2021-01-06',
    ]);
  });
  // What: a range where from and to are the same day yields exactly that one day.
  // How: calls with identical from/to and checks a single-element result.
  it('a single-day range yields that one day', () => {
    expect(getAllDaysInRange('2021-01-04', '2021-01-04')).toEqual(['2021-01-04']);
  });
  // What: an inverted range (from after to) yields an empty list for both variants, not an error.
  // How: calls both functions with from/to swapped and checks each returns [].
  it('an inverted range (from > to) yields nothing', () => {
    expect(getWeekdaysInRange('2021-01-10', '2021-01-04')).toEqual([]);
    expect(getAllDaysInRange('2021-01-10', '2021-01-04')).toEqual([]);
  });
});

describe('nextWeekday / previousWeekday', () => {
  // What: nextWeekday skips over a weekend rather than landing on a Saturday/Sunday.
  // How: checks a Friday jumps straight to the following Monday, and an ordinary Monday→Tuesday
  // step (no weekend involved) still just advances by one day.
  it('nextWeekday skips the weekend', () => {
    expect(nextWeekday('2021-01-08')).toBe('2021-01-11'); // Fri → Mon
    expect(nextWeekday('2021-01-11')).toBe('2021-01-12'); // Mon → Tue
  });
  // What: previousWeekday skips backward over a weekend the same way nextWeekday skips forward.
  // How: checks a Monday steps back to the preceding Friday, and an ordinary Tuesday→Monday
  // step (no weekend involved) still just steps back by one day.
  it('previousWeekday skips the weekend', () => {
    expect(previousWeekday('2021-01-11')).toBe('2021-01-08'); // Mon → Fri
    expect(previousWeekday('2021-01-12')).toBe('2021-01-11'); // Tue → Mon
  });
  // What: the two functions are exact inverses of each other across a weekend gap.
  // How: applies nextWeekday then previousWeekday to a Friday and checks it lands back on
  // that same Friday.
  it('the two are inverses across a weekend', () => {
    expect(previousWeekday(nextWeekday('2021-01-08'))).toBe('2021-01-08');
  });
});
