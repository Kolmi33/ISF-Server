// =======================================================================================
// MY BOOKINGS VIEW MODEL MODULE (web/js/ui/views/my-bookings.ts)
// =======================================================================================
//
// The "My bookings" view model's pure kernels: turning the raw state into the list the modal
// draws — the current user's future bookings, grouped into consecutive-workday runs
// (`computeMyRuns`) — and the filter/sort the list controls drive (`filterMyRuns`).
//
// =======================================================================================

import type { Booking, Machine, Bookings, MaintSlot } from '../../../../shared/types.ts';
import { parseIsoDateString, isWeekend, nextWeekday } from '../../../../shared/dates.ts';
import { matchesGroupFilter } from '../../core/machines.ts';

/** A run of consecutive workdays the user has booked on one machine (a bookable "series"). */
export interface BookingRun {
  machine: Machine;
  dates: string[];
  /** The earliest creation timestamp among the run's days (empty string if none have one). */
  ts: string;
  /** The booking-group id/title this run's first day carries, if it's part of one (a single
   *  action that booked several machines together) — undefined for a plain, ungrouped
   *  booking. Only the first day is checked: a run that happens to splice a grouped day onto
   *  an otherwise-unrelated adjacent one (a rare edge case) still reads as "grouped" by its
   *  leading day, which is the day `gotoRun`/most user attention actually lands on anyway. */
  groupId?: string;
  groupTitle?: string;
}

/**
 * Groups the user's future bookings into consecutive-workday runs.
 *
 * How it works: for each machine (in the given display order), takes that user's bookings
 * from `today` onward, drops weekends, and splits the sorted days into runs where each day
 * is the next workday after the previous one (so Fri→Mon is one continuous run, not two).
 * Runs are returned sorted by their first date.
 */
export function computeMyRuns(
  machines: readonly Machine[],
  bookings: Bookings,
  user: string,
  today: string,
): BookingRun[] {
  const lowercaseUser = user.toLowerCase();
  const runs: BookingRun[] = [];
  for (const machine of machines) {
    const machineBookings = bookings[machine.id] || {};
    const myBookedWorkdays = Object.keys(machineBookings)
      .filter(
        (date) =>
          date >= today &&
          !isWeekend(parseIsoDateString(date)) &&
          machineBookings[date]!.name.toLowerCase() === lowercaseUser,
      )
      .sort();
    // The earliest creation timestamp among a run's days (empty string if none have one).
    const earliestTimestamp = (runDates: string[]): string => {
      let earliest = '';
      for (const date of runDates) {
        const timestamp = machineBookings[date]!.ts || '';
        if (timestamp && (!earliest || timestamp < earliest)) earliest = timestamp;
      }
      return earliest;
    };
    const pushRun = (runDates: string[]): void => {
      if (!runDates.length) return;
      const firstBooking = machineBookings[runDates[0]!]!;
      runs.push({
        machine,
        dates: runDates,
        ts: earliestTimestamp(runDates),
        groupId: firstBooking.gid,
        groupTitle: firstBooking.gtitle,
      });
    };
    let currentRunDates: string[] = [];
    for (const date of myBookedWorkdays) {
      const continuesCurrentRun =
        currentRunDates.length &&
        nextWeekday(currentRunDates[currentRunDates.length - 1]!) === date;
      if (continuesCurrentRun) {
        currentRunDates.push(date);
      } else {
        pushRun(currentRunDates);
        currentRunDates = [date];
      }
    }
    pushRun(currentRunDates);
  }
  runs.sort((runA, runB) => (runA.dates[0]! < runB.dates[0]! ? -1 : 1));
  return runs;
}

/** The list controls: free-text machine, a Bereich (group-or-category, see
 *  `core/machines.ts`'s `matchesGroupFilter`), a date window, and a sort key. Deliberately no
 *  "person" field, unlike `AllBookingsFilter` — every run here is already known to be the
 *  current user's own. */
export interface MyBookingsFilter {
  mach: string;
  group: string;
  from: string;
  to: string;
  sort: string;
}

/** A run shape generic enough to cover both the frozen `BookingRun` and the modal's own
 *  live-day-filtered variant — `filterMyRuns` only ever reads these three fields. */
export interface FilterableRun {
  machine: Machine;
  dates: readonly string[];
  ts: string;
}

