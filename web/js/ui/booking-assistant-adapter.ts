import { format, parseISO } from 'date-fns';
import type { BookingData, Machine } from '../../../shared/types.ts';
import { getAllDaysInRange } from '../../../shared/dates.ts';
import { CATEGORIES, getMachineCategory } from '../core/machines.ts';
import { availableForBooking, searchBookingWindows } from '../core/booking-assistant-search.ts';
import type {
  AvailabilityWindow,
  CatalogCategory,
  DateRange,
  PlanEntry,
} from '../core/booking-assistant-types.ts';

/** DatePicker uses local Dates; format calendar components before crossing the ISO wire boundary. */
export function searchAssistant(
  data: BookingData,
  plan: PlanEntry[],
  range: DateRange,
  minDays: number,
  maxDays: number,
): AvailabilityWindow[] {
  if (!range.from || !range.to) throw new Error('Bitte Start- und Enddatum wählen.');
  const from = format(range.from, 'yyyy-MM-dd');
  const to = format(range.to, 'yyyy-MM-dd');
  return searchBookingWindows(data, plan, from, to, minDays, maxDays).map((window, index) => ({
    id: `window-${index}-${window.dates[0]}`,
    start: parseISO(window.dates[0]!),
    end: parseISO(window.dates[window.dates.length - 1]!),
    openEnded: false,
    spanDays: window.dates.length,
    minSelectableDays: window.minDays,
    maxSelectableDays: window.maxDays,
    selectedDays: window.maxDays,
    devices: window.devices,
  }));
}

/** The backend has no inventory-code or lab field: use the real ID and department. */
export function assistantCatalog(
  machines: readonly Machine[],
  favorites: ReadonlySet<string>,
): CatalogCategory[] {
  const device = (machine: Machine) => ({
    id: machine.id,
    name: machine.name,
    code: machine.id,
    lab: machine.group,
    info: machine.info,
  });
  const catalog: CatalogCategory[] = [
    {
      id: 'favorites',
      label: 'Favoriten',
      starred: true,
      devices: machines.filter((m) => favorites.has(m.id)).map(device),
    },
  ];
  for (const category of CATEGORIES) {
    const members = machines.filter((m) => getMachineCategory(m) === category.id);
    for (const group of new Set(members.map((m) => m.group)))
      catalog.push({
        id: JSON.stringify([category.id, group]),
        label: group,
        section: { id: category.id, label: category.label },
        devices: members.filter((m) => m.group === group).map(device),
      });
  }
  return catalog.filter((category) => category.devices.length > 0);
}

/** Recheck the frozen result against the latest SSE state before opening confirmation. */
export function assistantBooking(data: BookingData, window: AvailabilityWindow) {
  const count = window.selectedDays;
  if (
    !Number.isInteger(count) ||
    count < window.minSelectableDays ||
    count > window.maxSelectableDays
  )
    throw new Error('Bitte eine gültige Anzahl Buchungstage wählen.');
  const dates = getAllDaysInRange(
    format(window.start, 'yyyy-MM-dd'),
    format(window.end, 'yyyy-MM-dd'),
  ).slice(0, count);
  const ids = window.devices.map((device) => device.deviceId);
  if (
    dates.length !== count ||
    !ids.length ||
    ids.some((id) => dates.some((day) => !availableForBooking(data, id, day)))
  )
    throw new Error('Die Verfügbarkeit hat sich geändert. Bitte erneut suchen.');
  return { ids, dates, from: dates[0]!, to: dates[dates.length - 1]! };
}
