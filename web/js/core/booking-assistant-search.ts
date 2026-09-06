import {
  addDays,
  formatDateAsIsoString,
  getWeekdaysInRange,
  isWeekend,
  parseIsoDateString,
} from '../../../shared/dates.ts';
import type { BookingData, Machine } from '../../../shared/types.ts';
import { getBooking } from './bookings.ts';
import {
  getMaintenanceSlots,
  isMachineAvailableOnWeekday,
  isMachineBlockedOnDate,
} from './machines.ts';
import type { PlanEntry, ResolvedDevice } from './booking-assistant-types.ts';

export interface BookingWindow {
  /** Der einmal angebotene Buchungszeitraum, bereits auf `maxDays` begrenzt. */
  dates: string[];
  devices: ResolvedDevice[];
  /** Kein bekannter zukünftiger Konflikt auf einem Arbeitstag. */
  openEnded: boolean;
  minDays: number;
  maxDays: number;
}

/** Availability on one concrete day. Search callers only pass Monday through Friday. */
export function availableForBooking(data: BookingData, id: string, day: string): boolean {
  const machine = data.machines.find((m) => m.id === id);
  return (
    !!machine &&
    !getBooking(data.bookings, id, day) &&
    !isMachineBlockedOnDate(machine, day) &&
    isMachineAvailableOnWeekday(machine, day)
  );
}

function nextWorkday(day: string): string {
  let date = addDays(parseIsoDateString(day), 1);
  while (isWeekend(date)) date = addDays(date, 1);
  return formatDateAsIsoString(date);
}

function previousWorkday(day: string): string {
  let date = addDays(parseIsoDateString(day), -1);
  while (isWeekend(date)) date = addDays(date, -1);
  return formatDateAsIsoString(date);
}

function firstWorkdayOnOrAfter(day: string): string {
  let date = parseIsoDateString(day);
  while (isWeekend(date)) date = addDays(date, 1);
  return formatDateAsIsoString(date);
}

const earlierBoundary = (a: string | null, b: string | null): string | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
};

function recurringBoundary(machine: Machine, start: string): string | null {
  /* A recurring weekday restriction must appear within the next five booking days. */
  let weekday = start;
  for (let index = 0; index < 5; index++) {
    if (!isMachineAvailableOnWeekday(machine, weekday)) return weekday;
    weekday = nextWorkday(weekday);
  }
  return null;
}

function bookingBoundary(data: BookingData, id: string, start: string): string | null {
  return (
    Object.keys(data.bookings[id] ?? {})
      .filter((day) => day >= start && !isWeekend(parseIsoDateString(day)))
      .sort()[0] ?? null
  );
}

function maintenanceBoundary(machine: Machine, start: string): string | null {
  let boundary: string | null = null;
  for (const slot of getMaintenanceSlots(machine)) {
    if (slot.until && slot.until < start) continue;
    const firstCoveredWorkday = firstWorkdayOnOrAfter(
      slot.from && slot.from > start ? slot.from : start,
    );
    if (!slot.until || firstCoveredWorkday <= slot.until)
      boundary = earlierBoundary(boundary, firstCoveredWorkday);
  }
  return boundary;
}

/** First known workday on which this device cannot be booked. `null` means no known boundary. */
function nextBlockedWorkday(data: BookingData, id: string, start: string): string | null {
  const machine = data.machines.find((candidate) => candidate.id === id);
  if (!machine) return start;
  return [
    recurringBoundary(machine, start),
    bookingBoundary(data, id, start),
    maintenanceBoundary(machine, start),
  ].reduce<string | null>(earlierBoundary, null);
}

interface Choice {
  /** Erster blockierter Arbeitstag; `null` ist nach aktuellem Stand Open End. */
  blockedOn: string | null;
  devices: ResolvedDevice[];
}

/** Choose the longest-lived alternatives, retaining exactly those devices for the whole row.
 *
 *  Recurses through nested requirement groups: a group takes the `requiredCount` longest-lived
 *  of its members, each member having been resolved the same way. Greedy is exact here because
 *  the members' device sets are disjoint (`validatePlan`), so taking the longest-lived ones
 *  maximises the minimum — no member's choice can improve another's. */
