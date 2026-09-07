// =======================================================================================
// STATS MODAL COMPONENT (web/js/ui/components/StatsModal.tsx)
// =======================================================================================
//
// The Statistik modal: date-range controls, the Ressourcen overview (category-tabbed,
// group-folded, each row a stacked used/maintenance/idle bar) and its machine drilldown, plus
// the Personen overview/drilldown (reachable only via a preset person, see StatsControls.tsx).
//
// Key Principles:
// - ONE MODAL, FOUR FILES: controls live in `StatsControls.tsx`, the two overview modes in
//   `StatsOverviews.tsx`, and the two drilldowns in `StatsDrilldown.tsx` — split out purely to
//   stay under the file-length/function-length budgets; all four are one modal conceptually,
//   and this file is where they're composed together.
//
// =======================================================================================

import { useEffect, useId, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { MachineCategory } from '../../../../shared/types.ts';
import { todayAsIsoDateString } from '../../../../shared/dates.ts';
import { orderedMachines } from '../grid.ts';
import { CATEGORIES } from '../../core/machines.ts';
import {
  computeStats,
  buildResourceRows,
  buildPersonRows,
  computeCategoryDashboard,
  type Stats,
  type StatsMachineRow,
  type StatsPerson,
  type CategoryDashboard,
} from '../views/stats.ts';
import { toast } from '../toast.ts';
import { openReactModal, closeReactModal } from '../modal.tsx';
import { Button } from '../../components/ui/app-button.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import {
  StatsRangeRow,
  CategoryTabs,
  StatsBreadcrumb,
  StatsFilterRow,
  type StatsMode,
} from './StatsControls.tsx';
import { ResourcesOverview, PersonsOverview } from './StatsOverviews.tsx';
import { MachineDrilldown, PersonDrilldown } from './StatsDrilldown.tsx';
import { store } from '../../store-instance.ts';

function categoryLabel(category: MachineCategory): string {
  return CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

function categoryIcon(category: MachineCategory): string {
  return CATEGORIES.find((c) => c.id === category)?.icon ?? 'factory';
}

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

/** The drilldown selection (which machine/person, within Ressourcen/Personen) plus the name
 *  filter that resets with it. `mode` is fixed for the modal's lifetime (see
 *  `StatsControls.tsx`'s `StatsMode` doc) — set once here from `presetPerson`, never changed
 *  afterward. Split out of `useStatsState` purely to stay under the function-length budget. */
function useStatsSelection(presetPerson: string | undefined, agg: Stats) {
  const [mode] = useState<StatsMode>(presetPerson ? 'p' : 'm');
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

/** The Ressourcen-mode active category tab and group fold state. Split out of `useStatsState`
 *  purely to stay under the function-length budget. */
function useCategoryAndFoldState() {
  const [activeCategory, setActiveCategory] = useState<MachineCategory>('maschine');
  const [closedKeys, setClosedKeys] = useState<ReadonlySet<string>>(() => new Set());
  return {
    activeCategory,
    closedKeys,
    onCategoryChange: setActiveCategory,
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
  dashboard: CategoryDashboard;
  machineRow: StatsMachineRow | undefined;
  person: StatsPerson | undefined;
  filterQuery: string;
  activeCategory: MachineCategory;
  closedKeys: ReadonlySet<string>;
  onToggleFold: (key: string) => void;
  onSelectMachine: (machineId: string) => void;
  onSelectPerson: (personKey: string) => void;
}

/** Dispatches to the right drilldown or overview for the current mode/selection. Its own
 *  function so `StatsModal`'s render body isn't a multi-way nested ternary. */
function StatsBody({
  mode,
  agg,
  dashboard,
  machineRow,
  person,
  filterQuery,
  activeCategory,
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
        rows={buildResourceRows(agg.machRows, { filterQuery, activeCategory, closedKeys })}
        totalDays={totalDays}
        activeCategory={activeCategory}
        dashboard={dashboard}
        categoryLabel={categoryLabel(activeCategory)}
        categoryIcon={categoryIcon(activeCategory)}
        onToggleFold={onToggleFold}
        onSelectMachine={onSelectMachine}
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

/** The breadcrumb trail's own segments for the current mode/selection — "Statistik" plus
 *  whichever depth is currently drilled into (user request: always show depth within the
 *  data). Empty-list/one-segment results render nothing (`StatsBreadcrumb`'s own guard). */
function breadcrumbSegments(
  mode: StatsMode,
  activeCategory: MachineCategory,
  machineRow: StatsMachineRow | undefined,
  person: StatsPerson | undefined,
): string[] {
  const segments = ['Statistik'];
  if (mode === 'm') {
    segments.push(categoryLabel(activeCategory));
    if (machineRow) segments.push(machineRow.machine.name);
  } else {
    segments.push('Personen');
    if (person) segments.push(person.name);
  }
  return segments;
}

interface StatsModalProps {
  presetPerson?: string;
}

export function StatsModal({ presetPerson }: StatsModalProps) {
  const s = useStatsState(presetPerson);
  const titleId = useId();
  return (
    <AppDialog size="xl" labelledBy={titleId}>
      <AppDialogHeader
        icon={<BarChart3 className="size-6" />}
        title="Statistik"
        titleId={titleId}
        subtitle="Auslastung von Ressourcen und Personen im gewählten Zeitraum"
      />
      <AppDialogBody className="max-h-[78vh]">
        <StatsRangeRow
          from={s.from}
          to={s.to}
          onFromChange={s.onFromChange}
          onToChange={s.onToChange}
        />
        {s.mode === 'm' && (
          <CategoryTabs activeCategory={s.activeCategory} onCategoryChange={s.onCategoryChange} />
        )}
        <StatsBreadcrumb
          segments={breadcrumbSegments(s.mode, s.activeCategory, s.machineRow, s.person)}
        />
        <StatsFilterRow
          filterQuery={s.filterQuery}
          onFilterChange={s.onFilterChange}
          showBack={!!(s.machineRow || s.person)}
          onBack={s.onBack}
        />
        <div id="stOut" className="flex min-h-0 flex-1 flex-col">
          <StatsBody
            mode={s.mode}
            agg={s.agg}
            dashboard={computeCategoryDashboard(
              s.agg.machRows,
              store.get('data')!.bookings,
              s.agg.days,
              s.activeCategory,
            )}
            machineRow={s.machineRow}
            person={s.person}
            filterQuery={s.filterQuery}
            activeCategory={s.activeCategory}
            closedKeys={s.closedKeys}
            onToggleFold={s.onToggleFold}
            onSelectMachine={s.onSelectMachine}
            onSelectPerson={s.onSelectPerson}
          />
        </div>
      </AppDialogBody>
      <AppDialogFooter>
        <Button size="lg" className="ml-auto" onClick={closeReactModal}>
          Schließen
        </Button>
      </AppDialogFooter>
    </AppDialog>
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
