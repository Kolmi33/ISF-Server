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

/** Choose the longest-lived alternatives, retaining exactly those devices for the whole row. */
function resolveAt(plan: PlanEntry[], lengths: Map<string, number[]>, index: number) {
  return plan.flatMap((entry) => {
    const fromGroup = entry.kind === 'group';
    const ids = entry.kind === 'group' ? entry.deviceIds : [entry.deviceId];
    const need = entry.kind === 'group' ? entry.requiredCount : 1;
    return ids
      .map((deviceId) => ({ deviceId, fromGroup, length: lengths.get(deviceId)![index]! }))
      .sort((a, b) => b.length - a.length)
      .slice(0, need);
  });
}

function validatePlan(plan: PlanEntry[]): void {
  const ids = plan.flatMap((entry) => {
    if (entry.kind === 'device') return [entry.deviceId];
    if (
      !Number.isInteger(entry.requiredCount) ||
      entry.requiredCount < 1 ||
      entry.requiredCount > entry.deviceIds.length
    )
      throw new Error('Bitte die Anzahl benötigter Geräte prüfen.');
    return entry.deviceIds;
  });
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('Bitte Geräte eindeutig auswählen.');
}

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
  const ids = plan.flatMap((entry) =>
    entry.kind === 'group' ? entry.deviceIds : [entry.deviceId],
  );
  const lengths = freeLengths(data, ids, dates);
  const windows: BookingWindow[] = [];
  let lastEnd = -1;
  for (let index = 0; index < dates.length; index++) {
    const devices = resolveAt(plan, lengths, index);
    const length = Math.min(...devices.map((device) => device.length));
    if (length < minDays || index + length - 1 <= lastEnd) continue;
    lastEnd = index + length - 1;
    windows.push({
      dates: dates.slice(index, index + length),
      devices: devices.map(({ deviceId, fromGroup }) => ({ deviceId, fromGroup })),
      minDays,
      maxDays: Math.min(maxDays, length),
    });
  }
  return windows;
}
