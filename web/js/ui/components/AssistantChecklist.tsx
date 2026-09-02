// The Assistant's device checklist (Phase 7 slice B7): search + the collapsible fav/category/
// group tree, its checkboxes toggling a device into/out of the work area immediately. Faithful
// port of legacy `machineChecklist`/`wireChecklistFilter` — row structure/visibility lives in
// `ui/assistant-checklist.ts` (`buildChecklistRows`), this is just the rendering. The "Aktuellen
// Filter übernehmen" button legacy's `wireChecklistFilter` wires conditionally is dead code in
// practice — the Assistant's own modal template never renders that button — so it's not ported.

import { useState } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { hasAnyMaintenanceSlot } from '../../core/machines-queries.ts';
import { maintenanceKind, statusRangeText } from '../machine-text.ts';
import { buildChecklistRows, type ChecklistRow } from '../assistant-checklist.ts';
import { Icon } from './Icon.tsx';

/** The maintenance/defect status tag, when the machine has one. */
function MachineStatusTag({ machine }: { machine: Machine }) {
  if (!hasAnyMaintenanceSlot(machine)) return null;
  const kind = maintenanceKind(machine);
  return (
    <span className={`tag ${kind || 'wartung'}`} title={statusRangeText(machine)}>
      {kind === 'defekt' ? 'defekt' : 'Wartung'}
    </span>
  );
}

interface ChecklistMachineRowProps {
  machine: Machine;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}

function ChecklistMachineRow({ machine, checked, onToggle }: ChecklistMachineRowProps) {
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
      />{' '}
      {machine.name}
      {machine.info && (
        <span
          className="machinfo"
          title={machine.info}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Icon name="info" />
        </span>
      )}{' '}
      <MachineStatusTag machine={machine} />
    </label>
  );
}

type HeaderRow = Extract<ChecklistRow, { kind: 'category' | 'group' }>;

function ChecklistHeaderRow({ row, onToggleOpen }: { row: HeaderRow; onToggleOpen: () => void }) {
  return (
    <div
      className={`grp ${row.kind === 'category' ? 'cathead' : 'grpsub'} click`}
      onClick={onToggleOpen}
    >
      <span className="tarr">{row.open ? '▾' : '▸'}</span> {row.label}
    </div>
  );
}

interface AssistantChecklistProps {
  /** Pre-ordered (favorites first, Maschinen before Messtechnik) — pass `orderedMachines()`. */
  machines: readonly Machine[];
  favoriteIds: ReadonlySet<string>;
  addedIds: ReadonlySet<string>;
  onToggle: (machineId: string, checked: boolean) => void;
}

export function AssistantChecklist({
  machines,
  favoriteIds,
  addedIds,
  onToggle,
}: AssistantChecklistProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set(['fav']));

  function toggleOpen(key: string): void {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const rows = buildChecklistRows(machines, { favoriteIds, searchQuery, openKeys });

  return (
    <>
      <input
        type="text"
        placeholder="filtern…"
        style={{ width: '100%', marginBottom: 4 }}
        autoComplete="off"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />
      <div className="mlist">
        {rows.map((row) =>
          row.kind === 'machine' ? (
            <ChecklistMachineRow
              key={row.machine.id}
              machine={row.machine}
              checked={addedIds.has(row.machine.id)}
              onToggle={(checked) => onToggle(row.machine.id, checked)}
            />
          ) : (
            <ChecklistHeaderRow key={row.key} row={row} onToggleOpen={() => toggleOpen(row.key)} />
          ),
        )}
      </div>
    </>
  );
}