/** The sort comparators, keyed by the modal's sort dropdown values — the same shape as
 *  `views/all-bookings.ts`'s own sorters, minus the 'person' key (meaningless here: every run
 *  is already the same one person) and minus 'maschine' (removed — user request: the machine
 *  name is already the row's own headline, so sorting by it added no real value). */
const sorters: Record<string, (runA: FilterableRun, runB: FilterableRun) => number> = {
  termin: (runA, runB) =>
    runA.dates[0]! < runB.dates[0]! ? -1 : runA.dates[0]! > runB.dates[0]! ? 1 : 0,
  erstellt: (runA, runB) => (runB.ts || '').localeCompare(runA.ts || ''),
  bereich: (runA, runB) =>
    (runA.machine.group || '').localeCompare(runB.machine.group || '', 'de') ||
    runA.machine.name.localeCompare(runB.machine.name, 'de') ||
    (runA.dates[0]! < runB.dates[0]! ? -1 : 1),
};

/**
 * Filters and sorts the runs for the list — a generic over any {@link FilterableRun}, so it
 * works equally on the frozen `BookingRun[]` and the modal's own live-day-filtered run shape.
 * Machine is a case-insensitive substring match; the date window keeps runs that overlap
 * `[from, to]`; an unknown sort key falls back to `termin`.
 */
export function filterMyRuns<T extends FilterableRun>(
  runs: readonly T[],
  filter: MyBookingsFilter,
): T[] {
  const lowercaseMachine = filter.mach.trim().toLowerCase();
  return runs
    .filter(
      (run) =>
        (!lowercaseMachine || run.machine.name.toLowerCase().includes(lowercaseMachine)) &&
        (!filter.group || matchesGroupFilter(run.machine, filter.group)) &&
        (!filter.from || run.dates[run.dates.length - 1]! >= filter.from) &&
        (!filter.to || run.dates[0]! <= filter.to),
    )
    .sort(sorters[filter.sort] || sorters.termin);
}

/** The minimal shape `computeMyBookingsSummary` needs from each run — matches `LiveRun`
 *  (`MyBookingsRun.tsx`) structurally, without importing it: that module already imports FROM
 *  this one, so importing its type back here would create a cycle. */
interface SummarizableRun {
  machine: Machine;
  liveDates: readonly string[];
  groupId?: string;
}

/** The dashboard-style KPI summary shown at the top of "My Bookings" (user request: "a
 *  management summary on top of the new card -> e.g number of machines booked, number of
 *  booking groups, next booking coming in up in X days"). */
export interface MyBookingsSummary {
  machineCount: number;
  /** Distinct REAL (multi-machine) booking groups only — a titled single-machine booking
   *  isn't a "group" worth counting here, same threshold `multiMachineGroup` uses elsewhere. */
  groupCount: number;
  totalDays: number;
  /** Days from `today` until the soonest upcoming booked day, or null with no bookings at all.
   *  0 means today, negative is impossible (runs are already filtered to `today` onward by
   *  `computeMyRuns`). */
  nextInDays: number | null;
}

/**
 * Computes the summary from the FULL, unfiltered run list — like the "only my machines"
 * shortcut, this describes the user's overall bookings, not whatever the filter row above
 * currently narrows the visible list to.
 */
export function computeMyBookingsSummary(
  runs: readonly SummarizableRun[],
  bookings: Bookings,
  today: string,
): MyBookingsSummary {
  const machineIds = new Set(runs.map((run) => run.machine.id));
  const relevantGroupIds = new Set(runs.flatMap((run) => (run.groupId ? [run.groupId] : [])));
  const machinesByGroup = new Map<string, Set<string>>();
  if (relevantGroupIds.size) {
    for (const [machineId, machineBookings] of Object.entries(bookings)) {
      for (const booking of Object.values(machineBookings)) {
        const groupId = booking.gid;
        if (!groupId || !relevantGroupIds.has(groupId)) continue;
        let groupMachines = machinesByGroup.get(groupId);
        if (!groupMachines) {
          groupMachines = new Set<string>();
          machinesByGroup.set(groupId, groupMachines);
        }
        groupMachines.add(machineId);
      }
    }
  }
  const groupCount = [...relevantGroupIds].filter(
    (groupId) => (machinesByGroup.get(groupId)?.size ?? 0) > 1,
  ).length;
  const allLiveDates = runs.flatMap((run) => run.liveDates);
  const soonest = allLiveDates.length ? allLiveDates.reduce((a, b) => (a < b ? a : b)) : null;
  const msPerDay = 24 * 60 * 60 * 1000;
  const nextInDays = soonest
    ? Math.round(
        (parseIsoDateString(soonest).getTime() - parseIsoDateString(today).getTime()) / msPerDay,
      )
    : null;
  return {
    machineCount: machineIds.size,
    groupCount,
    totalDays: allLiveDates.length,
    nextInDays,
  };
}

