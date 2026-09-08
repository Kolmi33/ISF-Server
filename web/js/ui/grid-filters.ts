import type { BookingData, Machine } from '../../../shared/types.ts';
import { isWeekend, parseIsoDateString, todayAsIsoDateString } from '../../../shared/dates.ts';
import { isMachineAvailableOnWeekday, isMachineBlockedOnDate } from '../core/machines.ts';

export interface GridFilterCriteria {
  query: string;
  groups: ReadonlySet<string>;
  machineIds: ReadonlySet<string>;
  availableOnly: boolean;
  operationalOnly: boolean;
  favoritesOnly: boolean;
  favoriteIds: ReadonlySet<string>;
}

function matchesMachine(
  data: BookingData,
  machine: Machine,
  dates: readonly string[],
  criteria: GridFilterCriteria,
  needle: string,
  today: string,
): boolean {
  const searchable = [machine.name, machine.group, machine.id, machine.info || '']
    .join(' ')
    .toLowerCase();
  if (needle && !searchable.includes(needle)) return false;
  if (!matchesSelections(machine, criteria)) return false;
  if (criteria.operationalOnly && isMachineBlockedOnDate(machine, today)) return false;
  return !criteria.availableOnly || isFreeThroughout(data, machine, dates);
}

function matchesSelections(machine: Machine, criteria: GridFilterCriteria): boolean {
  if (criteria.groups.size && !criteria.groups.has(machine.group)) return false;
  if (criteria.machineIds.size && !criteria.machineIds.has(machine.id)) return false;
  return !criteria.favoritesOnly || criteria.favoriteIds.has(machine.id);
}

function isFreeThroughout(data: BookingData, machine: Machine, dates: readonly string[]): boolean {
  return dates
    .filter((date) => !isWeekend(parseIsoDateString(date)))
    .every(
      (date) =>
        isMachineAvailableOnWeekday(machine, date) &&
        !isMachineBlockedOnDate(machine, date) &&
        !data.bookings[machine.id]?.[date],
    );
}

/** Returns an explicit set (including an empty set) so a zero-result filter never falls back
 * to the grid's historic "empty selection means all" convention. */
export function matchingGridMachineIds(
  data: BookingData,
  dates: readonly string[],
  criteria: GridFilterCriteria,
): Set<string> {
  const needle = criteria.query.trim().toLowerCase();
  const today = todayAsIsoDateString();
  return new Set(
    data.machines
      .filter((machine) => matchesMachine(data, machine, dates, criteria, needle, today))
      .map((machine) => machine.id),
  );
}

export function hasGridFilters(criteria: GridFilterCriteria): boolean {
  return !!(
    criteria.query.trim() ||
    criteria.groups.size ||
    criteria.machineIds.size ||
    criteria.availableOnly ||
    criteria.operationalOnly ||
    criteria.favoritesOnly
  );
}
