// =======================================================================================
// STATS MODAL COMPONENT (web/js/ui/components/StatsModal.tsx)
// =======================================================================================
//
// The Statistik modal: date-range/mode controls, three overview modes (Ressourcen/
// Personen/Wartung), and two drilldowns (one machine, one person).
//
// Key Principles:
// - ONE MODAL, FOUR FILES: controls live in `StatsControls.tsx`, the three overview modes
//   in `StatsOverviews.tsx`, and the two drilldowns in `StatsDrilldown.tsx` — split out
//   purely to stay under the file-length/function-length budgets; all four are one modal
//   conceptually, and this file is where they're composed together.
//
// =======================================================================================

import { useEffect, useState } from 'react';
import { todayAsIsoDateString } from '../../../../shared/dates.ts';
import { orderedMachines } from '../grid.ts';
import {
  computeStats,
  buildResourceRows,
  buildMaintRows,
  buildPersonRows,
  type Stats,
  type StatsMachineRow,
  type StatsPerson,
} from '../views/stats.ts';
import { toast } from '../toast.ts';
import { openReactModal, closeReactModal } from '../modal.tsx';
import { Icon } from './Icon.tsx';
import { StatsRangeRow, StatsModeRow, StatsFilterRow, type StatsMode } from './StatsControls.tsx';
import { ResourcesOverview, MaintenanceOverview, PersonsOverview } from './StatsOverviews.tsx';
import { MachineDrilldown, PersonDrilldown } from './StatsDrilldown.tsx';
import { store } from '../../store-instance.ts';

function computeAgg(from: string, to: string): Stats {
  return computeStats(
    orderedMachines(store.get('data')!.machines, store.get('favs')),
    store.get('data')!.bookings,
    from,
    to,
  );
}

/** The date range + its aggregation. Split out of `useStatsState` purely to stay under the
 *  function-length budget. */
function useStatsRange() {
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(() => todayAsIsoDateString());
  const [agg, setAgg] = useState<Stats>(() => computeAgg(from, to));

  function changeRange(nextFrom: string, nextTo: string): void {
    if (!nextFrom || !nextTo || nextFrom > nextTo) {
      toast('Bitte gültigen Zeitraum wählen.');
      return;
    }
    setAgg(computeAgg(nextFrom, nextTo));
  }

  return {
    from,
    to,
    agg,
    onFromChange: (value: string) => {
      setFrom(value);
      changeRange(value, to);
    },
    onToChange: (value: string) => {
      setTo(value);
      changeRange(from, value);
    },
  };
}

/** The mode + drilldown selection (which machine/person, within Ressourcen/Personen), plus the
 *  name filter that resets with it. Split out of `useStatsState` purely to stay under the
 *  function-length budget. */
function useStatsSelection(presetPerson: string | undefined, agg: Stats) {
  const [mode, setMode] = useState<StatsMode>(presetPerson ? 'p' : 'm');
  const [selM, setSelM] = useState<string | null>(null);
  const [selP, setSelP] = useState<string | null>(presetPerson ?? null);
  const [filterQuery, setFilterQuery] = useState('');

  const machineRow =
    mode === 'm' && selM ? agg.machRows.find((r) => r.machine.id === selM) : undefined;
  const person = mode === 'p' && selP ? agg.persons.get(selP) : undefined;

  // A stale drilldown selection (its machine/person has no data in the recomputed range)
  // resets and falls back to the overview. `machineRow`/`person` already read as `undefined`
  // for this render, so the overview shows immediately; this just settles `selM`/`selP` so
  // the next render (and the back button's visibility) agree.
  useEffect(() => {
    if (selM && !machineRow) setSelM(null);
  }, [selM, machineRow]);
  useEffect(() => {
    if (selP && !person) setSelP(null);
  }, [selP, person]);

  return {
    mode,
    filterQuery,
    machineRow,
    person,
    onModeChange: (nextMode: StatsMode) => {
      setMode(nextMode);
      setSelM(null);
      setSelP(null);
      setFilterQuery('');
    },
    onFilterChange: setFilterQuery,
    onSelectMachine: setSelM,
    onSelectPerson: setSelP,
    onBack: () => {
      setSelM(null);
      setSelP(null);
    },
  };
}

