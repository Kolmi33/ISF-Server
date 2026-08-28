// Pure date helpers extracted from the monolith (legacy.js). No DOM, no globals —
// data → data, so they are trivially testable (this is where our tests concentrate).
//
// Convention (preserved from the original): the external currency is the ISO date
// string 'YYYY-MM-DD'. Such strings sort correctly lexicographically and are used
// directly as object keys in `bookings`. Date math runs in UTC so it never drifts
// with the viewer's timezone; only `mondayOf`/`todayStr` read local calendar
// components, exactly as the original did.

const WEEKDAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A Date → its UTC calendar day as 'YYYY-MM-DD'. */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → a Date at UTC midnight of that day. Malformed input → Invalid Date. */
export function parseYmd(s: string): Date {
  const parts = s.split('-');
  return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
}

/** A new Date `n` calendar days after `d` (UTC). Does not mutate `d`. */
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** The Monday (UTC midnight) of the ISO week containing `d`. Reads local Y/M/D, as the original. */
export function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const wd = (x.getUTCDay() + 6) % 7;
  return addDays(x, -wd);
}

/** True if `d` falls on a Saturday or Sunday (UTC). */
export function isWeekend(d: Date): boolean {
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6;
}

/** A Date → 'DD.MM.' in de-DE (UTC), e.g. grid column labels. */
export function fmtShort(d: Date): string {
  return d.toLocaleDateString('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
}

/** An ISO date string → a long de-DE label, e.g. 'Mo., 04.01.2021' (UTC). */
export function fmtLong(s: string): string {
  return parseYmd(s).toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** A Date → its German 2-letter weekday abbreviation (UTC): 'So','Mo',…,'Sa'. */
export function weekdayName(d: Date): string {
  return WEEKDAY_NAMES[d.getUTCDay() as WeekdayIndex];
}

/** The ISO 8601 week number (1–53) of `d`. */
export function isoWeek(d: Date): number {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + 3 - ((x.getUTCDay() + 6) % 7));
  const w1 = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  return (
    1 + Math.round(((x.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7)
  );
}

/** Today's local calendar day as 'YYYY-MM-DD' (reads local time, as the original). */
export function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/** All weekdays (Mon–Fri) as ISO strings from `fromS` to `toS`, inclusive. */
export function weekdayRange(fromS: string, toS: string): string[] {
  const out: string[] = [];
  let d = parseYmd(fromS);
  const end = parseYmd(toS);
  while (d <= end) {
    if (!isWeekend(d)) out.push(ymd(d));
    d = addDays(d, 1);
  }
  return out;
}

/** All calendar days (incl. weekends) as ISO strings from `fromS` to `toS`, inclusive. */
export function allDaysRange(fromS: string, toS: string): string[] {
  const out: string[] = [];
  let d = parseYmd(fromS);
  const end = parseYmd(toS);
  while (d <= end) {
    out.push(ymd(d));
    d = addDays(d, 1);
  }
  return out;
}
