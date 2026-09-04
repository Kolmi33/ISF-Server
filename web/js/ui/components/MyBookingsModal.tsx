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

import { useState } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { todayAsIsoDateString } from '../../../../shared/dates.ts';
import { groupsByCategory } from '../../core/machines.ts';
import { deleteOwnCells } from '../../core/bookings.ts';
import { orderedMachines } from '../grid.ts';
import { getBooking } from '../../core/bookings.ts';
import {
  computeMyRuns,
  filterMyRuns,
  type BookingRun,
  type MyBookingsFilter,
} from '../views/my-bookings.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { offerUndo } from '../toast.ts';
import { Icon } from './Icon.tsx';
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
      <p className="hint">
        {hasAnyRuns
          ? 'Keine Buchungen für diese Filter gefunden.'
          : 'Keine zukünftigen Buchungen unter deinem Namen gefunden.'}
      </p>
    );
  }
  return (
    <div className="resultlist" style={{ maxHeight: 440 }}>
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

export function MyBookingsModal() {
  const [frozenRuns] = useState<readonly BookingRun[]>(() =>
    computeMyRuns(
      orderedMachines(store.get('data')!.machines, store.get('favs')),
      store.get('data')!.bookings,
      store.get('user'),
      todayAsIsoDateString(),
    ),
  );
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());
  const [, forceRerender] = useState(0);
  const liveRuns = liveRunsFrom(frozenRuns);
  const { filter, updateFilter, myMachineIds, groupOptions, runs } = useMyBookingsFilter(liveRuns);

  function toggleExpanded(key: string): void {
    const next = new Set(expandedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedKeys(next);
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

  // Wrapped in its own `.mybookings` class so the CSS below (shaded filter card, sentence-case
  // labels, standardized icon buttons, …) can scope its overrides to this modal specifically —
  // `.abfilters`/`.mybk` are shared base classes AllBookingsModal also uses, and that modal's
  // own look isn't part of this request.
  return (
    <div className="mybookings">
      <h2>
        <Icon name="clip" /> Meine Buchungen (ab heute)
      </h2>
      <MyBookingsFilters filter={filter} groupOptions={groupOptions} onChange={updateFilter} />
      <MachineFilterButton machineIds={myMachineIds} />
      <RunList
        runs={runs}
        hasAnyRuns={liveRuns.length > 0}
        expandedKeys={expandedKeys}
        onToggleExpand={toggleExpanded}
        onDeleteDates={(machine, dates) => void deleteDates(machine, dates)}
      />
      <div className="modal-actions">
        <button className="btn" onClick={closeReactModal}>
          Schließen
        </button>
      </div>
    </div>
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