export type MyBookingStatus = 'aktiv' | 'geplant' | 'abgeschlossen';

export interface MyBookingCell {
  machineId: string;
  date: string;
}

/** A real booking group, or one consecutive ungrouped machine run, presented as a campaign. */
export interface MyBookingCampaign {
  id: string;
  title: string;
  status: MyBookingStatus;
  dates: string[];
  cells: MyBookingCell[];
  machines: Machine[];
  createdAt: string;
  note?: string;
  groupId?: string;
  /** Booking owner as stored by the backend. */
  owner: string;
  maintenance?: { machine: Machine; date: string; type: string };
}

interface CampaignSeed {
  id: string;
  title: string;
  cells: MyBookingCell[];
  machines: Machine[];
  bookings: Booking[];
  groupId?: string;
  owner: string;
}

function campaignStatus(dates: readonly string[], today: string): MyBookingStatus {
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  if (last < today) return 'abgeschlossen';
  if (first > today) return 'geplant';
  return 'aktiv';
}

function slotCovers(slot: MaintSlot, date: string): boolean {
  return (!slot.from || slot.from <= date) && (!slot.until || slot.until >= date);
}

function maintenanceConflict(seed: CampaignSeed) {
  for (const machine of seed.machines) {
    const machineDates = seed.cells
      .filter((cell) => cell.machineId === machine.id)
      .map((cell) => cell.date);
    for (const slot of machine.maint || []) {
      const date = machineDates.find((candidate) => slotCovers(slot, candidate));
      if (date) return { machine, date, type: slot.type || 'Wartung' };
    }
  }
  return undefined;
}

function finishCampaign(seed: CampaignSeed, today: string): MyBookingCampaign {
  const dates = [...new Set(seed.cells.map((cell) => cell.date))].sort();
  const timestamps = seed.bookings
    .map((booking) => booking.ts || '')
    .filter(Boolean)
    .sort();
  const notes = seed.bookings.map((booking) => booking.note?.trim()).filter(Boolean) as string[];
  const result: MyBookingCampaign = {
    id: seed.id,
    title: seed.title,
    status: campaignStatus(dates, today),
    dates,
    cells: seed.cells.sort((a, b) => a.date.localeCompare(b.date)),
    machines: seed.machines,
    createdAt: timestamps[0] || '',
    owner: seed.owner,
  };
  if (notes[0]) result.note = notes[0];
  if (seed.groupId) result.groupId = seed.groupId;
  const maintenance = maintenanceConflict(seed);
  if (maintenance) result.maintenance = maintenance;
  return result;
}

function splitUngroupedRuns(entries: { date: string; booking: Booking }[]) {
  const runs: { date: string; booking: Booking }[][] = [];
  for (const entry of entries) {
    const current = runs[runs.length - 1];
    if (current && nextWeekday(current[current.length - 1]!.date) === entry.date)
      current.push(entry);
    else runs.push([entry]);
  }
  return runs;
}

function ungroupedSeeds(machine: Machine, bookings: Bookings, user?: string): CampaignSeed[] {
  const entries = Object.entries(bookings[machine.id] || {})
    .filter(
      ([date, booking]) =>
        !booking.gid &&
        !isWeekend(parseIsoDateString(date)) &&
        (!user || booking.name.toLowerCase() === user),
    )
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, booking]) => ({ date, booking }));
  const byOwner = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = entry.booking.name.toLowerCase();
    byOwner.set(key, [...(byOwner.get(key) || []), entry]);
  }
  return [...byOwner.values()].flatMap((ownerEntries) =>
    splitUngroupedRuns(ownerEntries).map((run) => ({
      id: `${machine.id}:${run[0]!.date}:${run[0]!.booking.name.toLowerCase()}`,
      title: run[0]!.booking.note?.trim() || machine.name,
      owner: run[0]!.booking.name,
      cells: run.map(({ date }) => ({ machineId: machine.id, date })),
      machines: [machine],
      bookings: run.map(({ booking }) => booking),
    })),
  );
}

