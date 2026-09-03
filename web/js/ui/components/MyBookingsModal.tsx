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
import type { ChangeEvent } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import {
  formatDateLong,
  mondayOfDate,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../../shared/dates.ts';
import {
  CATEGORIES,
  CATEGORY_FILTER_PREFIX,
  getMachineCategory,
  groupsByCategory,
  type CategoryGroups,
} from '../../core/machines.ts';
import { deleteOwnCells, findBookingGroup } from '../../core/bookings.ts';
import { orderedMachines, FAVORITES_GROUP_LABEL } from '../grid.ts';
import { getBooking } from '../../core/bookings.ts';
import {
  computeMyRuns,
  filterMyRuns,
  type BookingRun,
  type MyBookingsFilter,
} from '../views/my-bookings.ts';
import { gotoDate, prependWeek, resetView } from '../grid-scroll.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { toast, offerUndo } from '../toast.ts';
import { Icon } from './Icon.tsx';
import { GroupOptions } from './GroupOptions.tsx';
import { askUserName } from './AskUserNameModal.tsx';
import { store } from '../../store-instance.ts';
import { saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';

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

/** Shows "Teil einer Buchungsgruppe" when this run's first day belongs to a booking group
 *  spanning more than just this one machine — looked up live (current bookings, not the
 *  frozen run), same as `BookingDetailModal.tsx`'s own `SeriesOrGroupHint` this mirrors. A
 *  group of exactly one machine (a titled single-machine booking) isn't called out here — it's
 *  visually indistinguishable from a plain run anyway, so the hint would say nothing useful. */
function GroupHint({ run }: { run: LiveRun }) {
  if (!run.groupId) return null;
  const group = findBookingGroup(store.get('data')!.bookings, run.groupId);
  if (group.machineIds.size <= 1) return null;
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
 *  single-day run instead. The expand chip lives in `RunHead`'s own button column now, not
 *  here — see that component's comment for why. */
function RunCardBody({ run, isSeries }: { run: LiveRun; isSeries: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="abmach">
        <b>{run.machine.name}</b>{' '}
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

  // The expand chip sits under the pin ("Im Plan anzeigen") button, on the right — user
  // request — instead of the date line's own left edge it used to occupy.
  return (
    <div className="mybk">
      <RunCardBody run={run} isSeries={isSeries} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <button
            className="btn small"
            title="Im Plan anzeigen (dorthin springen)"
            aria-label="Im Plan anzeigen"
            onClick={() => gotoRun(run)}
          >
            <Icon name="pin" />
          </button>
          {isSeries && (
            <span
              className="chip"
              title={`Tage ${isExpanded ? 'einklappen' : 'ausklappen'}`}
              onClick={onToggleExpand}
            >
              {isExpanded ? '▾' : '▸'}
            </span>
          )}
        </div>
        <button className="btn small danger" onClick={() => void handleDeleteClick()}>
          {isSeries ? 'Serie löschen' : 'Löschen'}
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

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'termin', label: 'Termin der Buchung' },
  { value: 'erstellt', label: 'Zuletzt gebucht' },
  { value: 'bereich', label: 'Bereich' },
  { value: 'maschine', label: 'Maschine' },
];

interface MyBookingsFiltersProps {
  filter: MyBookingsFilter;
  groupOptions: readonly CategoryGroups[];
  onChange: (patch: Partial<MyBookingsFilter>) => void;
}

/** The filter row: the same shape as `AllBookingsModal.tsx`'s own `AllBookingsFilters` — a
 *  Maschine text filter, a Bereich select (grouped by category, plus whole-category options),
 *  a sort key, and a date-overlap window — minus the Person field that one also has, since
 *  every run here is already known to be the current user's own (user request). */
function MyBookingsFilters({ filter, groupOptions, onChange }: MyBookingsFiltersProps) {
  const onInput =
    (key: keyof MyBookingsFilter) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ [key]: event.target.value });
  return (
    <div className="abfilters">
      <div className="fld">
        <label>Maschine</label>
        <input type="text" placeholder="Berger" value={filter.mach} onChange={onInput('mach')} />
      </div>
      <div className="fld">
        <label>Bereich</label>
        <select value={filter.group} onChange={onInput('group')}>
          <option value="">Alle</option>
          {groupOptions.map(({ category }) => (
            <option key={`cat:${category}`} value={`${CATEGORY_FILTER_PREFIX}${category}`}>
              {CATEGORIES.find((c) => c.id === category)?.label ?? category} (alle Bereiche)
            </option>
          ))}
          <GroupOptions groupOptions={groupOptions} />
        </select>
      </div>
      <div className="fld">
        <label>Sortieren</label>
        <select value={filter.sort} onChange={onInput('sort')}>
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="fld">
        <label>Von</label>
        <input type="date" value={filter.from} onChange={onInput('from')} />
      </div>
      <div className="fld">
        <label>Bis</label>
        <input type="date" value={filter.to} onChange={onInput('to')} />
      </div>
    </div>
  );
}

function MachineFilterButton({ machineIds }: { machineIds: readonly string[] }) {
  if (!machineIds.length) return null;
  function apply(): void {
    // Silent — saveFilters()/updateMachBtn() run before the one notify, matching the
    // original's single window.notify() after this write and both those calls.
    store.state.machSel = new Set(machineIds);
    saveFilters();
    updateMachBtn();
    store.notify();
    closeReactModal();
    toast(
      `Plan gefiltert: nur deine ${machineIds.length} Maschine${machineIds.length === 1 ? '' : 'n'}. Aufheben über „Filtern → Filter löschen".`,
      undefined,
      6000,
    );
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <button className="btn small" onClick={apply}>
        <Icon name="search" /> Nur meine Maschinen im Plan zeigen ({machineIds.length})
      </button>
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

  return (
    <>
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
    </>
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
