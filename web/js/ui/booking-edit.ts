import type { Booking, BookingData, Machine } from '../../../shared/types.ts';
import {
  addDays,
  formatDateAsIsoString,
  isWeekend,
  parseIsoDateString,
} from '../../../shared/dates.ts';
import {
  getMachineCategory,
  getMaintenanceSlotAtDate,
  isMachineAvailableOnWeekday,
  isMachineBlockedOnDate,
} from '../core/machines.ts';
import { sweepWeekends, type CellUndo, type Conflict } from '../core/bookings.ts';
import type { MyBookingCampaign } from './views/my-bookings.ts';

export type BookingEditCategory = 'maschine' | 'messtechnik';
export type BookingEditBlockKind = 'foreign' | 'maintenance' | 'unavailable' | 'past';

export interface BookingEditRow {
  machineId: string;
  category: BookingEditCategory;
  dates: string[];
}

export interface BookingEditModel {
  campaign: MyBookingCampaign;
  today: string;
  days: string[];
  initialRows: BookingEditRow[];
  initialBookings: ReadonlyMap<string, Booking>;
}

export interface BookingEditBlock {
  kind: BookingEditBlockKind;
  label: string;
}

export interface BookingEditApplyResult {
  abort?: boolean;
  conflicts?: Conflict[];
  count?: number;
  deletedCount?: number;
  undo?: CellUndo[];
  error?: string;
}

const LEAD_DAYS = 3;
const TRAIL_DAYS = 7;
const keyOf = (machineId: string, date: string) => `${machineId}\u0000${date}`;
const normalized = (value: string) => value.trim().toLowerCase();

function matchesCampaign(
  campaign: MyBookingCampaign,
  machineId: string,
  date: string,
  booking: Booking | undefined,
): boolean {
  if (!booking || normalized(booking.name) !== normalized(campaign.owner)) return false;
  if (campaign.groupId) return booking.gid === campaign.groupId;
  return campaign.cells.some((cell) => cell.machineId === machineId && cell.date === date);
}

function campaignEntries(data: BookingData, campaign: MyBookingCampaign, today: string) {
  const entries: { machine: Machine; date: string; booking: Booking }[] = [];
  for (const machine of data.machines) {
    for (const [date, booking] of Object.entries(data.bookings[machine.id] || {})) {
      if (date < today || isWeekend(parseIsoDateString(date))) continue;
      if (matchesCampaign(campaign, machine.id, date, booking)) {
        entries.push({ machine, date, booking });
      }
    }
  }
  return entries;
}

/** Builds the editor exclusively from live booking cells; the supplied mock data is never used. */
export function buildBookingEditModel(
  data: BookingData,
  campaign: MyBookingCampaign,
  today: string,
): BookingEditModel {
  const entries = campaignEntries(data, campaign, today);
  const byMachine = new Map<string, BookingEditRow>();
  const initialBookings = new Map<string, Booking>();
  for (const { machine, date, booking } of entries) {
    let row = byMachine.get(machine.id);
    if (!row) {
      row = { machineId: machine.id, category: getMachineCategory(machine), dates: [] };
      byMachine.set(machine.id, row);
    }
    row.dates.push(date);
    initialBookings.set(keyOf(machine.id, date), { ...booking });
  }
  const initialRows = [...byMachine.values()].map((row) => ({
    ...row,
    dates: [...new Set(row.dates)].sort(),
  }));
  const dates = initialRows.flatMap((row) => row.dates).sort();
  const first = dates[0] || today;
  const last = dates[dates.length - 1] || first;
  const axisStart = addDays(parseIsoDateString(first), -LEAD_DAYS);
  const axisEnd = addDays(parseIsoDateString(last), TRAIL_DAYS);
  const dayCount = Math.round((axisEnd.getTime() - axisStart.getTime()) / 86_400_000) + 1;
  const days = Array.from({ length: dayCount }, (_, index) =>
    formatDateAsIsoString(addDays(axisStart, index)),
  );
  return { campaign, today, days, initialRows, initialBookings };
}

export function bookingEditBlock(
  data: BookingData,
  model: BookingEditModel,
  machineId: string,
  date: string,
): BookingEditBlock | null {
  if (date < model.today) return { kind: 'past', label: 'Vergangener Tag' };
  const machine = data.machines.find((candidate) => candidate.id === machineId);
  if (!machine) return { kind: 'unavailable', label: 'Gerät nicht mehr vorhanden' };
  const existing = data.bookings[machineId]?.[date];
  if (matchesCampaign(model.campaign, machineId, date, existing)) return null;
  if (isMachineBlockedOnDate(machine, date)) {
    const slot = getMaintenanceSlotAtDate(machine, date);
    return {
      kind: 'maintenance',
      label: slot?.note || (slot?.type === 'defekt' ? 'Defekt' : 'Wartung'),
    };
  }
  if (!isMachineAvailableOnWeekday(machine, date)) {
    return { kind: 'unavailable', label: 'An diesem Wochentag nicht verfügbar' };
  }
  if (existing) return { kind: 'foreign', label: `Belegt von ${existing.name}` };
  return null;
}

