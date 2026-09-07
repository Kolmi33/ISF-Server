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
import { buildPlanCandidates } from './booking-assistant-candidates.ts';
import type { AvailabilitySet, Candidate } from './booking-assistant-candidates.ts';
import type { PlanEntry, ResolvedDevice } from './booking-assistant-types.ts';

export type { AvailabilitySet, Candidate } from './booking-assistant-candidates.ts';

export interface BookingWindow {
  /** Der vollständige bekannte freie Buchungszeitraum. */
  dates: string[];
  devices: ResolvedDevice[];
  /** Kein bekannter zukünftiger Konflikt auf einem Arbeitstag. */
  openEnded: boolean;
  minDays: number;
  /** Höchstens so viele Arbeitstage dürfen aus diesem Zeitraum gebucht werden. */
  maxDays: number;
}

/** Availability on one concrete day. Search callers only pass Monday through Friday. */
export function availableForBooking(data: BookingData, id: string, day: string): boolean {
  const machine = data.machines.find((candidate) => candidate.id === id);
  return !!machine && machineAvailableForBooking(data, machine, day);
}

function machineAvailableForBooking(data: BookingData, machine: Machine, day: string): boolean {
  return (
    !getBooking(data.bookings, machine.id, day) &&
    !isMachineBlockedOnDate(machine, day) &&
    isMachineAvailableOnWeekday(machine, day)
  );
}

function nextWorkday(day: string): string {
  let date = addDays(parseIsoDateString(day), 1);
  while (isWeekend(date)) date = addDays(date, 1);
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

function validateSearch(from: string, to: string, minDays: number, maxDays: number): void {
  if (!from || !to || from > to) throw new Error('Bitte einen gültigen Zeitraum wählen.');
  if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 1 || maxDays < minDays)
    throw new Error('Bitte gültige Mindest- und Höchstdauer eingeben.');
}

/** Include enough workdays after the latest allowed start to test the minimum duration once. */
function evaluationWorkdays(starts: string[], minDays: number): string[] {
  const days = [...starts];
  while (days.length < starts.length + minDays - 1) days.push(nextWorkday(days.at(-1)!));
  return days;
}

interface IndexedRun {
  dates: string[];
  reachesEvaluationEnd: boolean;
}

function freeRuns(
  availability: AvailabilitySet,
  days: string[],
  minDays: number,
  lastStartIndex: number,
): IndexedRun[] {
  const runs: IndexedRun[] = [];
  let start = -1;
  const finish = (end: number): void => {
    if (start >= 0 && start <= lastStartIndex && end - start >= minDays)
      runs.push({ dates: days.slice(start, end), reachesEvaluationEnd: end === days.length });
    start = -1;
  };
  for (let index = 0; index < availability.length; index++) {
    if (availability[index]) {
      if (start < 0) start = index;
    } else finish(index);
  }
  finish(availability.length);
  return runs;
}

function groupedDeviceIds(plan: PlanEntry[]): Set<string> {
  const grouped = new Set<string>();
  const visit = (entry: PlanEntry, insideGroup: boolean): void => {
    if (entry.kind === 'device') {
      if (insideGroup) grouped.add(entry.deviceId);
      return;
    }
    for (const member of entry.members) visit(member, true);
  };
  for (const entry of plan) visit(entry, false);
  return grouped;
}

/** Extend the trailing evaluated run to its first known conflict, or enough days to book it. */
function extendRun(
  data: BookingData,
  machineIds: string[],
  dates: string[],
  maxDays: number,
  boundaryCache: Map<string, string | null>,
): { dates: string[]; openEnded: boolean } {
  let day = nextWorkday(dates.at(-1)!);
  const boundary = machineIds.reduce<string | null>((earliest, machineId) => {
    let blockedOn = boundaryCache.get(machineId);
    if (blockedOn === undefined) {
      blockedOn = nextBlockedWorkday(data, machineId, day);
      boundaryCache.set(machineId, blockedOn);
    }
    return earlierBoundary(earliest, blockedOn);
  }, null);
  const extended = [...dates];
  if (boundary === null) {
    extended.splice(maxDays);
    while (extended.length < maxDays) {
      extended.push(day);
      day = nextWorkday(day);
    }
    return { dates: extended, openEnded: true };
  }
  while (day !== boundary) {
    extended.push(day);
    day = nextWorkday(day);
  }
  return { dates: extended, openEnded: false };
}

function machineAvailability(
  data: BookingData,
  machineIds: string[],
  days: string[],
): Map<string, AvailabilitySet> {
  const machinesById = new Map(data.machines.map((machine) => [machine.id, machine]));
  return new Map(
    machineIds.map((machineId) => {
      const machine = machinesById.get(machineId);
      return [
        machineId,
        days.map((day) => !!machine && machineAvailableForBooking(data, machine, day)),
      ];
    }),
  );
}

function windowsForCandidates(
  data: BookingData,
  plan: PlanEntry[],
  candidates: Candidate[],
  days: string[],
  lastStartIndex: number,
  minDays: number,
  maxDays: number,
): BookingWindow[] {
  const grouped = groupedDeviceIds(plan);
  const boundaryCache = new Map<string, string | null>();
  const windows: BookingWindow[] = [];
  for (const candidate of candidates)
    for (const run of freeRuns(candidate.availability, days, minDays, lastStartIndex)) {
      const resolved = run.reachesEvaluationEnd
        ? extendRun(data, candidate.machineIds, run.dates, maxDays, boundaryCache)
        : { dates: run.dates, openEnded: false };
      if (resolved.dates.length < minDays) continue;
      windows.push({
        dates: resolved.dates,
        devices: candidate.machineIds.map<ResolvedDevice>((deviceId) => ({
          deviceId,
          fromGroup: grouped.has(deviceId),
        })),
        openEnded: resolved.openEnded,
        minDays,
        maxDays: Math.min(maxDays, resolved.dates.length),
      });
    }
  return windows;
}

function rankWindows(windows: BookingWindow[]): BookingWindow[] {
  return windows.sort(
    (a, b) =>
      Number(b.openEnded) - Number(a.openEnded) ||
      b.dates.length - a.dates.length ||
      a.dates[0]!.localeCompare(b.dates[0]!) ||
      a.devices
        .map(({ deviceId }) => deviceId)
        .join('\u0000')
        .localeCompare(b.devices.map(({ deviceId }) => deviceId).join('\u0000')),
  );
}

/** Expand the plan once, then return every qualifying free run of every fixed combination. */
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
  const days = evaluationWorkdays(starts, minDays);
  const machineIds = [...new Set(plan.flatMap(deviceIdsOf))];
  const availabilityByMachine = machineAvailability(data, machineIds, days);
  const lastStartIndex = starts.length - 1;
  const candidates = buildPlanCandidates(
    plan,
    availabilityByMachine,
    days.length,
    minDays,
    lastStartIndex,
  );
  return rankWindows(
    windowsForCandidates(data, plan, candidates, days, lastStartIndex, minDays, maxDays),
  );
}
