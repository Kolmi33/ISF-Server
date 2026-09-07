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
}

/** Refreshes the toolbar button's label/highlight from the current machine selection, plus
 *  the toolbar's own quick-clear "×" (`#machClearBtn`, next to `#machBtn` inside their shared
 *  `#machWrap` box — user request: clear an active filter instantly from the main view,
 *  without opening the dropdown at all). Both are static markup, not React-rendered — mutated
 *  directly rather than through JSX. The `filtered` class on the wrap merges the "×" visually
 *  into the same box as the button once it's shown (user request: "Beim Filter muss das 'x'
 *  Teil des Kastens sein" — see app.css). */
export function updateMachBtn(): void {
  const button = document.getElementById('machBtn');
  if (button) {
    const count = store.get('machSel').size;
    button.innerHTML =
      '<svg class="ic" aria-hidden="true"><use href="#i-search"/></svg> ' +
      (count ? `${count} gewählt ▾` : 'Filtern ▾');
    button.style.background = count ? 'var(--accent-light)' : '';
  }
  const clearButton = document.getElementById('machClearBtn');
  const isFiltered = store.get('machSel').size > 0;
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
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setOpenKeys(new Set(['fav']));
    setShownCategories(new Set(['maschine', 'messtechnik']));
    setSearchQuery('');
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
              ? 'bg-card text-foreground shadow-sm'
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

function MachineFilterBody({
  state,
  rows,
  onToggleMachine,
  onClear,
}: {
  state: ReturnType<typeof useMachineFilterState>;
  rows: MachineFilterRow[];
  onToggleMachine: (machineId: string, isChecked: boolean) => void;
  onClear: () => void;
}) {
  const selectedCount = store.get('machSel').size;
  return (
    <div className="ui-scope flex w-[22rem] max-w-[calc(100vw-24px)] flex-col gap-3 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
      <CategoryShownToggle
        shownCategories={state.shownCategories}
        onToggle={state.toggleShownCategory}
      />
      <SearchField
        ref={state.searchInputRef}
        placeholder="Ressource suchen…"
        aria-label="Ressource suchen"
        value={state.searchQuery}
        onChange={(event) => state.setSearchQuery(event.target.value)}
      />
      <div className="flex items-center gap-2">
        {/* Only shown once something's actually selected (user request) — with nothing
            selected there's nothing to count, and "alle sichtbar" sat here disconnected from
            the clear button next to it since there was nothing yet to clear. */}
        {selectedCount > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {selectedCount} ausgewählt
          </span>
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
  const [, bumpTick] = useReducer((n: number) => n + 1, 0);
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
    />
  );
}
