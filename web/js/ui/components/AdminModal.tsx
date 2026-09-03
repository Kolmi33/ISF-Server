// =======================================================================================
// ADMIN MODAL COMPONENT (web/js/ui/components/AdminModal.tsx)
// =======================================================================================
//
// The Admin ("Verwalten") modal: the machine list with search, sort, manual reordering,
// and links into the add/edit form and the change log.
//
// Key Principles:
// - A SAFE THREE-WAY IMPORT CYCLE: `AdminModal`, `MachineFormModal`, and `LogModal` each
//   import directly from the other two. Safe here because every use on all three sides is
//   inside an event handler, never at module top level — by the time any of these
//   functions actually runs (a later click), every module involved has already finished
//   evaluating, so the live ES-module bindings are all resolved.
//
// =======================================================================================

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { moveMachine } from '../../core/machines.ts';
import { hasAnyMaintenanceSlot, getMaintenanceSlots } from '../../core/machines.ts';
import { statusRangeText, daysMaskText, maintenanceKind } from '../machine-text.ts';
import { filterAdminMachines, type AdminSort } from '../views/admin.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { openLog } from './LogModal.tsx';
import { openMachineForm } from './MachineFormModal.tsx';
import { Icon } from './Icon.tsx';
import { store } from '../../store-instance.ts';
import { toast } from '../toast.ts';

const SORT_OPTIONS: ReadonlyArray<{ value: AdminSort; label: string }> = [
  { value: 'manual', label: 'Standard (manuell)' },
  { value: 'name', label: 'Alphabetisch (A–Z)' },
  { value: 'group', label: 'Nach Bereich' },
];

/** The maintenance/defect status tag, shown only when the machine actually has one. */
function StatusBadge({ machine }: { machine: Machine }) {
  if (!hasAnyMaintenanceSlot(machine)) return null;
  const kind = maintenanceKind(machine);
  const slotCount = getMaintenanceSlots(machine).length;
  return (
    <span className={`tag ${kind || 'wartung'}`} title={statusRangeText(machine)}>
      {kind === 'defekt' ? 'defekt' : 'Wartung'}
      {slotCount > 1 ? ` ×${slotCount}` : ''}
    </span>
  );
}

interface AdminRowProps {
  machine: Machine;
  manual: boolean;
  onEdit: (machineId: string) => void;
  onMove: (machineId: string, direction: -1 | 1) => void;
}

function AdminRow({ machine, manual, onEdit, onMove }: AdminRowProps) {
  return (
    <div className="admrow">
      <span className="nm" title={machine.name}>
        {machine.name}{' '}
        <span className="hint" style={{ margin: 0 }}>
          ({machine.group})
        </span>
        <StatusBadge machine={machine} />
        {machine.days && machine.days !== '1111111' && (
          <span className="hint" style={{ margin: 0 }} title="verfügbare Wochentage">
            · {daysMaskText(machine)}
          </span>
        )}
      </span>
      {manual && (
        <>
          <button className="btn small" title="nach oben" onClick={() => onMove(machine.id, -1)}>
            ↑
          </button>
          <button className="btn small" title="nach unten" onClick={() => onMove(machine.id, 1)}>
            ↓
          </button>
        </>
      )}
      <button className="btn small" onClick={() => onEdit(machine.id)}>
        Bearbeiten
      </button>
    </div>
  );
}

interface AdminControlsProps {
  search: string;
  onSearchChange: (value: string) => void;
  sort: AdminSort;
  onSortChange: (sort: AdminSort) => void;
  searchRef: RefObject<HTMLInputElement>;
}

/** The top controls: add/change-log buttons, then the search box + sort dropdown. Split out of
 *  `AdminModal` purely to stay under the function-length budget. */
function AdminControls({
  search,
  onSearchChange,
  sort,
  onSortChange,
  searchRef,
}: AdminControlsProps) {
  return (
    <>
      <div className="formrow">
        <button className="btn primary" onClick={() => openMachineForm(null)}>
          ＋ Maschine hinzufügen
        </button>
        <button className="btn" onClick={openLog}>
          <Icon name="doc" /> Änderungsprotokoll
        </button>
      </div>
      <div className="formrow">
        <input
          ref={searchRef}
          type="text"
          placeholder="Maschine suchen…"
          style={{ flex: 1 }}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <label style={{ minWidth: 'auto' }}>Sortieren</label>
        <select value={sort} onChange={(event) => onSortChange(event.target.value as AdminSort)}>
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

export function AdminModal() {
  const [sort, setSort] = useState<AdminSort>(
    () => (localStorage.getItem('mb_admsort') as AdminSort | null) || 'manual',
  );
  const [search, setSearch] = useState('');
  const [, forceRerender] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  function changeSort(nextSort: AdminSort): void {
    setSort(nextSort);
    localStorage.setItem('mb_admsort', nextSort);
  }

  async function move(machineId: string, direction: -1 | 1): Promise<void> {
    // moveMachine returns void (not a truthy result) on success — only {abort: true} is
    // truthy — so the re-render below must be unconditional except on that one abort case.
    const result = await window.mutate(
      (fresh) => moveMachine(fresh, machineId, direction),
      'Reihenfolge geändert',
    );
    if (result && result.abort) return;
    forceRerender((tick) => tick + 1);
  }

  const rows = filterAdminMachines(store.get('data')!.machines, sort, search);

  return (
    <>
      <h2>
        <Icon name="wrench" /> Verwalten
      </h2>
      <AdminControls
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={changeSort}
        searchRef={searchRef}
      />
      <div className="mlist" style={{ maxHeight: 380 }}>
        {rows.length ? (
          rows.map((machine) => (
            <AdminRow
              key={machine.id}
              machine={machine}
              manual={sort === 'manual'}
              onEdit={(machineId) => openMachineForm(machineId)}
              onMove={(machineId, direction) => void move(machineId, direction)}
            />
          ))
        ) : (
          <p className="hint">Keine Maschine gefunden.</p>
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

/** Opens Admin ("Verwalten"). Guarded even though the toolbar button this is normally wired
 *  to stays hidden until the initial load succeeds (making this unreachable in practice) —
 *  cheap defensive-in-depth against a future caller, or a test, that opens it before data
 *  has loaded; `AdminModal`'s own body unwraps `store.get('data')` with `!`. */
export function openAdmin(): void {
  if (!store.get('data')) {
    toast('Noch keine Daten geladen — bitte kurz warten.');
    return;
  }
  openReactModal(<AdminModal />);
}
