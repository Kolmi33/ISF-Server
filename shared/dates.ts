// =======================================================================================
// DATE & CALENDAR HELPERS (shared/dates.ts)
// =======================================================================================
//
// Pure date/calendar logic, shared verbatim between the frontend and the backend.
// This module provides:
// 1. ISO date string <-> Date conversions (the wire/storage format is always 'YYYY-MM-DD').
// 2. Calendar arithmetic (adding days, finding Monday-of-week, ISO week numbers).
// 3. Display formatting (German de-DE date/weekday/timestamp labels for the UI).
//
// Key Principles:
// - PURE FUNCTIONS: data in, data out — no DOM, no I/O, no global state.
// - UTC FOR CALENDAR MATH: date arithmetic runs in UTC so it never drifts with the
//   viewer's timezone; only `mondayOfDate`/`todayAsIsoDateString` intentionally read local
//   calendar components (they answer "what day is it for the person looking at the
//   screen right now", which is inherently a local-time question).
// - ISO STRINGS AS THE WIRE FORMAT: 'YYYY-MM-DD' sorts correctly as a plain string and is
//   used directly as an object key in `bookings` — no separate id scheme needed.
//
// History: this file was originally frontend-only (`web/js/core/dates.ts`). The backend
// needed the same three primitives (`parseIsoDateString`/`formatDateAsIsoString`/`addDays`)
// and, having no shared *runtime* module to reach for, grew its own private copies instead
// (`server/bridge.ts`, then `server/server.ts`) — moved here once that duplication was
// noticed, since this file imports nothing and has no DOM/browser dependency, making it
// the one genuinely easy case for real cross-boundary sharing (see
// docs/ARCHITECTURE_AUDIT.md §9/F2 for the fuller history).
//
// =======================================================================================

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const WEEKDAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Formats a Date as its UTC calendar day, 'YYYY-MM-DD'.
 * This is the canonical wire/storage format used everywhere in the app.
 */
export function formatDateAsIsoString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Parses an ISO date string ('YYYY-MM-DD') into a Date at UTC midnight of that day.
 * Malformed input (missing/non-numeric parts) produces an `Invalid Date`, not a thrown error —
 * callers that need to reject bad input should validate the string shape themselves first.
 */
