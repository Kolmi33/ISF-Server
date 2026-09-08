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

import { useId, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { MapPin, Table2, UserRound } from 'lucide-react';
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
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/app-button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { NativeSelect } from '../../components/ui/native-select.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { EmptyState } from './app/EmptyState.tsx';
import { FormField } from './app/FormField.tsx';
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
/** The Person/Maschine/Bereich half. Split from the date half purely to stay under the
 *  function-length budget — they render as one grid. */
function AllBookingsWhoFields({
  filter,
  groupOptions,
  onInput,
}: {
  filter: AllBookingsFilter;
  groupOptions: readonly CategoryGroups[];
  onInput: (
    key: keyof AllBookingsFilter,
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
}) {
  const ids = { person: useId(), mach: useId(), group: useId() };
  return (
    <>
      <FormField label="Person" htmlFor={ids.person}>
        <Input
          id={ids.person}
          type="text"
          className="h-10 rounded-lg"
          placeholder="Kolmanovskyi"
          value={filter.person}
          onChange={onInput('person')}
        />
      </FormField>
      <FormField label="Maschine" htmlFor={ids.mach}>
        <Input
          id={ids.mach}
          type="text"
          className="h-10 rounded-lg"
          placeholder="Berger"
          value={filter.mach}
          onChange={onInput('mach')}
        />
      </FormField>
      <FormField label="Bereich" htmlFor={ids.group}>
        <NativeSelect id={ids.group} value={filter.group} onChange={onInput('group')}>
          <option value="">Alle</option>
          {groupOptions.map(({ category }) => (
            <option key={`cat:${category}`} value={`${CATEGORY_FILTER_PREFIX}${category}`}>
              {CATEGORIES.find((c) => c.id === category)?.label ?? category} (alle Bereiche)
            </option>
          ))}
          <GroupOptions groupOptions={groupOptions} />
        </NativeSelect>
      </FormField>
    </>
  );
}

/** The sort key + date window half. See `AllBookingsWhoFields` for why this is separate. */
function AllBookingsWhenFields({
  filter,
  onInput,
}: {
  filter: AllBookingsFilter;
  onInput: (
    key: keyof AllBookingsFilter,
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
}) {
  const ids = { sort: useId(), from: useId(), to: useId() };
  return (
    <>
      <FormField label="Sortieren" htmlFor={ids.sort}>
        <NativeSelect id={ids.sort} value={filter.sort} onChange={onInput('sort')}>
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Von" htmlFor={ids.from}>
        <Input
          id={ids.from}
          type="date"
          className="h-10 rounded-lg"
          value={filter.from}
          onChange={onInput('from')}
        />
      </FormField>
      <FormField label="Bis" htmlFor={ids.to}>
        <Input
          id={ids.to}
          type="date"
          className="h-10 rounded-lg"
          value={filter.to}
          onChange={onInput('to')}
        />
      </FormField>
    </>
  );
}

function AllBookingsFilters({ filter, groupOptions, onChange }: AllBookingsFiltersProps) {
  const onInput =
    (key: keyof AllBookingsFilter) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ [key]: event.target.value });
  return (
    <div className="abfilters grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3">
      <AllBookingsWhoFields filter={filter} groupOptions={groupOptions} onInput={onInput} />
      <AllBookingsWhenFields filter={filter} onInput={onInput} />
    </div>
  );
}

function AllBookingsRow({ run }: { run: AllRun }) {
  const isSeries = run.dates.length > 1;
  return (
    <div className="mybk flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40">
      <div className="min-w-0 flex-1">
        <div className="abmach flex flex-wrap items-center gap-1.5">
          <b className="text-sm font-semibold text-foreground">{run.machine.name}</b>
          <span className="text-[11px] text-muted-foreground">· {run.machine.group}</span>
        </div>
        <div className="abdate mt-0.5 flex flex-wrap items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          {isSeries
            ? `${formatDateLong(run.dates[0]!)} – ${formatDateLong(run.dates[run.dates.length - 1]!)}`
            : formatDateLong(run.dates[0]!)}
          <Badge>
            {run.dates.length} Tag{isSeries ? 'e' : ''}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <UserRound className="size-3.5 shrink-0" /> {run.name}
          {run.ts && <span className="tabular-nums">· gebucht am {formatTimestamp(run.ts)}</span>}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Im Plan anzeigen"
        aria-label="Im Plan anzeigen"
        onClick={() => goto(run)}
      >
        <MapPin className="size-4" />
      </Button>
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
  const titleId = useId();

  function updateFilter(patch: Partial<AllBookingsFilter>): void {
    if (patch.sort) localStorage.setItem('mb_absort', patch.sort);
    setFilter((prev) => ({ ...prev, ...patch }));
  }

  const machines = store.get('data')!.machines;
  const groupOptions = useMemo(() => groupsByCategory(machines), [machines]);
  const rows = useMemo(() => filterAllRuns(runsAll, filter), [runsAll, filter]);

  return (
    <AppDialog size="lg" labelledBy={titleId}>
      <AppDialogHeader
        icon={<Table2 className="size-6" />}
        title="Alle Buchungen"
        titleId={titleId}
        subtitle="Jede Reservierung ab heute, filter- und sortierbar"
      />
      <AppDialogBody className="max-h-[72vh]">
        <AllBookingsFilters filter={filter} groupOptions={groupOptions} onChange={updateFilter} />
        {rows.length ? (
          <ScrollArea className="resultlist -mr-3 min-h-0 flex-1 pr-3">
            <div className="flex flex-col gap-2">
              {rows.map((run) => (
                <AllBookingsRow key={`${run.machine.id}|${run.dates[0]}|${run.name}`} run={run} />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <EmptyState>Keine Buchungen für diese Filter gefunden.</EmptyState>
        )}
      </AppDialogBody>
      <AppDialogFooter>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {rows.length} Einträge{rows.length === 300 ? ' (gekürzt)' : ''}
        </span>
        <Button size="lg" className="ml-auto" onClick={closeReactModal}>
          Schließen
        </Button>
      </AppDialogFooter>
    </AppDialog>
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
