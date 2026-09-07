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

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FileClock, Plus, Wrench } from 'lucide-react';
import type { RefObject } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { moveMachine } from '../../core/machines.ts';
import { hasAnyMaintenanceSlot, getMaintenanceSlots } from '../../core/machines.ts';
import { statusRangeText, daysMaskText, maintenanceKind } from '../machine-text.ts';
import { filterAdminMachines, type AdminSort } from '../views/admin.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { openLog } from './LogModal.tsx';
import { openMachineForm } from './MachineFormModal.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/app-button.tsx';
import { NativeSelect } from '../../components/ui/native-select.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { EmptyState } from './app/EmptyState.tsx';
import { FormField } from './app/FormField.tsx';
import { SearchField } from './app/SearchField.tsx';
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
    <Badge
      variant={kind === 'defekt' ? 'destructive' : 'brand'}
      className={`tag ${kind || 'wartung'}`}
      title={statusRangeText(machine)}
    >
      {kind === 'defekt' ? 'defekt' : 'Wartung'}
      {slotCount > 1 ? ` ×${slotCount}` : ''}
    </Badge>
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
    <div className="admrow flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors hover:bg-muted">
      <span className="nm min-w-0 flex-1" title={machine.name}>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{machine.name}</span>
          <span className="text-[11px] text-muted-foreground">({machine.group})</span>
          <StatusBadge machine={machine} />
          {machine.days && machine.days !== '1111111' && (
            <span className="text-[11px] text-muted-foreground" title="verfügbare Wochentage">
              · {daysMaskText(machine)}
            </span>
          )}
        </span>
      </span>
      {manual && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            title="nach oben"
            aria-label="nach oben"
            onClick={() => onMove(machine.id, -1)}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            title="nach unten"
            aria-label="nach unten"
            onClick={() => onMove(machine.id, 1)}
          >
            <ArrowDown className="size-4" />
          </Button>
        </>
      )}
      <Button variant="outline" size="sm" onClick={() => onEdit(machine.id)}>
        Bearbeiten
      </Button>
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
  const searchId = useId();
  const sortId = useId();
  return (
    <div className="flex shrink-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => openMachineForm(null)}>
          <Plus className="size-4" /> Maschine hinzufügen
        </Button>
        <Button variant="outline" onClick={openLog}>
          <FileClock className="size-4" /> Änderungsprotokoll
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <FormField label="Suchen" htmlFor={searchId}>
          <SearchField
            id={searchId}
            ref={searchRef}
            placeholder="Maschine suchen…"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </FormField>
        <FormField label="Sortieren" htmlFor={sortId}>
          <NativeSelect
            id={sortId}
            value={sort}
            onChange={(event) => onSortChange(event.target.value as AdminSort)}
          >
            {SORT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
    </div>
  );
}

/** The machine list, or its empty state. Split out of `AdminModal` purely to stay under the
 *  function-length budget. */
function AdminList({
  rows,
  manual,
  onMove,
}: {
  rows: readonly Machine[];
  manual: boolean;
  onMove: (machineId: string, direction: -1 | 1) => void;
}) {
  if (!rows.length) return <EmptyState>Keine Maschine gefunden.</EmptyState>;
  return (
    <ScrollArea className="mlist -mr-3 min-h-0 flex-1 pr-3">
      <div className="flex flex-col gap-0.5">
        {rows.map((machine) => (
          <AdminRow
            key={machine.id}
            machine={machine}
            manual={manual}
            onEdit={(machineId) => openMachineForm(machineId)}
            onMove={onMove}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

export function AdminModal() {
  const [sort, setSort] = useState<AdminSort>(
    () => (localStorage.getItem('mb_admsort') as AdminSort | null) || 'manual',
  );
  const [search, setSearch] = useState('');
  const [, forceRerender] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

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
  const onMove = (machineId: string, direction: -1 | 1) => void move(machineId, direction);

  return (
    <AppDialog size="lg" labelledBy={titleId}>
      <AppDialogHeader
        icon={<Wrench className="size-6" />}
        title="Verwalten"
        titleId={titleId}
        subtitle="Ressourcen anlegen, bearbeiten und ordnen"
      />
      <AppDialogBody className="max-h-[72vh]">
        <AdminControls
          search={search}
          onSearchChange={setSearch}
          sort={sort}
          onSortChange={changeSort}
          searchRef={searchRef}
        />
        <AdminList rows={rows} manual={sort === 'manual'} onMove={onMove} />
      </AppDialogBody>
      <AppDialogFooter>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {rows.length} Ressource{rows.length === 1 ? '' : 'n'}
        </span>
        <Button size="lg" className="ml-auto" onClick={closeReactModal}>
          Schließen
        </Button>
      </AppDialogFooter>
    </AppDialog>
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