function groupedBooking(date: string, booking: Booking, user?: string): boolean {
  return (
    !!booking.gid &&
    !isWeekend(parseIsoDateString(date)) &&
    (!user || booking.name.toLowerCase() === user)
  );
}

function addGroupedBooking(
  seeds: Map<string, CampaignSeed>,
  machine: Machine,
  date: string,
  booking: Booking,
): void {
  const groupId = booking.gid!;
  const seedKey = `${groupId}\u0000${booking.name.toLowerCase()}`;
  let seed = seeds.get(seedKey);
  if (!seed) {
    seed = {
      id: groupId,
      groupId,
      title: booking.gtitle?.trim() || booking.note?.trim() || 'Buchungsgruppe',
      owner: booking.name,
      cells: [],
      machines: [],
      bookings: [],
    };
    seeds.set(seedKey, seed);
  }
  seed.cells.push({ machineId: machine.id, date });
  seed.bookings.push(booking);
  if (booking.gtitle?.trim()) seed.title = booking.gtitle.trim();
  if (!seed.machines.some((candidate) => candidate.id === machine.id)) seed.machines.push(machine);
}

function groupedSeeds(
  machines: readonly Machine[],
  bookings: Bookings,
  user?: string,
): CampaignSeed[] {
  const machineById = new Map(machines.map((machine) => [machine.id, machine]));
  const seeds = new Map<string, CampaignSeed>();
  for (const [machineId, machineBookings] of Object.entries(bookings)) {
    const machine = machineById.get(machineId);
    if (!machine) continue;
    for (const [date, booking] of Object.entries(machineBookings)) {
      if (groupedBooking(date, booking, user)) addGroupedBooking(seeds, machine, date, booking);
    }
  }
  return [...seeds.values()];
}

function compareCampaigns(a: MyBookingCampaign, b: MyBookingCampaign): number {
  const rank: Record<MyBookingStatus, number> = { aktiv: 0, geplant: 1, abgeschlossen: 2 };
  const statusDifference = rank[a.status] - rank[b.status];
  if (statusDifference) return statusDifference;
  return a.status === 'abgeschlossen'
    ? b.dates[b.dates.length - 1]!.localeCompare(a.dates[a.dates.length - 1]!)
    : a.dates[0]!.localeCompare(b.dates[0]!);
}

/** Derives the supplied campaign-style overview entirely from authoritative booking state. */
export function computeMyBookingCampaigns(
  machines: readonly Machine[],
  bookings: Bookings,
  user: string,
  today: string,
): MyBookingCampaign[] {
  const lowercaseUser = user.trim().toLowerCase();
  if (!lowercaseUser) return [];
  const seeds = [
    ...groupedSeeds(machines, bookings, lowercaseUser),
    ...machines.flatMap((machine) => ungroupedSeeds(machine, bookings, lowercaseUser)),
  ];
  return seeds.map((seed) => finishCampaign(seed, today)).sort(compareCampaigns);
}

/** Derives the same campaign cards for every owner. Groups remain the authoritative backend
 * booking groups; the ungrouped branch is only a compatibility fallback for legacy data. */
export function computeBookingCampaigns(
  machines: readonly Machine[],
  bookings: Bookings,
  today: string,
): MyBookingCampaign[] {
  const seeds = [
    ...groupedSeeds(machines, bookings),
    ...machines.flatMap((machine) => ungroupedSeeds(machine, bookings)),
  ];
  return seeds.map((seed) => finishCampaign(seed, today)).sort(compareCampaigns);
}

export function filterMyBookingCampaigns(
  campaigns: readonly MyBookingCampaign[],
  status: 'alle' | MyBookingStatus,
  query: string,
): MyBookingCampaign[] {
  const needle = query.trim().toLowerCase();
  return campaigns.filter((campaign) => {
    if (status !== 'alle' && campaign.status !== status) return false;
    if (!needle) return true;
    const haystack = [
      campaign.title,
      campaign.id,
      campaign.note || '',
      campaign.owner,
      ...campaign.machines.flatMap((machine) => [machine.name, machine.group, machine.id]),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}
