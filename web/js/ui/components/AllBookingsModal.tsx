// =======================================================================================
// ALL BOOKINGS MODAL COMPONENT (web/js/ui/components/AllBookingsModal.tsx)
// =======================================================================================
//
// The "All bookings" modal: every future booking run, filterable by person/machine/group/
// date range, with a "show in grid" jump per row.
//
// Key Principles:
// - READ-ONLY, FROZEN AT OPEN: list + "goto" only, no delete. Unlike My Bookings, the run
//   structure needs no live re-filtering against later mutations — it's computed once when
//   the modal opens (`useState`'s lazy initializer) and never recomputed for the rest of
//   this modal's lifetime, even if a write happens elsewhere while it's open.
//
// =======================================================================================

import { useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  formatDateLong,
  formatTimestamp,
  mondayOfDate,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../../shared/dates.ts';
import {
  CATEGORIES,
  CATEGORY_FILTER_PREFIX,
  groupsByCategory,
  type CategoryGroups,
} from '../../core/machines.ts';
import { orderedMachines } from '../grid.ts';
import {
  computeAllRuns,
  filterAllRuns,
  type AllRun,
  type AllBookingsFilter,
} from '../views/all-bookings.ts';
import { gotoDate, prependWeek, resetView } from '../grid-scroll.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { toast } from '../toast.ts';
import { Icon } from './Icon.tsx';
import { GroupOptions } from './GroupOptions.tsx';
import { store } from '../../store-instance.ts';
import { saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'termin', label: 'Termin der Buchung' },
  { value: 'erstellt', label: 'Zuletzt gebucht' },
  { value: 'bereich', label: 'Bereich' },
  { value: 'maschine', label: 'Maschine' },
  { value: 'person', label: 'Person' },
];

/** Jumps to a run's first day in the grid, filtered to just its machine — guaranteed
 *  visible even if its category/group is folded (unlike My Bookings' `gotoRun`, which
 *  expands them instead; this modal has no per-user machine set to fall back on, so
 *  filtering to the one machine is the only way to guarantee visibility here). */
function goto(run: AllRun): void {
  closeReactModal();
  // Both writes stay silent — saveFilters()/updateMachBtn()/resetView() run before the one
  // notify, matching the original's single window.notify() after all of this.
  store.state.machSel = new Set([run.machine.id]);
  saveFilters();
  updateMachBtn();
  store.state.startMonday = mondayOfDate(parseIsoDateString(run.dates[0]!));
  resetView();
  store.notify();
  prependWeek();
  gotoDate(run.dates[0]!);
  toast(`Plan gefiltert auf „${run.machine.name}".`, undefined, 4000);
}

interface AllBookingsFiltersProps {
  filter: AllBookingsFilter;
  groupOptions: readonly CategoryGroups[];
  onChange: (patch: Partial<AllBookingsFilter>) => void;
}

/** The filter row: person/machine substrings, a group `<select>` (grouped by category), a sort
 *  key, and a date-overlap window. */
function AllBookingsFilters({ filter, groupOptions, onChange }: AllBookingsFiltersProps) {
  const onInput =
    (key: keyof AllBookingsFilter) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ [key]: event.target.value });
  return (
    <div className="abfilters">
      <div className="fld">
        <label>Person</label>
        <input
          type="text"
          placeholder="Kolmanovskyi"
          value={filter.person}
          onChange={onInput('person')}
        />
      </div>
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

function AllBookingsRow({ run }: { run: AllRun }) {
  const isSeries = run.dates.length > 1;
  return (
    <div className="mybk">
      <div style={{ minWidth: 0 }}>
        <div className="abmach">
          <b>{run.machine.name}</b>{' '}
          <span className="hint" style={{ margin: 0 }}>
            · {run.machine.group}
          </span>
        </div>
        <div className="abdate">
          {isSeries
            ? `${formatDateLong(run.dates[0]!)} – ${formatDateLong(run.dates[run.dates.length - 1]!)}`
            : formatDateLong(run.dates[0]!)}{' '}
          <span className="tag">
            {run.dates.length} Tag{isSeries ? 'e' : ''}
          </span>
        </div>
        <div className="hint" style={{ margin: 0 }}>
          <Icon name="user" /> {run.name}
          {run.ts && <span style={{ opacity: 0.8 }}> · gebucht am {formatTimestamp(run.ts)}</span>}
        </div>
      </div>
      <button
        className="btn small"
        title="Im Plan anzeigen"
        aria-label="Im Plan anzeigen"
        onClick={() => goto(run)}
      >
        <Icon name="pin" />
      </button>
    </div>
  );
}

export function AllBookingsModal() {
  const [runsAll] = useState<readonly AllRun[]>(() =>
    computeAllRuns(
      orderedMachines(store.get('data')!.machines, store.get('favs')),
      store.get('data')!.bookings,
      todayAsIsoDateString(),
    ),
  );
  const [filter, setFilter] = useState<AllBookingsFilter>(() => ({
    person: '',
    mach: '',
    group: '',
    from: todayAsIsoDateString(),
    to: '',
    sort: localStorage.getItem('mb_absort') || 'termin',
  }));

  function updateFilter(patch: Partial<AllBookingsFilter>): void {
    if (patch.sort) localStorage.setItem('mb_absort', patch.sort);
    setFilter((prev) => ({ ...prev, ...patch }));
  }

  const groupOptions = groupsByCategory(store.get('data')!.machines);
  const rows = filterAllRuns(runsAll, filter);

  return (
    <>
      <h2>
        <Icon name="table" /> Alle Buchungen (ab heute)
      </h2>
      <AllBookingsFilters filter={filter} groupOptions={groupOptions} onChange={updateFilter} />
      <div className="hint" style={{ margin: '0 0 6px' }}>
        {rows.length} Einträge{rows.length === 300 ? ' (gekürzt)' : ''}
      </div>
      <div className="resultlist" style={{ maxHeight: 420 }}>
        {rows.length ? (
          rows.map((run) => (
            <AllBookingsRow key={`${run.machine.id}|${run.dates[0]}|${run.name}`} run={run} />
          ))
        ) : (
          <p className="hint">Keine Buchungen für diese Filter gefunden.</p>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={closeReactModal}>
          Schließen
        </button>
      </div>
    </>
  );
}

/** Opens "All bookings". Guarded even though the toolbar button this is normally wired to
 *  stays hidden until the initial load succeeds (making this unreachable in practice) —
 *  cheap defensive-in-depth against a future caller, or a test, that opens it before data
 *  has loaded; `AllBookingsModal`'s own initial-state `useState` unwraps `store.get('data')`
 *  with `!`. */
export function openAllBookings(): void {
  if (!store.get('data')) {
    toast('Noch keine Daten geladen — bitte kurz warten.');
    return;
  }
  openReactModal(<AllBookingsModal />);
}
