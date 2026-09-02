// The toolbar "Filtern ▾" resource-filter dropdown (Phase 7 slice B10e). Faithful port of
// legacy `fillMachSel`/`updateMachBtn`/`saveFilters` (the machine half — `saveFilters` also
// persists the group filter, shared with `GroupFilterDropdown.tsx`). Mounted once at boot onto
// `#machDrop`, same pattern as `ContextMenu.tsx` onto `#ctxMenu`; open/close mechanics are
// `ui/toolbar-dropdown.ts`, shared with `GroupFilterDropdown.tsx`.
//
// The row-building/visibility rules are pure (`ui/machine-filter.ts`); this component owns the
// interactive fold/search/category-shown state, all local — legacy's own `mfOpenCat`/
// `mfOpenGrp`/`mfShow` reset every time the dropdown is opened, never persisted.

import { useEffect, useReducer, useRef, useState } from 'react';
import type { MachineCategory } from '../../../../shared/types.ts';
import { CATEGORIES } from '../../core/machines.ts';
import { orderedMachines } from '../grid.ts';
import { buildMachineFilterRows, type MachineFilterRow } from '../machine-filter.ts';
import { useToolbarDropdown } from '../toolbar-dropdown.ts';
import { Icon } from './Icon.tsx';
import { store } from '../../store-instance.ts';

/** Persist the machine AND group filter selections. Faithful port of legacy `saveFilters` —
 *  shared by `GroupFilterDropdown.tsx` and three already-gated callers (AllBookingsModal's/
 *  AssistantResults's/MyBookingsModal's "only my machines" shortcuts). */
export function saveFilters(): void {
  localStorage.setItem('mb_machsel', JSON.stringify([...store.get('machSel')]));
  localStorage.setItem('mb_groupssel', JSON.stringify([...store.get('groupsSel')]));
}

/** Refresh the toolbar button's label/highlight from `S.machSel`. `#machBtn` is static
 *  markup, not React-rendered (it sits outside `#machDrop`) — mutated directly, matching
 *  legacy. Faithful port of legacy `updateMachBtn`. */
export function updateMachBtn(): void {
  const button = document.getElementById('machBtn');
  if (!button) return;
  const count = store.get('machSel').size;
  button.innerHTML =
    '<svg class="ic" aria-hidden="true"><use href="#i-search"/></svg> ' +
    (count ? `${count} gewählt ▾` : 'Filtern ▾');
  button.style.background = count ? 'var(--accent-light)' : '';
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
      className="seg fill"
      style={{ marginBottom: 4 }}
      role="group"
      aria-label="Kategorie in der Liste zeigen"
    >
      {CATEGORIES.map(({ id, label, icon }) => (
        <button
          key={id}
          className={shownCategories.has(id) ? 'on' : ''}
          aria-pressed={shownCategories.has(id)}
          onClick={() => onToggle(id)}
        >
          <Icon name={icon} /> {label}
        </button>
      ))}
    </div>
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
  onToggleMachine: (mid: string, isChecked: boolean) => void;
}) {
  if (row.kind === 'category') {
    return (
      <div className="grp cathead click" onClick={() => onToggleOpen(row.key)}>
        <span className="tarr">{row.open ? '▾' : '▸'}</span> {row.label}
      </div>
    );
  }
  if (row.kind === 'group') {
    return (
      <div className="grp grpsub click" onClick={() => onToggleOpen(row.key)}>
        <span className="tarr">{row.open ? '▾' : '▸'}</span> {row.label}
      </div>
    );
  }
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggleMachine(row.machine.id, event.target.checked)}
      />{' '}
      {row.machine.name}
    </label>
  );
}

/** The bump-and-persist actions checkbox changes/"Filter löschen" take on `S.machSel`. Split
 *  out from `MachineFilterDropdown` only to stay under the line budget. */
function useMachineSelectionActions(bumpTick: () => void) {
  function handleMachineToggle(mid: string, isChecked: boolean): void {
    if (isChecked) store.get('machSel').add(mid);
    else store.get('machSel').delete(mid);
    saveFilters();
    updateMachBtn();
    store.notify();
    bumpTick();
  }

  function handleClear(): void {
    store.get('machSel').clear();
    saveFilters();
    updateMachBtn();
    store.notify();
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
  onToggleMachine: (mid: string, isChecked: boolean) => void;
  onClear: () => void;
}) {
  return (
    <>
      <CategoryShownToggle
        shownCategories={state.shownCategories}
        onToggle={state.toggleShownCategory}
      />
      <input
        ref={state.searchInputRef}
        type="text"
        placeholder="Ressource suchen…"
        style={{ width: '100%', marginBottom: 6 }}
        autoComplete="off"
        value={state.searchQuery}
        onChange={(event) => state.setSearchQuery(event.target.value)}
      />
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 6,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span className="hint" style={{ margin: 0 }}>
          {store.get('machSel').size ? `${store.get('machSel').size} gewählt` : 'alle sichtbar'}
        </span>
        <button className="btn small clearbtn" onClick={onClear}>
          <Icon name="trash" /> Filter löschen
        </button>
      </div>
      <div className="mlist" style={{ maxHeight: 300 }}>
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
    </>
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
