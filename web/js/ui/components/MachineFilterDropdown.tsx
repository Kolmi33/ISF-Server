// =======================================================================================
// MACHINE FILTER DROPDOWN COMPONENT (web/js/ui/components/MachineFilterDropdown.tsx)
// =======================================================================================
//
// The toolbar "Filtern ▾" resource-filter dropdown. Mounted once at boot onto `#machDrop`,
// the same pattern `ContextMenu.tsx` uses onto `#ctxMenu`; open/close mechanics are the
// shared `ui/toolbar-dropdown.ts` hook, the same one `GroupFilterDropdown.tsx` uses.
//
// Key Principles:
// - RENDERING ONLY, ROW LOGIC LIVES ELSEWHERE: row structure/visibility is pure
//   (`ui/machine-filter.ts`); this component owns the interactive fold/search/
//   category-shown state, all local and reset every time the dropdown reopens — never
//   persisted across opens.
//
// =======================================================================================

import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { cn } from 'cn';
import type { MachineCategory } from '../../../../shared/types.ts';
import { CATEGORIES } from '../../core/machines.ts';
import { orderedMachines } from '../grid.ts';
import { buildMachineFilterRows, type MachineFilterRow } from '../machine-filter.ts';
import { useToolbarDropdown } from '../toolbar-dropdown.ts';
import { Icon } from './Icon.tsx';
import { Button } from '../../components/ui/app-button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { SearchField } from './app/SearchField.tsx';
import { SECTION_LABEL_CLASS } from './app/typography.ts';
import { store } from '../../store-instance.ts';

/** Persists the machine AND group filter selections — shared by `GroupFilterDropdown.tsx`
 *  and three other callers (`AllBookingsModal`'s/`AssistantResults`'s/`MyBookingsModal`'s
 *  "only my machines" shortcuts). */
export function saveFilters(): void {
  localStorage.setItem('mb_machsel', JSON.stringify([...store.get('machSel')]));
  localStorage.setItem('mb_groupssel', JSON.stringify([...store.get('groupsSel')]));
  localStorage.setItem('mb_grid_query', store.get('gridQuery'));
  localStorage.setItem('mb_grid_available', store.get('gridAvailableOnly') ? 'on' : 'off');
  localStorage.setItem('mb_grid_operational', store.get('gridOperationalOnly') ? 'on' : 'off');
  localStorage.setItem('mb_grid_favorites', store.get('gridFavoritesOnly') ? 'on' : 'off');
}

/** Refreshes the toolbar button's label/highlight from the current machine selection, plus
 *  the toolbar's own quick-clear "×" (`#machClearBtn`, next to `#machBtn` inside their shared
 *  `#machWrap` box — user request: clear an active filter instantly from the main view,
 *  without opening the dropdown at all). Both are static markup, not React-rendered — mutated
 *  directly rather than through JSX. The `filtered` class on the wrap merges the "×" visually
 *  into the same box as the button once it's shown (user request: "Beim Filter muss das 'x'
 *  Teil des Kastens sein" — see app.css). */
export function updateMachBtn(): void {
  const count = [
    store.get('machSel').size > 0,
    store.get('groupsSel').size > 0,
    !!store.get('gridQuery').trim(),
    store.get('gridAvailableOnly'),
    store.get('gridOperationalOnly'),
    store.get('gridFavoritesOnly'),
  ].filter(Boolean).length;
  const button = document.getElementById('machBtn');
  if (button) {
    button.innerHTML =
      '<svg class="ic" aria-hidden="true"><use href="#i-search"/></svg> ' +
      (count ? `Filtern (${count}) ▾` : 'Filtern ▾');
    button.style.background = count ? 'var(--accent-light)' : '';
  }
  const clearButton = document.getElementById('machClearBtn');
  const isFiltered = count > 0;
  if (clearButton) clearButton.style.display = isFiltered ? '' : 'none';
  document.getElementById('machWrap')?.classList.toggle('filtered', isFiltered);
}

/** Clears the machine filter selection — the toolbar quick-clear's own action, reachable
 *  without opening the dropdown. `useMachineSelectionActions`'s own "Filter löschen" row
 *  inside the popover calls this too (plus its local `bumpTick`, needed only while the
 *  dropdown is actually mounted/open), so both routes stay in lockstep. Clicking the toolbar
 *  button also closes the dropdown first if it happened to be open (`useToolbarDropdown`'s own
 *  outside-mousedown handling, since `#machClearBtn` sits outside both `#machBtn` and
 *  `#machDrop`), so there's no mounted popover left to desync from this external clear. */