export function cloneBookingEditRows(rows: readonly BookingEditRow[]): BookingEditRow[] {
  return rows.map((row) => ({ ...row, dates: [...row.dates] }));
}

export function shiftBookingEditRows(
  rows: readonly BookingEditRow[],
  delta: number,
  machineId?: string,
  allowedDays?: readonly string[],
): BookingEditRow[] {
  const shifted = rows.map((row) =>
    machineId && row.machineId !== machineId
      ? { ...row, dates: [...row.dates] }
      : {
          ...row,
          dates: row.dates.map((date) =>
            formatDateAsIsoString(addDays(parseIsoDateString(date), delta)),
          ),
        },
  );
  if (
    allowedDays &&
    shifted.some(
      (row) =>
        (!machineId || row.machineId === machineId) &&
        row.dates.some((date) => !allowedDays.includes(date)),
    )
  ) {
    return cloneBookingEditRows(rows);
  }
  return shifted;
}

export function toggleBookingEditDate(
  data: BookingData,
  model: BookingEditModel,
  rows: readonly BookingEditRow[],
  machineId: string,
  date: string,
): BookingEditRow[] {
  return rows.map((row) => {
    if (row.machineId !== machineId) return { ...row, dates: [...row.dates] };
    if (row.dates.includes(date)) {
      if (row.dates.length === 1) return { ...row, dates: [...row.dates] };
      return { ...row, dates: row.dates.filter((candidate) => candidate !== date) };
    }
    if (bookingEditBlock(data, model, machineId, date)) return { ...row, dates: [...row.dates] };
    return { ...row, dates: [...row.dates, date].sort() };
  });
}

export function resizeBookingEditRow(
  data: BookingData,
  model: BookingEditModel,
  rows: readonly BookingEditRow[],
  machineId: string,
  edge: 'start' | 'end',
  targetDate: string,
): BookingEditRow[] {
  return rows.map((row) =>
    row.machineId === machineId
      ? resizeDates(data, model, row, edge, targetDate)
      : { ...row, dates: [...row.dates] },
  );
}

function resizeDates(
  data: BookingData,
  model: BookingEditModel,
  row: BookingEditRow,
  edge: 'start' | 'end',
  requestedTarget: string,
): BookingEditRow {
  const first = row.dates[0]!;
  const last = row.dates.at(-1)!;
  const target =
    edge === 'start'
      ? requestedTarget > last
        ? last
        : requestedTarget
      : requestedTarget < first
        ? first
        : requestedTarget;
  const shrinking = edge === 'start' ? target >= first : target <= last;
  if (shrinking) {
    const dates = row.dates.filter((date) => (edge === 'start' ? date >= target : date <= target));
    return { ...row, dates: dates.length ? dates : [edge === 'start' ? last : first] };
  }
  return { ...row, dates: growDates(data, model, row, edge, target) };
}

function growDates(
  data: BookingData,
  model: BookingEditModel,
  row: BookingEditRow,
  edge: 'start' | 'end',
  target: string,
): string[] {
  const direction = edge === 'start' ? -1 : 1;
  const boundary = edge === 'start' ? row.dates[0]! : row.dates.at(-1)!;
  const additions: string[] = [];
  let cursor = formatDateAsIsoString(addDays(parseIsoDateString(boundary), direction));
  const hasMore = () => (direction < 0 ? cursor >= target : cursor <= target);
  while (hasMore()) {
    const block = bookingEditBlock(data, model, row.machineId, cursor);
    if (block && block.kind !== 'unavailable') break;
    if (!block) additions.push(cursor);
    cursor = formatDateAsIsoString(addDays(parseIsoDateString(cursor), direction));
  }
  return [...row.dates, ...additions].sort();
}

export function bookingEditConflicts(
  data: BookingData,
  model: BookingEditModel,
  rows: readonly BookingEditRow[],
): Conflict[] {
  return rows.flatMap((row) =>
    row.dates.flatMap((date) => {
      const block = bookingEditBlock(data, model, row.machineId, date);
      return block ? [{ machineId: row.machineId, date, by: block.label }] : [];
    }),
  );
}

export function bookingEditChanged(
  initialRows: readonly BookingEditRow[],
  rows: readonly BookingEditRow[],
): boolean {
  const keys = (items: readonly BookingEditRow[]) =>
    items.flatMap((row) => row.dates.map((date) => keyOf(row.machineId, date))).sort();
  return keys(initialRows).join('|') !== keys(rows).join('|');
}

