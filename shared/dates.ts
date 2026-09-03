// =======================================================================================
// DATE & CALENDAR HELPERS (shared/dates.ts)
// =======================================================================================
//
// Pure date and calendar math shared across frontend and backend.
//
// Responsibilities:
// 1. ISO Conversion: Canonical serialization between JavaScript Date and 'YYYY-MM-DD' strings.
// 2. Calendar Arithmetic: Timezone-safe addition/subtraction of days and weekday index calculations.
// 3. Grid Positioning: Finding Monday of the current week and ISO 8601 week numbering.
// 4. Localization: German (de-DE) formatting for UI headers, tooltip labels, and timestamps.
//
// Key Principles:
// - UTC-Pinned Math: Calendar arithmetic operates at UTC midnight to avoid daylight saving drifts.
// - Local Time Anchoring: Functions asking "what day is it today" (`todayAsIsoDateString`,
//   `mondayOfDate`) use local wall-clock time so the UI opens on the user's current day.
//
// =======================================================================================

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const WEEKDAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Formats a Date as its UTC calendar day in ISO format ('YYYY-MM-DD').
 * This is the canonical string format used across the database, wire API, and state keys.
 */
export function formatDateAsIsoString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Parses an ISO date string ('YYYY-MM-DD') into a Date at UTC midnight of that day.
 * Returns an `Invalid Date` object if the string is malformed.
 */
export function parseIsoDateString(isoDateString: string): Date {
  const [year, month, day] = isoDateString.split('-');
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/**
 * Computes a new Date `numberOfDays` calendar days after `date` in UTC.
 * Negative numbers move backward in time. Does not mutate the input Date.
 */
export function addDays(date: Date, numberOfDays: number): Date {
  const resultDate = new Date(date);
  resultDate.setUTCDate(resultDate.getUTCDate() + numberOfDays);
  return resultDate;
}

/**
 * Converts a Date into a Monday-first weekday index (Monday=0 .. Sunday=6).
 * Aligns with the 7-day calendar grid layout and machine availability masks ('1111100').
 */
export function mondayFirstWeekdayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * Finds the Monday of the ISO week containing `date`.
 *
 * Logic:
 * 1. Takes the user's local year, month, and day to respect the viewer's current date.
 * 2. Anchors that date at UTC midnight for drift-free calculations.
 * 3. Walks backward by `mondayFirstWeekdayIndex` days to find Monday.
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

/**
 * Returns true if `date` falls on a Saturday or Sunday in UTC.
 */
export function isWeekend(date: Date): boolean {
  const weekday = date.getUTCDay(); // Sunday=0, Saturday=6
  return weekday === 0 || weekday === 6;
}

/**
 * Formats a Date as compact German date string ('DD.MM.') for grid column headers.
 */
export function formatDateShort(date: Date): string {
  return date.toLocaleDateString('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
}

/**
 * Formats an ISO timestamp into a localized German date and time string in the viewer's timezone
 * (e.g. '04.01.2026, 14:30:00'). Used in booking detail dialogs and audit logs.
 */
export function formatTimestamp(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString('de-DE');
}

/**
 * Formats an ISO date string as a full German date label (e.g. 'Mo., 04.01.2026').
 */
export function formatDateLong(isoDateString: string): string {
  return parseIsoDateString(isoDateString).toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Returns the German 2-letter weekday abbreviation (UTC): 'So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'.
 */
export function formatWeekdayName(date: Date): string {
  return WEEKDAY_NAMES[date.getUTCDay() as WeekdayIndex];
}

/**
 * Calculates the ISO 8601 week number (1–53) of `date`.
 *
 * ISO 8601 Logic:
 * 1. Anchors to the Thursday of the same week (which determines the calendar year of the week).
 * 2. Compares against January 4th of that year (which always falls in ISO Week 1).
 * 3. Counts the whole number of weeks elapsed between the two Thursdays.
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
 * Returns today's calendar date in the user's local timezone as an ISO string ('YYYY-MM-DD').
 */
export function todayAsIsoDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generates an array of all weekday ISO strings (Monday through Friday) in the range [from, to] inclusive.
 * Skips Saturday and Sunday.
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
 * Generates an array of all calendar day ISO strings (including weekends) in the range [from, to] inclusive.
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
 * Returns the next business day (Monday–Friday) ISO date strictly after `isoDateString`.
 * If given Friday, skips the weekend and returns the following Monday.
 */
export function nextWeekday(isoDateString: string): string {
  let candidateDate = addDays(parseIsoDateString(isoDateString), 1);
  while (isWeekend(candidateDate)) {
    candidateDate = addDays(candidateDate, 1);
  }
  return formatDateAsIsoString(candidateDate);
}

/**
 * Returns the previous business day (Monday–Friday) ISO date strictly before `isoDateString`.
 * If given Monday, skips the weekend and returns the preceding Friday.
 */
export function previousWeekday(isoDateString: string): string {
  let candidateDate = addDays(parseIsoDateString(isoDateString), -1);
  while (isWeekend(candidateDate)) {
    candidateDate = addDays(candidateDate, -1);
  }
  return formatDateAsIsoString(candidateDate);
}