export function clearMachineFilter(): void {
  store.get('machSel').clear();
  store.get('groupsSel').clear();
  store.state.gridQuery = '';
  store.state.gridAvailableOnly = false;
  store.state.gridOperationalOnly = false;
  store.state.gridFavoritesOnly = false;
  saveFilters();
  updateMachBtn();
  store.notify();
}

const DEFAULT_OPEN_KEYS = new Set(['fav']);
const DEFAULT_SHOWN: ReadonlySet<MachineCategory> = new Set(['maschine', 'messtechnik']);

function useMachineFilterState(isOpen: boolean) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(DEFAULT_OPEN_KEYS);
  const [shownCategories, setShownCategories] =
    useState<ReadonlySet<MachineCategory>>(DEFAULT_SHOWN);
  const [searchQuery, setSearchQuery] = useState(store.get('gridQuery'));
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setOpenKeys(new Set(['fav']));
    setShownCategories(new Set(['maschine', 'messtechnik']));
    setSearchQuery(store.get('gridQuery'));
    searchInputRef.current?.focus();
  }, [isOpen]);

  function toggleOpenKey(key: string): void {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleShownCategory(category: MachineCategory): void {
    setShownCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return {
    openKeys,
    shownCategories,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    toggleOpenKey,
    toggleShownCategory,
  };
}

function CategoryShownToggle({
  shownCategories,
  onToggle,
}: {
  shownCategories: ReadonlySet<MachineCategory>;
  onToggle: (category: MachineCategory) => void;
}) {
  return (
    <div
      className="seg flex shrink-0 gap-1 rounded-lg border border-border bg-muted/50 p-1"
      role="group"
      aria-label="Kategorie in der Liste zeigen"
    >
      {CATEGORIES.map(({ id, label, icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={shownCategories.has(id)}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            shownCategories.has(id)
              ? 'bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onToggle(id)}
        >
          <span className="inline-flex [&_svg]:size-4">
            <Icon name={icon} />
          </span>
          {label}
        </button>
      ))}
    </div>
  );
}

/** A fold header — the category level (`cathead`) or the department level (`grpsub`). */
function FoldRow({
  label,
  open,
  strong,
  onToggle,
  className,
}: {
  label: string;
  open: boolean;
  strong?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <ChevronDown
        className={cn(
          'tarr size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
          !open && '-rotate-90',
        )}
      />
      <span className={cn(SECTION_LABEL_CLASS, strong && 'text-foreground')}>{label}</span>
    </button>
  );
}

function MachineFilterRowView({
  row,
  checked,
  onToggleOpen,
  onToggleMachine,
}: {
  row: MachineFilterRow;
  checked: boolean;
  onToggleOpen: (key: string) => void;
  onToggleMachine: (machineId: string, isChecked: boolean) => void;
}) {
  const id = useId();
  if (row.kind === 'category') {
    return (
      <FoldRow
        className="grp cathead click mt-2 first:mt-0"
        label={row.label}
        open={row.open}
        strong
        onToggle={() => onToggleOpen(row.key)}
      />
    );
  }
  if (row.kind === 'group') {
    return (
      <FoldRow
        className="grp grpsub click ml-2"
        label={row.label}
        open={row.open}
        onToggle={() => onToggleOpen(row.key)}
      />
    );
  }
  return (
    <label
      htmlFor={id}
      className={cn(
        'ml-4 flex cursor-pointer select-none items-center gap-3 rounded-lg border px-3 py-1.5 text-sm transition-colors',
        checked ? 'border-primary/45 bg-primary/[0.08]' : 'border-transparent hover:bg-muted',
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onToggleMachine(row.machine.id, next)}
        className="size-[18px] rounded-[5px]"
      />
      <span className="min-w-0 truncate text-foreground">{row.machine.name}</span>
    </label>
  );
}

/** The bump-and-persist actions checkbox changes / "Filter löschen" take on the machine
 *  selection. */
function useMachineSelectionActions(bumpTick: () => void) {
  function handleMachineToggle(machineId: string, isChecked: boolean): void {
    if (isChecked) store.get('machSel').add(machineId);
    else store.get('machSel').delete(machineId);
    saveFilters();
    updateMachBtn();
    store.notify();
    bumpTick();
  }

  function handleClear(): void {
    clearMachineFilter();
    bumpTick();
  }

  return { handleMachineToggle, handleClear };
}

function commitFacet(partial: Parameters<typeof store.set>[0], rerender: () => void): void {
  store.set(partial);
  saveFilters();
  updateMachBtn();
  rerender();
}

function LocationFacets({ rerender }: { rerender: () => void }) {
  const data = store.get('data')!;
  const groups = data.groups || [...new Set(data.machines.map((machine) => machine.group))];
  const toggle = (group: string, checked: boolean) => {
    if (checked) store.get('groupsSel').add(group);
    else store.get('groupsSel').delete(group);
    commitFacet({}, rerender);
  };
  return (
    <fieldset className="grid gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Bereiche
      </legend>
      <div className="grid max-h-28 grid-cols-2 gap-x-3 gap-y-2 overflow-y-auto text-sm">
        {groups.map((group) => (
          <label key={group} className="flex min-w-0 cursor-pointer items-center gap-2">
            <Checkbox
              checked={store.get('groupsSel').has(group)}
              onCheckedChange={(checked) => toggle(group, checked)}
            />
            <span className="truncate">{group}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BooleanFacets({ rerender }: { rerender: () => void }) {
  const facets = [
    ['gridAvailableOnly', 'Im sichtbaren Zeitraum frei'],
    ['gridOperationalOnly', 'Nur betriebsbereite Geräte'],
    ['gridFavoritesOnly', 'Nur Favoriten'],
  ] as const;
  return (
    <div className="grid gap-1 rounded-lg border border-border p-2">
      {facets.map(([key, label]) => {
        const active = store.get(key);
        return (
          <button
            key={key}
            type="button"
            role="switch"
            aria-checked={active}
            className="flex items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
            onClick={() => commitFacet({ [key]: !active }, rerender)}
          >
            {label}
            <span
              className={`relative h-5 w-9 rounded-full transition-colors ${active ? 'bg-primary' : 'bg-muted-foreground/25'}`}
            >
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SelectionSummary({ count, onClear }: { count: number; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {count > 0 && (
        <span className="text-[11px] tabular-nums text-muted-foreground">{count} ausgewählt</span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="clearbtn ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onClick={onClear}
      >
        <Trash2 className="size-3.5" /> Filter löschen
      </Button>
    </div>
  );
}

function MachineFilterBody({
  state,
  rows,
  onToggleMachine,
  onClear,
  rerender,
}: {
  state: ReturnType<typeof useMachineFilterState>;
  rows: MachineFilterRow[];
  onToggleMachine: (machineId: string, isChecked: boolean) => void;
  onClear: () => void;
  rerender: () => void;
}) {
  const selectedCount = store.get('machSel').size;
  return (
    <div className="ui-scope flex w-[22rem] max-w-[calc(100vw-24px)] flex-col gap-3 rounded-xl border border-border bg-popover p-3 text-popover-foreground">
      <CategoryShownToggle
        shownCategories={state.shownCategories}
        onToggle={state.toggleShownCategory}
      />
      <SearchField
        ref={state.searchInputRef}
        placeholder="Ressource suchen…"
        aria-label="Ressource suchen"
        value={state.searchQuery}
        onChange={(event) => {
          const value = event.target.value;
          state.setSearchQuery(value);
          commitFacet({ gridQuery: value }, rerender);
        }}
      />
      <LocationFacets rerender={rerender} />
      <BooleanFacets rerender={rerender} />
      <SelectionSummary count={selectedCount} onClear={onClear} />
      <ScrollArea className="mlist -mr-2 max-h-80 min-h-0 pr-2">
        <div className="flex flex-col gap-0.5">
          {rows.map((row) => (
            <MachineFilterRowView
              key={row.kind === 'machine' ? row.machine.id : row.key}
              row={row}
              checked={row.kind === 'machine' && store.get('machSel').has(row.machine.id)}
              onToggleOpen={state.toggleOpenKey}
              onToggleMachine={onToggleMachine}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Mounted once at boot onto `#machDrop`. */
export function MachineFilterDropdown() {
  const { isOpen } = useToolbarDropdown('machDrop', 'machBtn');
  const state = useMachineFilterState(isOpen);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const bumpTick = () => bump();
  const { handleMachineToggle, handleClear } = useMachineSelectionActions(bumpTick);
  if (!isOpen) return null;

  const machines = orderedMachines(store.get('data')!.machines, store.get('favs'));
  const rows = buildMachineFilterRows(machines, {
    favoriteIds: store.get('favs'),
    searchQuery: state.searchQuery,
    openKeys: state.openKeys,
    shownCategories: state.shownCategories,
  });
  return (
    <MachineFilterBody
      state={state}
      rows={rows}
      onToggleMachine={handleMachineToggle}
      onClear={handleClear}
      rerender={bumpTick}
    />
  );
}