export function bookingEditChanges(
  data: BookingData,
  initialRows: readonly BookingEditRow[],
  rows: readonly BookingEditRow[],
): string[] {
  const machineName = (id: string) =>
    data.machines.find((machine) => machine.id === id)?.name || `⟨${id}⟩`;
  const initial = new Map(initialRows.map((row) => [row.machineId, row]));
  const current = new Map(rows.map((row) => [row.machineId, row]));
  const changes: string[] = [];
  for (const row of initialRows) {
    const next = current.get(row.machineId);
    if (!next) changes.push(`${machineName(row.machineId)} entfernt`);
    else if (row.dates.join('|') !== next.dates.join('|'))
      changes.push(`${machineName(row.machineId)}: Zeitraum geändert`);
  }
  for (const row of rows) {
    if (!initial.has(row.machineId)) changes.push(`${machineName(row.machineId)} hinzugefügt`);
  }
  return changes;
}

function bookingEquals(left: Booking | undefined, right: Booking): boolean {
  return (
    !!left &&
    left.name === right.name &&
    left.gid === right.gid &&
    left.gtitle === right.gtitle &&
    left.note === right.note &&
    left.ts === right.ts
  );
}

function desiredCellKeys(rows: readonly BookingEditRow[]): Set<string> | null {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const date of row.dates) {
      keys.add(keyOf(row.machineId, date));
      if (keys.size > 1000) return null;
    }
  }
  return keys;
}

function validateBookingEdit(
  data: BookingData,
  model: BookingEditModel,
  rows: readonly BookingEditRow[],
  user: string,
): BookingEditApplyResult | null {
  if (normalized(user) !== normalized(model.campaign.owner))
    return { abort: true, error: 'Nur der Eigentümer darf diese Buchung bearbeiten.' };
  if (!rows.length || rows.some((row) => !row.dates.length))
    return { abort: true, error: 'Mindestens ein Gerät mit einem Buchungstag ist erforderlich.' };
  if (new Set(rows.map((row) => row.machineId)).size !== rows.length)
    return { abort: true, error: 'Ein Gerät darf nur einmal in der Buchungsgruppe vorkommen.' };
  for (const [key, original] of model.initialBookings) {
    const [machineId, date] = key.split('\u0000');
    if (!bookingEquals(data.bookings[machineId!]?.[date!], original))
      return {
        abort: true,
        error: 'Die Buchung wurde zwischenzeitlich geändert. Bitte neu öffnen.',
      };
  }
  const conflicts = bookingEditConflicts(data, model, rows).filter(
    (conflict) => !model.initialBookings.has(keyOf(conflict.machineId, conflict.date)),
  );
  return conflicts.length ? { abort: true, conflicts } : null;
}

function removeOldCells(
  data: BookingData,
  model: BookingEditModel,
  desiredKeys: ReadonlySet<string>,
  undo: CellUndo[],
): number {
  let count = 0;
  for (const [key, original] of model.initialBookings) {
    if (desiredKeys.has(key)) continue;
    const [machineId, date] = key.split('\u0000');
    undo.push({ machineId: machineId!, date: date!, prev: { ...original } });
    delete data.bookings[machineId!]![date!];
    count++;
  }
  return count;
}

function addNewCells(
  data: BookingData,
  model: BookingEditModel,
  rows: readonly BookingEditRow[],
  source: Booking,
  undo: CellUndo[],
): number {
  let count = 0;
  for (const row of rows) {
    const machineBookings = (data.bookings[row.machineId] ||= {});
    for (const date of row.dates) {
      if (model.initialBookings.has(keyOf(row.machineId, date))) continue;
      undo.push({ machineId: row.machineId, date, prev: null });
      machineBookings[date] = { ...source };
      count++;
    }
  }
  return count;
}

/** Applies a validated edit locally; `/api/mutate` persists its undo journal atomically. */
export function applyBookingEdit(
  data: BookingData,
  model: BookingEditModel,
  rows: readonly BookingEditRow[],
  user: string,
): BookingEditApplyResult {
  const invalid = validateBookingEdit(data, model, rows, user);
  if (invalid) return invalid;
  const desiredKeys = desiredCellKeys(rows);
  if (!desiredKeys) return { abort: true, error: 'Zu viele Änderungen.' };
  const deletionCount = [...model.initialBookings.keys()].filter(
    (key) => !desiredKeys.has(key),
  ).length;
  const additionCount = [...desiredKeys].filter((key) => !model.initialBookings.has(key)).length;
  if (deletionCount + additionCount > 1000) return { abort: true, error: 'Zu viele Änderungen.' };
  const source = model.initialBookings.values().next().value as Booking | undefined;
  if (!source) return { abort: true, error: 'Die Buchung ist nicht mehr vorhanden.' };
  const undo: CellUndo[] = [];
  const deletedCount = removeOldCells(data, model, desiredKeys, undo);
  const count = addNewCells(data, model, rows, source, undo);
  for (const machineId of new Set(undo.map((entry) => entry.machineId))) {
    undo.push(...sweepWeekends(data, machineId));
  }
  return { count, deletedCount, undo };
}
