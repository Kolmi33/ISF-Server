// Pure date helpers, shared verbatim between the frontend and the backend. No DOM, no I/O
// — data → data, so they are trivially testable (this is where the date-logic tests
// concentrate). Originally frontend-only (web/js/core/dates.ts); the backend needed the
// same three primitives (parseIsoDateString/formatDateAsIsoString/addDays) and, having no
// shared *runtime* module to reach for, grew its own private copies instead
// (server/bridge.ts, then server/server.ts) — moved here once that duplication was
// noticed, since this file imports nothing and has no DOM/browser dependency, making it
// the one genuinely easy case for real cross-boundary sharing (see
// docs/ARCHITECTURE_AUDIT.md §9/F2 for the fuller history).
//
// Convention: the external currency is the ISO date string 'YYYY-MM-DD'. Such strings
// sort correctly lexicographically and are used directly as object keys in `bookings`.
// Date math runs in UTC so it never drifts with the viewer's timezone; only
// `mondayOfDate`/`todayAsIsoDateString` read local calendar components, exactly as the
// original did.

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const WEEKDAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A Date → its UTC calendar day as 'YYYY-MM-DD'. */
export function formatDateAsIsoString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → a Date at UTC midnight of that day. Malformed input → Invalid Date. */
export function parseIsoDateString(isoDateString: string): Date {
  const [year, month, day] = isoDateString.split('-');
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/** A new Date `numberOfDays` calendar days after `date` (UTC). Does not mutate `date`. */
export function addDays(date: Date, numberOfDays: number): Date {
  const resultDate = new Date(date);
  resultDate.setUTCDate(resultDate.getUTCDate() + numberOfDays);
  return resultDate;
}

/**
 * `date`'s weekday, re-indexed so Monday=0 .. Sunday=6 (native `Date#getUTCDay()` is
 * Sunday=0..Saturday=6). Used wherever a Mo..So layout needs to know which column a date
 * falls in: this file's own `mondayOfDate`/`getIsoWeekNumber`, and — since it used to be
 * reimplemented identically on both sides of the frontend/backend boundary the moment the
 * backend needed it too — machine weekday-availability masks (`core/machines.ts`'s
 * `dayAvailable`, `server/model.ts`'s `isDayAvailable`).
 */
export function mondayFirstWeekdayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/** The Monday (UTC midnight) of the ISO week containing `date`. Reads local Y/M/D, as the original. */
export function mondayOfDate(date: Date): Date {
  // Read the LOCAL calendar day (not UTC) so "today" matches the viewer's wall clock,
  // then re-anchor it at UTC midnight so every later date computation stays timezone-safe.
  const localCalendarDayAtUtcMidnight = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  return addDays(
    localCalendarDayAtUtcMidnight,
    -mondayFirstWeekdayIndex(localCalendarDayAtUtcMidnight),
  );
}

/** True if `date` falls on a Saturday or Sunday (UTC). */
export function isWeekend(date: Date): boolean {
  const weekday = date.getUTCDay(); // Sunday=0, Saturday=6
  return weekday === 0 || weekday === 6;
}

/** A Date → 'DD.MM.' in de-DE (UTC), e.g. grid column labels. */
export function formatDateShort(date: Date): string {
  return date.toLocaleDateString('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
}

/** An ISO timestamp (e.g. a booking's `ts`) → a de-DE date+time label in the viewer's
 *  local timezone, e.g. '4.1.2021, 14:30:00'. Unlike the calendar-day formatters here,
 *  a timestamp is a real instant, not a plain calendar day — deliberately NOT UTC-pinned,
 *  so it reads as the viewer's own wall-clock time. Consolidates an identical
 *  `new Date(x).toLocaleString('de-DE')` expression that had been written out three times
 *  independently across `ui/components/*` (ARCHITECTURE_AUDIT.md's file-by-file review). */
export function formatTimestamp(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString('de-DE');
}

/** An ISO date string → a long de-DE label, e.g. 'Mo., 04.01.2021' (UTC). */
export function formatDateLong(isoDateString: string): string {
  return parseIsoDateString(isoDateString).toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** A Date → its German 2-letter weekday abbreviation (UTC): 'So','Mo',…,'Sa'. */
export function formatWeekdayName(date: Date): string {
  return WEEKDAY_NAMES[date.getUTCDay() as WeekdayIndex];
}

/** The ISO 8601 week number (1–53) of `date`. */
export function getIsoWeekNumber(date: Date): number {
  // ISO 8601 identifies a week by the calendar year that contains its Thursday.
  // Step 1: find the Thursday that falls in the same ISO week as `date`.
  const daysUntilThursdayOfThisWeek = 3 - mondayFirstWeekdayIndex(date);
  const thursdayOfThisWeek = addDays(date, daysUntilThursdayOfThisWeek);

  // Step 2: January 4th always falls in week 1 of its year (part of the ISO 8601
  // definition), so it's a fixed, reliable point to count weeks from.
  const januaryFourthOfThatYear = new Date(Date.UTC(thursdayOfThisWeek.getUTCFullYear(), 0, 4));
  const weekdayOfJanuaryFourth = mondayFirstWeekdayIndex(januaryFourthOfThatYear);

  // Step 3: count whole weeks between the two Thursdays.
  const daysBetweenTheTwoThursdays =
    (thursdayOfThisWeek.getTime() - januaryFourthOfThatYear.getTime()) / MILLISECONDS_PER_DAY;
  const weeksSinceWeekOne = Math.round(
    (daysBetweenTheTwoThursdays - 3 + weekdayOfJanuaryFourth) / 7,
  );

  return 1 + weeksSinceWeekOne;
}

/** Today's local calendar day as 'YYYY-MM-DD' (reads local time, as the original). */
export function todayAsIsoDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** All weekdays (Mon–Fri) as ISO strings from `fromIsoDate` to `toIsoDate`, inclusive. */
export function getWeekdaysInRange(fromIsoDate: string, toIsoDate: string): string[] {
  const isoDatesInRange: string[] = [];
  let currentDate = parseIsoDateString(fromIsoDate);
  const endDate = parseIsoDateString(toIsoDate);
  // Walk one calendar day at a time, keeping only workdays, until we pass the end date.
  while (currentDate <= endDate) {
    if (!isWeekend(currentDate)) {
      isoDatesInRange.push(formatDateAsIsoString(currentDate));
    }
    currentDate = addDays(currentDate, 1);
  }
  return isoDatesInRange;
}

/** All calendar days (incl. weekends) as ISO strings from `fromIsoDate` to `toIsoDate`, inclusive. */
export function getAllDaysInRange(fromIsoDate: string, toIsoDate: string): string[] {
  const isoDatesInRange: string[] = [];
  let currentDate = parseIsoDateString(fromIsoDate);
  const endDate = parseIsoDateString(toIsoDate);
  // Walk one calendar day at a time, keeping every day, until we pass the end date.
  while (currentDate <= endDate) {
    isoDatesInRange.push(formatDateAsIsoString(currentDate));
    currentDate = addDays(currentDate, 1);
  }
  return isoDatesInRange;
}

/** The next weekday (Mon–Fri) ISO date strictly after `isoDateString`, skipping weekends
 *  entirely (Friday's next weekday is the following Monday). */
export function nextWeekday(isoDateString: string): string {
  let candidateDate = addDays(parseIsoDateString(isoDateString), 1);
  while (isWeekend(candidateDate)) {
    candidateDate = addDays(candidateDate, 1);
  }
  return formatDateAsIsoString(candidateDate);
}

/** The previous weekday (Mon–Fri) ISO date strictly before `isoDateString`, skipping
 *  weekends entirely (Monday's previous weekday is the preceding Friday). */
export function previousWeekday(isoDateString: string): string {
  let candidateDate = addDays(parseIsoDateString(isoDateString), -1);
  while (isWeekend(candidateDate)) {
    candidateDate = addDays(candidateDate, -1);
  }
  return formatDateAsIsoString(candidateDate);
}