function toggleInSet(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** The Ressourcen-mode category show/hide and category/group fold state. Split out of
 *  `useStatsState` purely to stay under the function-length budget. */
function useCategoryAndFoldState() {
  const [visibleCategories, setVisibleCategories] = useState<ReadonlySet<string>>(
    () => new Set(['maschine', 'messtechnik']),
  );
  const [closedKeys, setClosedKeys] = useState<ReadonlySet<string>>(() => new Set());
  return {
    visibleCategories,
    closedKeys,
    onToggleCategory: (id: string) => setVisibleCategories((prev) => toggleInSet(prev, id)),
    onToggleFold: (key: string) => setClosedKeys((prev) => toggleInSet(prev, key)),
  };
}

/** All of the modal's state and the handlers that mutate it, composed from the three pieces
 *  above — split out of `StatsModal` so the component itself is just JSX composition. */
function useStatsState(presetPerson: string | undefined) {
  const range = useStatsRange();
  const selection = useStatsSelection(presetPerson, range.agg);
  const categoryAndFold = useCategoryAndFoldState();
  return { ...range, ...selection, ...categoryAndFold };
}

interface StatsBodyProps {
  mode: StatsMode;
  agg: Stats;
  machineRow: StatsMachineRow | undefined;
  person: StatsPerson | undefined;
  filterQuery: string;
  visibleCategories: ReadonlySet<string>;
  closedKeys: ReadonlySet<string>;
  onToggleFold: (key: string) => void;
  onSelectMachine: (machineId: string) => void;
  onSelectPerson: (personKey: string) => void;
}

/** Dispatches to the right drilldown or overview for the current mode/selection. Its own
 *  function so `StatsModal`'s render body isn't a five-way nested ternary. */
function StatsBody({
  mode,
  agg,
  machineRow,
  person,
  filterQuery,
  visibleCategories,
  closedKeys,
  onToggleFold,
  onSelectMachine,
  onSelectPerson,
}: StatsBodyProps) {
  const totalDays = agg.days.length;
  if (mode === 'm' && machineRow)
    return <MachineDrilldown row={machineRow} totalDays={totalDays} />;
  if (mode === 'p' && person) return <PersonDrilldown person={person} />;
  if (mode === 'm') {
    return (
      <ResourcesOverview
        rows={buildResourceRows(agg.machRows, { filterQuery, visibleCategories, closedKeys })}
        totalDays={totalDays}
        onToggleFold={onToggleFold}
        onSelectMachine={onSelectMachine}
      />
    );
  }
  if (mode === 'w') {
    return (
      <MaintenanceOverview
        rows={buildMaintRows(agg.maint.rows, filterQuery)}
        totalInstances={agg.maint.slotCount}
        totalDays={agg.maint.days}
      />
    );
  }
  return (
    <PersonsOverview
      persons={buildPersonRows(agg.persons, filterQuery)}
      onSelectPerson={onSelectPerson}
    />
  );
}

interface StatsModalProps {
  presetPerson?: string;
}

export function StatsModal({ presetPerson }: StatsModalProps) {
  const s = useStatsState(presetPerson);
  return (
    <>
      <h2>
        <Icon name="chart" /> Statistik
      </h2>
      <StatsRangeRow
        from={s.from}
        to={s.to}
        onFromChange={s.onFromChange}
        onToChange={s.onToChange}
      />
      <StatsModeRow
        mode={s.mode}
        onModeChange={s.onModeChange}
        visibleCategories={s.visibleCategories}
        onToggleCategory={s.onToggleCategory}
      />
      <StatsFilterRow
        filterQuery={s.filterQuery}
        onFilterChange={s.onFilterChange}
        showBack={!!(s.machineRow || s.person)}
        onBack={s.onBack}
      />
      <div id="stOut">
        <StatsBody
          mode={s.mode}
          agg={s.agg}
          machineRow={s.machineRow}
          person={s.person}
          filterQuery={s.filterQuery}
          visibleCategories={s.visibleCategories}
          closedKeys={s.closedKeys}
          onToggleFold={s.onToggleFold}
          onSelectMachine={s.onSelectMachine}
          onSelectPerson={s.onSelectPerson}
        />
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={closeReactModal}>
          Schließen
        </button>
      </div>
    </>
  );
}

/** Opens Statistik, optionally pre-filtered to one person (jumps straight into the
 *  Personen-mode drilldown). Guarded even though the toolbar button this is normally wired
 *  to stays hidden until the initial load succeeds (making this unreachable in practice) —
 *  cheap defensive-in-depth against a future caller, or a test, that opens it before data
 *  has loaded; `computeAgg`'s initial-state `useState` unwraps `store.get('data')` with `!`. */
export function openStats(presetPerson?: string): void {
  if (!store.get('data')) {
    toast('Noch keine Daten geladen — bitte kurz warten.');
    return;
  }
  openReactModal(<StatsModal presetPerson={presetPerson} />);
}
