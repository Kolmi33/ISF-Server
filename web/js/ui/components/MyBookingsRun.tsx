// =======================================================================================
// MY BOOKINGS RUN + GROUP CARD (web/js/ui/components/MyBookingsRun.tsx)
// =======================================================================================
//
// One run's own card (`RunHead`/`RunCardBody`/`DayList`) and the "parent card" wrapping every
// run that shares the same real (multi-machine) booking group (`GroupCard`/
// `groupRunsForDisplay`) — split out of `MyBookingsModal.tsx` purely to stay under the
// file-length budget; conceptually still one modal.
//
// =======================================================================================

import type { CSSProperties } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { formatDateLong, mondayOfDate, parseIsoDateString } from '../../../../shared/dates.ts';
import { getMachineCategory } from '../../core/machines.ts';
import { getBooking, findBookingGroup } from '../../core/bookings.ts';
import { FAVORITES_GROUP_LABEL, nameColor } from '../grid.ts';
import { isDarkTheme } from '../theme.ts';
import { gotoDate, prependWeek, resetView } from '../grid-scroll.ts';
import { closeReactModal } from '../modal.tsx';
import { Icon } from './Icon.tsx';
import { store } from '../../store-instance.ts';

/** One run's live state: its frozen machine + full date list, and which of those dates are
 *  still actually booked under the current user's name right now. `ts`/`groupId`/`groupTitle`
 *  pass straight through from the frozen `BookingRun` unchanged — a run's group membership and
 *  earliest-booked timestamp don't change as its individual days get deleted. */
export interface LiveRun {
  machine: Machine;
  allDates: readonly string[];
  liveDates: string[];
  ts: string;
  groupId?: string;
  groupTitle?: string;
}

export function runKey(run: LiveRun): string {
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

/** This run's booking group, but only when it actually spans more than one machine — looked up
 *  live (current bookings, not the frozen run). A group of exactly one machine (a titled
 *  single-machine booking) isn't treated as a "real" group by any caller below: it's visually
 *  indistinguishable from a plain run anyway, so neither the group icon, the hint, nor the
 *  parent card would say/show anything useful. */
export function multiMachineGroup(run: LiveRun): { machineIds: Set<string> } | undefined {
  if (!run.groupId) return undefined;
  const group = findBookingGroup(store.get('data')!.bookings, run.groupId);
  return group.machineIds.size > 1 ? group : undefined;
}

/** A small icon marking a run as part of a real (multi-machine) booking group, right next to
 *  the machine name — replaces an earlier colored text pill (user request: indicate group
 *  membership with an icon). The group's own color-coded parent card (`GroupCard`) is what
 *  now carries the color; this icon is just the per-row "this belongs to that card" cue. */
function GroupMemberIcon({ run }: { run: LiveRun }) {
  if (!multiMachineGroup(run)) return null;
  return (
    <span className="grpicon" title="Teil einer Buchungsgruppe">
      <Icon name="folder" />
    </span>
  );
}

/** Shows "Teil einer Buchungsgruppe" when this run belongs to a real (multi-machine) booking
 *  group — same as `BookingDetailModal.tsx`'s own `SeriesOrGroupHint` this mirrors. Only shown
 *  for a run rendered on its own (`GroupCard` already names the group once, in its own header,
 *  for every member nested inside it — repeating this per member would be redundant there). */
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
 *  now, not here — see that component's comment for why. `showGroupHint` is false for a run
 *  rendered nested inside its own `GroupCard` — that card's header already names the group. */
function RunCardBody({
  run,
  isSeries,
  showGroupHint,
}: {
  run: LiveRun;
  isSeries: boolean;
  showGroupHint: boolean;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="abmach">
        <b>{run.machine.name}</b> <GroupMemberIcon run={run} />{' '}
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
      {showGroupHint && <GroupHint run={run} />}
    </div>
  );
}

export interface RunRowProps {
  run: LiveRun;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDeleteDates: (dates: readonly string[]) => void;
  /** False when nested inside a `GroupCard` — that card's own header already names the group,
   *  so the run's own `GroupHint` line would just repeat it. */
  showGroupHint?: boolean;
}

export function RunHead({
  run,
  isExpanded,
  onToggleExpand,
  onDeleteDates,
  showGroupHint = true,
}: RunRowProps) {
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
  // stack vertically), all sharing one standardized circular icon-button shape/border.
  const deleteLabel = isSeries ? 'Serie löschen' : 'Löschen';
  return (
    <div className="mybk">
      <RunCardBody run={run} isSeries={isSeries} showGroupHint={showGroupHint} />
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

export function DayList({
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

/** One item `RunList` renders: either a standalone run, or a whole real (multi-machine)
 *  booking group's runs bundled into one `GroupCard` — "Experiment Setup" style (user
 *  request): a single larger card naming the group, with its member machines as nested line
 *  items inside it, instead of a flat list of independently-carded rows for each member. */
export type MyBookingsDisplayItem =
  | { kind: 'single'; run: LiveRun }
  | { kind: 'group'; groupId: string; groupTitle: string | undefined; runs: LiveRun[] };

/**
 * Groups `runs` (already filtered/sorted — grouping only ever combines whatever the filter
 * left behind, never reaches past it) into display items: every run sharing the same real
 * multi-machine group id is bundled into one `GroupCard`, in the position of its first
 * occurrence in the list; every other run stays standalone. A group with only one of its
 * members surviving the current filter renders as a standalone run instead (matching
 * `multiMachineGroup`'s own "not a real group" rule) — a lone survivor gains nothing from
 * being wrapped in its own one-item card.
 */
export function groupRunsForDisplay(runs: readonly LiveRun[]): MyBookingsDisplayItem[] {
  const alreadyCarded = new Set<string>();
  const items: MyBookingsDisplayItem[] = [];
  for (const run of runs) {
    if (!run.groupId || !multiMachineGroup(run)) {
      items.push({ kind: 'single', run });
      continue;
    }
    if (alreadyCarded.has(run.groupId)) continue; // this group's card was already emitted
    const members = runs.filter((candidate) => candidate.groupId === run.groupId);
    if (members.length < 2) {
      items.push({ kind: 'single', run }); // only one member survived the current filter
      continue;
    }
    alreadyCarded.add(run.groupId);
    items.push({ kind: 'group', groupId: run.groupId, groupTitle: run.groupTitle, runs: members });
  }
  return items;
}

export function GroupCard({
  groupId,
  groupTitle,
  runs,
  expandedKeys,
  onToggleExpand,
  onDeleteDates,
}: {
  groupId: string;
  groupTitle: string | undefined;
  runs: readonly LiveRun[];
  expandedKeys: ReadonlySet<string>;
  onToggleExpand: (key: string) => void;
  onDeleteDates: (machine: Machine, dates: readonly string[]) => void;
}) {
  return (
    <div
      className="mybk-group"
      style={{ '--groupcolor': nameColor(groupId, isDarkTheme()) } as CSSProperties}
    >
      <div className="mybk-group-head">
        <Icon name="folder" />
        <b>{groupTitle || 'Buchungsgruppe'}</b>
        <span className="hint" style={{ margin: 0 }}>
          — {runs.length} Maschinen
        </span>
      </div>
      {runs.map((run) => {
        const key = runKey(run);
        const isExpanded = expandedKeys.has(key);
        return (
          <div key={key} className="mybk-group-item">
            <RunHead
              run={run}
              isExpanded={isExpanded}
              onToggleExpand={() => onToggleExpand(key)}
              onDeleteDates={(dates) => onDeleteDates(run.machine, dates)}
              showGroupHint={false}
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