export function parseIsoDateString(isoDateString: string): Date {
  const [year, month, day] = isoDateString.split('-');
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/**
 * Returns a new Date `numberOfDays` calendar days after `date`, computed in UTC. Does not
 * mutate `date` — a negative `numberOfDays` moves backward in time.
 */
export function addDays(date: Date, numberOfDays: number): Date {
  const resultDate = new Date(date);
  resultDate.setUTCDate(resultDate.getUTCDate() + numberOfDays);
  return resultDate;
}

/**
 * Re-indexes `date`'s weekday so Monday=0 .. Sunday=6 (native `Date#getUTCDay()` uses
 * Sunday=0..Saturday=6, which doesn't match a Mo..So grid layout).
 *
 * Used wherever a Mo..So layout needs to know which column a date falls in: this file's own
 * `mondayOfDate`/`getIsoWeekNumber`, and machine weekday-availability masks
 * (`core/machines.ts`'s `isMachineAvailableOnWeekday`, `server/model.ts`'s `isDayAvailable`) —
 * both sides of the frontend/backend boundary needed this exact re-indexing independently
 * before it was consolidated here.
 */
export function mondayFirstWeekdayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * Finds the Monday (at UTC midnight) of the ISO week containing `date`.
 *
 * How it works:
 * 1. Reads the LOCAL calendar day (not UTC) so "today" matches the viewer's wall clock —
 *    this is one of the two functions in this file that deliberately isn't UTC-pinned.
 * 2. Re-anchors that local day at UTC midnight, so every later date computation on the
 *    result stays timezone-safe.
 * 3. Walks backward by `mondayFirstWeekdayIndex` days to land on that week's Monday.
 */
export function mondayOfDate(date: Date): Date {
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

/** Formats a Date as 'DD.MM.' in de-DE (UTC) — used for compact grid column labels. */
export function formatDateShort(date: Date): string {
  return date.toLocaleDateString('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
}

/**
 * Formats an ISO timestamp (e.g. a booking's `ts`) as a de-DE date+time label in the
 * viewer's local timezone, e.g. '4.1.2021, 14:30:00'.
 *
 * Unlike the calendar-day formatters in this file, a timestamp is a real instant in time,
 * not a plain calendar day — deliberately NOT UTC-pinned, so it reads as the viewer's own
 * wall-clock time (when a booking was actually written, from wherever they were sitting).
 * Consolidates an identical `new Date(x).toLocaleString('de-DE')` expression that had been
 * written out three times independently across `ui/components/*`
 * (see docs/ARCHITECTURE_AUDIT.md's file-by-file review).
 */
export function formatTimestamp(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString('de-DE');
}

/** Formats an ISO date string as a long de-DE label, e.g. 'Mo., 04.01.2021' (UTC). */
export function formatDateLong(isoDateString: string): string {
  return parseIsoDateString(isoDateString).toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Returns a Date's German 2-letter weekday abbreviation (UTC): 'So', 'Mo', …, 'Sa'. */
export function formatWeekdayName(date: Date): string {
  return WEEKDAY_NAMES[date.getUTCDay() as WeekdayIndex];
}

/**
 * Calculates the ISO 8601 week number (1–53) of `date`.
 *
 * How it works (per the ISO 8601 definition of a week number):
 * 1. Finds the Thursday that falls in the same ISO week as `date` — ISO weeks are
 *    identified by the calendar year that contains their Thursday, so anchoring on
 *    Thursday sidesteps every edge case around a week spanning New Year's.
 * 2. January 4th always falls in week 1 of its year (part of the ISO 8601 definition
 *    itself), so it's a fixed, reliable point to count weeks from.
 * 3. Counts whole weeks between the two Thursdays and adds 1 (since January 4th's week
 *    is week 1, not week 0).
 */
export function getIsoWeekNumber(date: Date): number {
  const daysUntilThursdayOfThisWeek = 3 - mondayFirstWeekdayIndex(date);
  const thursdayOfThisWeek = addDays(date, daysUntilThursdayOfThisWeek);

  const januaryFourthOfThatYear = new Date(Date.UTC(thursdayOfThisWeek.getUTCFullYear(), 0, 4));
  const weekdayOfJanuaryFourth = mondayFirstWeekdayIndex(januaryFourthOfThatYear);

  const daysBetweenTheTwoThursdays =
    (thursdayOfThisWeek.getTime() - januaryFourthOfThatYear.getTime()) / MILLISECONDS_PER_DAY;
  const weeksSinceWeekOne = Math.round(
    (daysBetweenTheTwoThursdays - 3 + weekdayOfJanuaryFourth) / 7,
  );

  return 1 + weeksSinceWeekOne;
}

/**
 * Returns today's LOCAL calendar day as 'YYYY-MM-DD' — the other function in this file
 * that intentionally reads local time rather than UTC, for the same reason as
 * `mondayOfDate`: "today" is a local-time question, not a UTC one.
 */
export function todayAsIsoDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Lists every weekday (Mon–Fri) as an ISO string from `fromIsoDate` to `toIsoDate`, inclusive.
 * Walks one calendar day at a time, keeping only workdays, until it passes the end date.
 */
export function getWeekdaysInRange(fromIsoDate: string, toIsoDate: string): string[] {
  const isoDatesInRange: string[] = [];
  let currentDate = parseIsoDateString(fromIsoDate);
  const endDate = parseIsoDateString(toIsoDate);
  while (currentDate <= endDate) {
    if (!isWeekend(currentDate)) {
      isoDatesInRange.push(formatDateAsIsoString(currentDate));
    }
    currentDate = addDays(currentDate, 1);
  }
  return isoDatesInRange;
}

/**
 * Lists every calendar day (including weekends) as an ISO string from `fromIsoDate` to
 * `toIsoDate`, inclusive. Same walk as `getWeekdaysInRange`, just without the weekday filter.
 */
export function getAllDaysInRange(fromIsoDate: string, toIsoDate: string): string[] {
  const isoDatesInRange: string[] = [];
  let currentDate = parseIsoDateString(fromIsoDate);
  const endDate = parseIsoDateString(toIsoDate);
  while (currentDate <= endDate) {
    isoDatesInRange.push(formatDateAsIsoString(currentDate));
    currentDate = addDays(currentDate, 1);
  }
  return isoDatesInRange;
}

/**
 * Finds the next weekday (Mon–Fri) ISO date strictly after `isoDateString`, skipping
 * weekends entirely — Friday's next weekday is the following Monday, not Saturday.
 */
export function nextWeekday(isoDateString: string): string {
  let candidateDate = addDays(parseIsoDateString(isoDateString), 1);
  while (isWeekend(candidateDate)) {
    candidateDate = addDays(candidateDate, 1);
  }
  return formatDateAsIsoString(candidateDate);
}

/**
 * Finds the previous weekday (Mon–Fri) ISO date strictly before `isoDateString`, skipping
 * weekends entirely — Monday's previous weekday is the preceding Friday, not Sunday.
 */
export function previousWeekday(isoDateString: string): string {
  let candidateDate = addDays(parseIsoDateString(isoDateString), -1);
  while (isWeekend(candidateDate)) {
    candidateDate = addDays(candidateDate, -1);
  }
  return formatDateAsIsoString(candidateDate);
}
