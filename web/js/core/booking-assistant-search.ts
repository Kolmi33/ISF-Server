import { getAllDaysInRange } from '../../../shared/dates.ts';
import type { BookingData } from '../../../shared/types.ts';
import { getBooking } from './bookings.ts';
import { isMachineAvailableOnWeekday, isMachineBlockedOnDate } from './machines.ts';
import type { PlanEntry, ResolvedDevice } from './booking-assistant-types.ts';

export interface BookingWindow {
  dates: string[];
  devices: ResolvedDevice[];
  minDays: number;
  maxDays: number;
}

/** Calendar-day search: no skipped days or unchecked weekend bridges. */
export function availableForBooking(data: BookingData, id: string, day: string): boolean {
  const machine = data.machines.find((m) => m.id === id);
  return (
    !!machine &&
    !getBooking(data.bookings, id, day) &&
    !isMachineBlockedOnDate(machine, day) &&
    isMachineAvailableOnWeekday(machine, day)
  );
}

function freeLengths(data: BookingData, ids: string[], dates: string[]): Map<string, number[]> {
  return new Map(
    ids.map((id) => {
      const lengths = new Array<number>(dates.length).fill(0);
      for (let index = dates.length - 1; index >= 0; index--)
        lengths[index] = availableForBooking(data, id, dates[index]!)
          ? 1 + (lengths[index + 1] ?? 0)
          : 0;
      return [id, lengths];
    }),
  );
}

interface Choice {
  /** Tage, die diese Wahl ab `index` am Stück trägt — bei einer Gruppe die kürzeste ihrer
   *  gewählten Alternativen, denn alle müssen gleichzeitig frei sein. */
  length: number;
  devices: ResolvedDevice[];
}

/** Choose the longest-lived alternatives, retaining exactly those devices for the whole row.
 *
 *  Recurses through nested requirement groups: a group takes the `requiredCount` longest-lived
 *  of its members, each member having been resolved the same way. Greedy is exact here because
 *  the members' device sets are disjoint (`validatePlan`), so taking the longest-lived ones
 *  maximises the minimum — no member's choice can improve another's. */
function chooseAt(entry: PlanEntry, lengths: Map<string, number[]>, index: number): Choice {
  if (entry.kind === 'device')
    return {
      length: lengths.get(entry.deviceId)![index]!,
      devices: [{ deviceId: entry.deviceId, fromGroup: false }],
    };
  const chosen = entry.members
    .map((member) => chooseAt(member, lengths, index))
    .sort((a, b) => b.length - a.length)
    .slice(0, entry.requiredCount);
  return {
    length: Math.min(...chosen.map((choice) => choice.length)),
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

/** Each non-dominated window is maximal for a fixed device assignment, within the search horizon. */
export function searchBookingWindows(
  data: BookingData,
  plan: PlanEntry[],
  from: string,
  to: string,
  minDays: number,
  maxDays: number,
): BookingWindow[] {
  validatePlan(plan);
  if (!from || !to || from > to) throw new Error('Bitte einen gültigen Zeitraum wählen.');
  if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 1 || maxDays < minDays)
    throw new Error('Bitte gültige Mindest- und Höchstdauer eingeben.');
  const dates = getAllDaysInRange(from, to);
  const lengths = freeLengths(data, plan.flatMap(deviceIdsOf), dates);
  const windows: BookingWindow[] = [];
  let lastEnd = -1;
  for (let index = 0; index < dates.length; index++) {
    const choices = plan.map((entry) => chooseAt(entry, lengths, index));
    const length = Math.min(...choices.map((choice) => choice.length));
    if (length < minDays || index + length - 1 <= lastEnd) continue;
    lastEnd = index + length - 1;
    windows.push({
      dates: dates.slice(index, index + length),
      devices: choices.flatMap((choice) => choice.devices),
      minDays,
      maxDays: Math.min(maxDays, length),
    });
  }
  return windows;
}
