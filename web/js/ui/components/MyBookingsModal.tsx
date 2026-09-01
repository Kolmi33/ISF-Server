// The "My bookings" modal (Phase 7 slice B5). Faithful port of legacy `openMyBookings`/
// `renderMyBookings`. The run STRUCTURE is frozen at open (`computeMyRuns` runs once, matching
// legacy's own comment "Struktur einfrieren") but each run's *live* days are re-filtered
// against the current `window.S.data.bookings` on every render, so a delete just makes a day
// disappear from its run without recomputing the grouping — exactly legacy's behavior.

import { useState } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import {
  formatDateLong,
  mondayOfDate,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../core/dates.ts';
import { categoryOf } from '../../core/machines.ts';
import { deleteOwnCells } from '../../core/booking.ts';
import { orderedMachines, FAVORITES_GROUP_LABEL } from '../grid.ts';
import { getBooking } from '../../core/booking-queries.ts';
import { computeMyRuns, type BookingRun } from '../views/my-bookings.ts';
import { gotoDate, prependWeek, resetView } from '../grid-scroll.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { toast, offerUndo } from '../toast.ts';
import { Icon } from './Icon.tsx';
import { askUserName } from './AskUserNameModal.tsx';

/** One run's live state: its frozen machine + full date list, and which of those dates are
 *  still actually booked under the current user's name right now. */
interface LiveRun {
  machine: Machine;
  allDates: readonly string[];
  liveDates: string[];
}

function liveRunsFrom(frozenRuns: readonly BookingRun[]): LiveRun[] {
  const lowercaseUser = window.S.user.toLowerCase();
  return frozenRuns
    .map((run) => ({
      machine: run.m,
      allDates: run.dates,
      liveDates: run.dates.filter(
        (date) =>
          getBooking(window.S.data!.bookings, run.m.id, date)?.name.toLowerCase() === lowercaseUser,
      ),
    }))
    .filter((run) => run.liveDates.length > 0);
}

function runKey(run: LiveRun): string {
  return run.machine.id + '|' + run.allDates[0];
}

/** A day's optional note, as the small trailing hint legacy shows next to its date. */
function DayNote({ machine, date }: { machine: Machine; date: string }) {
  const note = getBooking(window.S.data!.bookings, machine.id, date)?.note;
  return note ? (
    <span className="hint" style={{ margin: 0 }}>
      {' '}
      ({note})
    </span>
  ) : null;
}

/** Jump to a run's first live day in the grid: expand its category/group first (a filtered-out
 *  target wouldn't be visible otherwise), then scroll there. Faithful port of legacy's
 *  `[data-goto]` handler. */
function gotoRun(run: LiveRun): void {
  const targetDate = run.liveDates[0]!;
  closeReactModal();
  window.S.cats.add(categoryOf(run.machine));
  localStorage.setItem('mb_cats', JSON.stringify([...window.S.cats]));
  window.S.collapsed.delete(run.machine.group);
  if (window.S.favs.has(run.machine.id)) window.S.collapsed.delete(FAVORITES_GROUP_LABEL);
  localStorage.setItem('mb_collapsed', JSON.stringify([...window.S.collapsed]));
  window.S.startMonday = mondayOfDate(parseIsoDateString(targetDate));
  resetView();
  window.notify();
  prependWeek();
  gotoDate(targetDate);
}

interface RunRowProps {
  run: LiveRun;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDeleteDates: (dates: readonly string[]) => void;
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

  return (
    <div className="mybk">
      <div>
        {isSeries && (
          <span
            className="chip"
            title={`Tage ${isExpanded ? 'einklappen' : 'ausklappen'}`}
            onClick={onToggleExpand}
          >
            {isExpanded ? '▾' : '▸'}
          </span>
        )}{' '}
        {isSeries ? (
          <>
            {formatDateLong(run.liveDates[0]!)} –{' '}
            {formatDateLong(run.liveDates[run.liveDates.length - 1]!)}{' '}
            <span className="tag">{run.liveDates.length} Tage</span>
          </>
        ) : (
          formatDateLong(run.liveDates[0]!)
        )}
        {' — '}
        <b>{run.machine.name}</b>
        {!isSeries && <DayNote machine={run.machine} date={run.liveDates[0]!} />}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="btn small"
          title="Im Plan anzeigen (dorthin springen)"
          aria-label="Im Plan anzeigen"
          onClick={() => gotoRun(run)}
        >
          <Icon name="pin" />
        </button>
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
          <div>
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

function MachineFilterButton({ machineIds }: { machineIds: readonly string[] }) {
  if (!machineIds.length) return null;
  function apply(): void {
    window.S.machSel = new Set(machineIds);
    window.saveFilters();
    window.updateMachBtn();
    window.notify();
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
  expandedKeys: ReadonlySet<string>;
  onToggleExpand: (key: string) => void;
  onDeleteDates: (machine: Machine, dates: readonly string[]) => void;
}

function RunList({ runs, expandedKeys, onToggleExpand, onDeleteDates }: RunListProps) {
  if (!runs.length) {
    return <p className="hint">Keine zukünftigen Buchungen unter deinem Namen gefunden.</p>;
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

export function MyBookingsModal() {
  const [frozenRuns] = useState<readonly BookingRun[]>(() =>
    computeMyRuns(
      orderedMachines(window.S.data!.machines, window.S.favs),
      window.S.data!.bookings,
      window.S.user,
      todayAsIsoDateString(),
    ),
  );
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());
  const [, forceRerender] = useState(0);

  const runs = liveRunsFrom(frozenRuns);
  const myMachineIds = [...new Set(runs.map((run) => run.machine.id))];

  function toggleExpanded(key: string): void {
    const next = new Set(expandedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedKeys(next);
  }

  async function deleteDates(machine: Machine, dates: readonly string[]): Promise<void> {
    const result = await window.mutate(
      (fresh) => deleteOwnCells(fresh, machine.id, window.S.user, dates),
      `Gelöscht: ${window.S.user} auf ${machine.name}, ${dates.length} Tag(e)`,
    );
    if (result && !result.abort) {
      forceRerender((tick) => tick + 1); // re-filter the live dates against the now-changed data
      offerUndo(`${result.n} Buchung(en) gelöscht.`, result.undo, 'Löschen');
    }
  }

  return (
    <>
      <h2>
        <Icon name="clip" /> Meine Buchungen (ab heute)
      </h2>
      <MachineFilterButton machineIds={myMachineIds} />
      <RunList
        runs={runs}
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

/** Open "My bookings". Faithful port of legacy `openMyBookings` — prompts for a name first if
 *  none is set yet (a read-only user with no name browsing straight to this would otherwise see
 *  an empty list that isn't really "theirs"). */
export function openMyBookings(): void {
  if (!window.S.user) {
    askUserName(false);
    return;
  }
  openReactModal(<MyBookingsModal />);
}
