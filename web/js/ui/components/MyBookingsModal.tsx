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
import {
  formatDateLong,
  mondayOfDate,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../../shared/dates.ts';
import { getMachineCategory, groupsByCategory } from '../../core/machines.ts';
import { deleteOwnCells, findBookingGroup } from '../../core/bookings.ts';
import { orderedMachines, FAVORITES_GROUP_LABEL, nameColor } from '../grid.ts';
import { getBooking } from '../../core/bookings.ts';
import { isDarkTheme } from '../theme.ts';
import {
  computeMyRuns,
  filterMyRuns,
  type BookingRun,
  type MyBookingsFilter,
} from '../views/my-bookings.ts';
import { gotoDate, prependWeek, resetView } from '../grid-scroll.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { offerUndo } from '../toast.ts';
import { Icon } from './Icon.tsx';
import { MyBookingsFilters, MachineFilterButton } from './MyBookingsFilters.tsx';
import { askUserName } from './AskUserNameModal.tsx';
import { store } from '../../store-instance.ts';

/** One run's live state: its frozen machine + full date list, and which of those dates are
 *  still actually booked under the current user's name right now. `ts`/`groupId`/`groupTitle`
 *  pass straight through from the frozen `BookingRun` unchanged — a run's group membership and
 *  earliest-booked timestamp don't change as its individual days get deleted. */
interface LiveRun {
  machine: Machine;
  allDates: readonly string[];
  liveDates: string[];
  ts: string;
  groupId?: string;
  groupTitle?: string;
}

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

function runKey(run: LiveRun): string {
  return run.machine.id + '|' + run.allDates[0];
}

/** A day's optional note, as the small trailing hint legacy shows next to its date. */
function DayNote({ machine, date }: { machine: Machine; date: string }) {
  const note = getBooking(store.get('data')!.bookings, machine.id, date)?.note;
  return note ? (
    <span className="hint" style={{ margin: 0 }}>
      {' '}
      ({note})
    </span>
  ) : null;
}

/** Jumps to a run's first live day in the grid: expands its category/group first (a
 *  folded-away target wouldn't be visible otherwise), then scrolls there. */
function gotoRun(run: LiveRun): void {
  const targetDate = run.liveDates[0]!;
  closeReactModal();
  const cats = store.get('cats');
  cats.add(getMachineCategory(run.machine));
  localStorage.setItem('mb_cats', JSON.stringify([...cats]));
  const collapsed = store.get('collapsed');
  collapsed.delete(run.machine.group);
  if (store.get('favs').has(run.machine.id)) collapsed.delete(FAVORITES_GROUP_LABEL);
  localStorage.setItem('mb_collapsed', JSON.stringify([...collapsed]));
  // Silent, like resetView below — one notify covers this write plus resetView's own field
  // reset, matching the original's single window.notify() after both.
  store.state.startMonday = mondayOfDate(parseIsoDateString(targetDate));
  resetView();
  store.notify();
  prependWeek();
  gotoDate(targetDate);
}

interface RunRowProps {
  run: LiveRun;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDeleteDates: (dates: readonly string[]) => void;
}

/** This run's booking group, but only when it actually spans more than one machine — looked up
 *  live (current bookings, not the frozen run). A group of exactly one machine (a titled
 *  single-machine booking) isn't treated as a "real" group by either caller below: it's
 *  visually indistinguishable from a plain run anyway, so neither the badge nor the hint would
 *  say/show anything useful. Shared by `GroupBadge` and `GroupHint` so both agree on exactly
 *  which runs count as grouped. */
function multiMachineGroup(run: LiveRun): { machineIds: Set<string> } | undefined {
  if (!run.groupId) return undefined;
  const group = findBookingGroup(store.get('data')!.bookings, run.groupId);
  return group.machineIds.size > 1 ? group : undefined;
}

/** A color-coded pill badge marking runs that share the same multi-machine booking group,
 *  sitting right next to the machine name — replaces an earlier left-border accent that read
 *  as an unwanted "vertical line" (user request). Reuses `grid.ts`'s `nameColor` hash (the same
 *  mechanism the grid itself uses to color-code booker names) keyed on the group id, so every
 *  run in the same group always gets the same color; the group's own title stands in for a
 *  generic "Gruppe" label when one was given at booking time. */
function GroupBadge({ run }: { run: LiveRun }) {
  const group = multiMachineGroup(run);
  if (!group) return null;
  return (
    <span
      className="grouppill"
      style={{ background: nameColor(run.groupId!, isDarkTheme()) }}
      title={`Teil einer Buchungsgruppe — ${group.machineIds.size} Maschinen`}
    >
      {run.groupTitle || 'Gruppe'}
    </span>
  );
}

/** Shows "Teil einer Buchungsgruppe" when this run belongs to a real (multi-machine) booking
 *  group — same as `BookingDetailModal.tsx`'s own `SeriesOrGroupHint` this mirrors. */
function GroupHint({ run }: { run: LiveRun }) {
  const group = multiMachineGroup(run);
  if (!group) return null;
  return (
    <div className="hint" style={{ margin: '2px 0 0' }}>
      <Icon name="folder" /> Teil einer Buchungsgruppe
      {run.groupTitle ? (
        <>
          : <b>{run.groupTitle}</b>
        </>
      ) : null}{' '}
      — {group.machineIds.size} Maschinen
    </div>
  );
}

/** The `.abmach`/`.abdate` card body — copied from AllBookingsModal's `AllBookingsRow` layout
 *  for a consistent look between the two "list of runs" modals: bold machine name + group hint
 *  on top, the date range (with the day-count tag folded in) below, plus the group hint when
 *  this run is part of one. Split out of `RunHead` purely to stay under the function-length
 *  budget. The third `.abdate`-style "who booked it" line All Bookings has is skipped here —
 *  every run in this modal is already known to be the current user's own, so naming them again
 *  would be redundant; the day-level note (`DayNote`) takes that line's place for a
 *  single-day run instead. The expand chip lives in `RunHead`'s own horizontal actions row
 *  now, not here — see that component's comment for why. */
function RunCardBody({ run, isSeries }: { run: LiveRun; isSeries: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="abmach">
        <b>{run.machine.name}</b> <GroupBadge run={run} />{' '}
        <span className="hint" style={{ margin: 0 }}>
          · {run.machine.group}
        </span>
      </div>
      <div className="abdate">
        {isSeries ? (
          <>
            {formatDateLong(run.liveDates[0]!)} –{' '}
            {formatDateLong(run.liveDates[run.liveDates.length - 1]!)}{' '}
            <span className="tag">{run.liveDates.length} Tage</span>
          </>
        ) : (
          <>
            {formatDateLong(run.liveDates[0]!)}
            <DayNote machine={run.machine} date={run.liveDates[0]!} />
          </>
        )}
      </div>
      <GroupHint run={run} />
    </div>
  );
}

function RunHead({ run, isExpanded, onToggleExpand, onDeleteDates }: RunRowProps) {
  const isSeries = run.liveDates.length > 1;

  async function handleDeleteClick(): Promise<void> {
    if (isSeries) {
      const confirmed = await window.askConfirm({
        title: 'Ganze Serie löschen?',
        body: `Deine Serie auf <b>${run.machine.name}</b>:<br>${formatDateLong(run.liveDates[0]!)} – ${formatDateLong(run.liveDates[run.liveDates.length - 1]!)} (${run.liveDates.length} Tage)`,
        yes: `${run.liveDates.length} Tage löschen`,
      });
      if (!confirmed) return;
    }
    onDeleteDates(run.liveDates);
  }

  // The action icons sit in one horizontal row on the right (user request — they used to
  // stack vertically), all sharing one standardized circular icon-button shape/border. A run
  // that's part of a real (multi-machine) booking group is marked by `GroupBadge` (a
  // color-coded pill next to the machine name) rather than a border accent — an earlier
  // left-border version read as an unwanted stray line (user request).
  const deleteLabel = isSeries ? 'Serie löschen' : 'Löschen';
  return (
    <div className="mybk">
      <RunCardBody run={run} isSeries={isSeries} />
      <div className="mybk-actions">
        <button
          className="iconbtn"
          title="Im Plan anzeigen (dorthin springen)"
          aria-label="Im Plan anzeigen"
          onClick={() => gotoRun(run)}
        >
          <Icon name="pin" />
        </button>
        {isSeries && (
          <button
            className="iconbtn"
            title={`Tage ${isExpanded ? 'einklappen' : 'ausklappen'}`}
            aria-label={isExpanded ? 'Tage einklappen' : 'Tage ausklappen'}
            onClick={onToggleExpand}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        )}
        <button
          className="iconbtn danger"
          title={deleteLabel}
          aria-label={deleteLabel}
          onClick={() => void handleDeleteClick()}
        >
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}

function DayList({
  run,
  onDeleteOneDay,
}: {
  run: LiveRun;
  onDeleteOneDay: (date: string) => void;
}) {
  return (
    <div className="daylist">
      {run.liveDates.map((date) => (
        <div className="mybk" key={date}>
          <div className="abdate">
            {formatDateLong(date)}
            <DayNote machine={run.machine} date={date} />
          </div>
          <button className="btn small danger" onClick={() => onDeleteOneDay(date)}>
            Löschen
          </button>
        </div>
      ))}
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
      <p className="hint">
        {hasAnyRuns
          ? 'Keine Buchungen für diese Filter gefunden.'
          : 'Keine zukünftigen Buchungen unter deinem Namen gefunden.'}
      </p>
    );
  }
  return (
    <div className="resultlist" style={{ maxHeight: 440 }}>
      {runs.map((run) => {
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