function chooseAt(data: BookingData, entry: PlanEntry, start: string): Choice {
  if (entry.kind === 'device')
    return {
      blockedOn: nextBlockedWorkday(data, entry.deviceId, start),
      devices: [{ deviceId: entry.deviceId, fromGroup: false }],
    };
  const chosen = entry.members
    .map((member) => chooseAt(data, member, start))
    .sort((a, b) => {
      if (a.blockedOn === null) return b.blockedOn === null ? 0 : -1;
      if (b.blockedOn === null) return 1;
      return b.blockedOn.localeCompare(a.blockedOn);
    })
    .slice(0, entry.requiredCount);
  return {
    blockedOn: chosen.reduce<string | null>(
      (boundary, choice) => earlierBoundary(boundary, choice.blockedOn),
      null,
    ),
    /* Alles, was über eine Gruppe hereinkommt, ist stellvertretend gewählt — auch aus einer
       Untergruppe. */
    devices: chosen.flatMap((choice) =>
      choice.devices.map((device) => ({ ...device, fromGroup: true })),
    ),
  };
}

function validatePlan(plan: PlanEntry[]): void {
  const ids = plan.flatMap(deviceIdsOf);
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('Bitte Geräte eindeutig auswählen.');
  const checkCounts = (entries: PlanEntry[]): void => {
    for (const entry of entries) {
      if (entry.kind !== 'group') continue;
      if (
        !Number.isInteger(entry.requiredCount) ||
        entry.requiredCount < 1 ||
        entry.requiredCount > entry.members.length
      )
        throw new Error('Bitte die Anzahl benötigter Geräte prüfen.');
      checkCounts(entry.members);
    }
  };
  checkCounts(plan);
}

/** Every device below an entry, however deeply nested. */
const deviceIdsOf = (entry: PlanEntry): string[] =>
  entry.kind === 'group' ? entry.members.flatMap(deviceIdsOf) : [entry.deviceId];

function offeredWorkdays(start: string, blockedOn: string | null, limit: number): string[] {
  const dates: string[] = [];
  let day = start;
  while (dates.length < limit && day !== blockedOn) {
    dates.push(day);
    day = nextWorkday(day);
  }
  return dates;
}

function validateSearch(from: string, to: string, minDays: number, maxDays: number): void {
  if (!from || !to || from > to) throw new Error('Bitte einen gültigen Zeitraum wählen.');
  if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 1 || maxDays < minDays)
    throw new Error('Bitte gültige Mindest- und Höchstdauer eingeben.');
}

interface CandidateWindow {
  window: BookingWindow;
  rawEnd: string | null;
}

function candidateWindow(
  data: BookingData,
  plan: PlanEntry[],
  start: string,
  minDays: number,
  maxDays: number,
): CandidateWindow | null {
  const choices = plan.map((entry) => chooseAt(data, entry, start));
  const blockedOn = choices.reduce<string | null>(
    (boundary, choice) => earlierBoundary(boundary, choice.blockedOn),
    null,
  );
  const dates = offeredWorkdays(start, blockedOn, maxDays);
  if (dates.length < minDays) return null;
  return {
    rawEnd: blockedOn === null ? null : previousWorkday(blockedOn),
    window: {
      dates,
      devices: choices.flatMap((choice) => choice.devices),
      openEnded: blockedOn === null,
      minDays,
      maxDays: dates.length,
    },
  };
}

/** Each non-dominated free run produces one result. Its raw end suppresses shorter variants of
 * the same run; only the offered dates are capped to the requested maximum duration. */
export function searchBookingWindows(
  data: BookingData,
  plan: PlanEntry[],
  from: string,
  to: string,
  minDays: number,
  maxDays: number,
): BookingWindow[] {
  validatePlan(plan);
  validateSearch(from, to, minDays, maxDays);
  const starts = getWeekdaysInRange(from, to);
  if (!starts.length) throw new Error('Der gewählte Zeitraum enthält keine Arbeitstage.');
  const windows: BookingWindow[] = [];
  let lastRawEnd: string | undefined;
  let foundOpenRun = false;
  for (const start of starts) {
    if (foundOpenRun) break;
    const candidate = candidateWindow(data, plan, start, minDays, maxDays);
    if (!candidate) continue;
    const { rawEnd, window } = candidate;
    if (rawEnd !== null && lastRawEnd && rawEnd <= lastRawEnd) continue;
    if (rawEnd === null) foundOpenRun = true;
    else lastRawEnd = rawEnd;
    windows.push(window);
  }
  return windows.sort(
    (a, b) =>
      Number(b.openEnded) - Number(a.openEnded) ||
      b.dates.length - a.dates.length ||
      a.dates[0]!.localeCompare(b.dates[0]!),
  );
}
