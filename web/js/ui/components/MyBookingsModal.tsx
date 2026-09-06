// =======================================================================================
// MY BOOKINGS MODAL COMPONENT (web/js/ui/components/MyBookingsModal.tsx)
// =======================================================================================
//
// The "My bookings" modal: every future run booked under the current user's name, with a
// per-run/per-day delete and a "show only my machines" filter shortcut.
//
// Key Principles:
// - STRUCTURE FROZEN, DAYS LIVE: the run STRUCTURE is frozen at open (`computeMyRuns` runs
//   once via `useState`'s lazy initializer), but each run's *live* days are re-filtered
//   against the current bookings on every render — so a delete just makes a day disappear
//   from its run, without recomputing the grouping from scratch.
//
// =======================================================================================

import { useId, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { Machine } from '../../../../shared/types.ts';
import { todayAsIsoDateString } from '../../../../shared/dates.ts';
import { groupsByCategory } from '../../core/machines.ts';
import { deleteOwnCells } from '../../core/bookings.ts';
import { orderedMachines } from '../grid.ts';
import { getBooking } from '../../core/bookings.ts';
import {
  computeMyRuns,
  filterMyRuns,
  computeMyBookingsSummary,
  type BookingRun,
  type MyBookingsFilter,
  type MyBookingsSummary,
} from '../views/my-bookings.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { offerUndo } from '../toast.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { EmptyState } from './app/EmptyState.tsx';
import { StatTile } from './app/StatTile.tsx';
import { MyBookingsFilters, MachineFilterButton } from './MyBookingsFilters.tsx';
import {
  RunHead,
  DayList,
  GroupCard,
  groupRunsForDisplay,
  runKey,
  type LiveRun,
} from './MyBookingsRun.tsx';
import { askUserName } from './AskUserNameModal.tsx';
import { store } from '../../store-instance.ts';

function liveRunsFrom(frozenRuns: readonly BookingRun[]): LiveRun[] {
  const lowercaseUser = store.get('user').toLowerCase();
  const bookings = store.get('data')!.bookings;
  return frozenRuns
    .map((run) => ({
      machine: run.machine,
      allDates: run.dates,
      liveDates: run.dates.filter(
        (date) => getBooking(bookings, run.machine.id, date)?.name.toLowerCase() === lowercaseUser,
      ),
      ts: run.ts,
      groupId: run.groupId,
      groupTitle: run.groupTitle,
    }))
    .filter((run) => run.liveDates.length > 0);
}

/** "in N Tagen" → "Heute"/"Morgen" for the two near cases, matching how a person would
 *  actually say it rather than the technically-correct-but-stilted "in 0/1 Tagen". */
function nextInDaysText(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'Heute';
  if (days === 1) return 'Morgen';
  return `in ${days} Tagen`;
}

/** The dashboard-style KPI summary strip at the top of "My Bookings" (user request: "eine
 *  management summary auf der neuen Card -> z.B. Anzahl gebuchter Maschinen, Anzahl
 *  Buchungsgruppen, nächste Buchung in X Tagen") — always reflects every one of the user's
 *  bookings, not the filter row's currently-narrowed view (same "shortcut to the full set"
 *  reasoning as `myMachineIds` below). Hidden entirely with no bookings at all: an empty
 *  dashboard of zeroes would just be noise above the "no bookings" placeholder.
 */
function MyBookingsSummaryBar({ summary }: { summary: MyBookingsSummary }) {
  if (!summary.machineCount) return null;
  return (
    <div className="mybk-summary flex shrink-0 flex-wrap gap-3">
      <StatTile
        value={summary.machineCount}
        label={`Maschine${summary.machineCount === 1 ? '' : 'n'}`}
      />
      <StatTile
        value={summary.groupCount}
        label={`Buchungsgruppe${summary.groupCount === 1 ? '' : 'n'}`}
      />
      <StatTile value={summary.totalDays} label="Gebuchte Tage" />
      <StatTile value={nextInDaysText(summary.nextInDays)} label="Nächster Termin" />
    </div>
  );
}

interface RunListProps {
  runs: readonly LiveRun[];
  /** Whether any run exists at all before the filter row narrows the list — picks which of
   *  the two empty-state messages applies (no bookings at all vs. filtered down to nothing). */
  hasAnyRuns: boolean;
  expandedKeys: ReadonlySet<string>;
  onToggleExpand: (key: string) => void;
  onDeleteDates: (machine: Machine, dates: readonly string[]) => void;
}

function RunList({ runs, hasAnyRuns, expandedKeys, onToggleExpand, onDeleteDates }: RunListProps) {
  if (!runs.length) {
    return (
      <EmptyState>
        {hasAnyRuns
          ? 'Keine Buchungen für diese Filter gefunden.'
          : 'Keine zukünftigen Buchungen unter deinem Namen gefunden.'}
      </EmptyState>
    );
  }
  return (
    <ScrollArea className="resultlist -mr-3 min-h-0 flex-1 pr-3">
      <div className="flex flex-col gap-2">
        {groupRunsForDisplay(runs).map((item) => {
          if (item.kind === 'group') {
            return (
              <GroupCard
                key={item.groupId}
                groupId={item.groupId}
                groupTitle={item.groupTitle}
                runs={item.runs}
                expandedKeys={expandedKeys}
                onToggleExpand={onToggleExpand}
                onDeleteDates={onDeleteDates}
              />
            );
          }
          const { run } = item;
          const key = runKey(run);
          const isExpanded = expandedKeys.has(key);
          return (
            <div key={key}>
              <RunHead
                run={run}
                isExpanded={isExpanded}
                onToggleExpand={() => onToggleExpand(key)}
                onDeleteDates={(dates) => onDeleteDates(run.machine, dates)}
              />
              {run.liveDates.length > 1 && isExpanded && (
                <DayList run={run} onDeleteOneDay={(date) => onDeleteDates(run.machine, [date])} />
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

/** The filter row's state, its persisted sort key, and the fully-derived data it produces from
 *  the live runs (the filtered/sorted list, the "only my machines" shortcut's full unfiltered
 *  id set, and the Bereich select's group options) — split out of `MyBookingsModal` purely to
 *  stay under the function-length budget. */
function useMyBookingsFilter(liveRuns: readonly LiveRun[]) {
  const [filter, setFilter] = useState<MyBookingsFilter>(() => ({
    mach: '',
    group: '',
    from: '',
    to: '',
    sort: localStorage.getItem('mb_mysort') || 'termin',
  }));

  function updateFilter(patch: Partial<MyBookingsFilter>): void {
    if (patch.sort) localStorage.setItem('mb_mysort', patch.sort);
    setFilter((prev) => ({ ...prev, ...patch }));
  }

  return {
    filter,
    updateFilter,
    // The "only my machines" shortcut always reflects every one of the user's own machines,
    // regardless of the filter row above — it's a shortcut to the full set, not the filtered view.
    myMachineIds: [...new Set(liveRuns.map((run) => run.machine.id))],
    groupOptions: groupsByCategory(store.get('data')!.machines),
    runs: filterMyRuns(
      liveRuns.map((run) => ({ ...run, dates: run.liveDates })),
      filter,
    ),
  };
}

/** The two things the run list can do to a run — expand it, and delete some of its days.
 *  Split out of `MyBookingsModal` purely to stay under the function-length budget. */
function useMyBookingsRunActions() {
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());
  const [, forceRerender] = useState(0);

  function toggleExpanded(key: string): void {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function deleteDates(machine: Machine, dates: readonly string[]): Promise<void> {
    const user = store.get('user');
    const result = await window.mutate(
      (fresh) => deleteOwnCells(fresh, machine.id, user, dates),
      `Gelöscht: ${user} auf ${machine.name}, ${dates.length} Tag(e)`,
    );
    if (result && !result.abort) {
      forceRerender((tick) => tick + 1); // re-filter the live dates against the now-changed data
      offerUndo(`${result.deletedCount} Buchung(en) gelöscht.`, result.undo, 'Löschen');
    }
  }

  return {
    expandedKeys,
    toggleExpanded,
    onDeleteDates: (machine: Machine, dates: readonly string[]) => void deleteDates(machine, dates),
  };
}

export function MyBookingsModal() {
  const [frozenRuns] = useState<readonly BookingRun[]>(() =>
    computeMyRuns(
      orderedMachines(store.get('data')!.machines, store.get('favs')),
      store.get('data')!.bookings,
      store.get('user'),
      todayAsIsoDateString(),
    ),
  );
  const { expandedKeys, toggleExpanded, onDeleteDates } = useMyBookingsRunActions();
  const liveRuns = liveRunsFrom(frozenRuns);
  const { filter, updateFilter, myMachineIds, groupOptions, runs } = useMyBookingsFilter(liveRuns);
  const titleId = useId();

  return (
    <AppDialog size="lg" labelledBy={titleId} className="mybookings">
      <AppDialogHeader
        icon={<ClipboardList className="size-6" />}
        title="Meine Buchungen"
        titleId={titleId}
        subtitle="Alle Reservierungen unter deinem Namen ab heute"
      />
      <AppDialogBody className="max-h-[72vh]">
        <MyBookingsSummaryBar
          summary={computeMyBookingsSummary(
            liveRuns,
            store.get('data')!.bookings,
            todayAsIsoDateString(),
          )}
        />
        <MyBookingsFilters filter={filter} groupOptions={groupOptions} onChange={updateFilter} />
        <MachineFilterButton machineIds={myMachineIds} />
        <RunList
          runs={runs}
          hasAnyRuns={liveRuns.length > 0}
          expandedKeys={expandedKeys}
          onToggleExpand={toggleExpanded}
          onDeleteDates={onDeleteDates}
        />
      </AppDialogBody>
      <AppDialogFooter>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {runs.length} Eintr{runs.length === 1 ? 'ag' : 'äge'}
        </span>
        <Button size="lg" className="ml-auto" onClick={closeReactModal}>
          Schließen
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}

/** Opens "My bookings" — prompts for a name first if none is set yet (a user with no name
 *  browsing straight to this would otherwise see an empty list that isn't really "theirs"). */
export function openMyBookings(): void {
  if (!store.get('user')) {
    askUserName(false);
    return;
  }
  openReactModal(<MyBookingsModal />);
}
