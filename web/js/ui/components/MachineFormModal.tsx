// =======================================================================================
// MACHINE FORM MODAL COMPONENT (web/js/ui/components/MachineFormModal.tsx)
// =======================================================================================
//
// The machine form: create/edit a resource, and delete.
//
// Key Principles:
// - RENDERING ONLY, LOGIC LIVES ELSEWHERE: state shape, defaults and validation live in
//   `ui/machine-form.ts`; the actual save/delete reducers live in `core/machines.ts`
//   (`saveMachine`/`deleteMachine`). The fields and the maintenance-slot list are further
//   split into `MachineFormFields.tsx`/`MaintenanceSlotEditor.tsx`, purely to stay under
//   the file-length/function-length budgets — all one form conceptually.
// - A SAFE IMPORT CYCLE: "Zurück" and a successful save/delete all route to `openAdmin()`,
//   a direct import from `AdminModal.tsx` that closes a real three-way cycle with it and
//   `LogModal.tsx` — see `AdminModal.tsx`'s header comment for why that's safe.
//
// =======================================================================================

import { useState } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { groupsByCategory } from '../../core/machines.ts';
import { saveMachine, deleteMachine } from '../../core/machines.ts';
import {
  initialMachineFormState,
  validateMachineForm,
  type MachineFormState,
} from '../machine-form.ts';
import { escapeHtml } from '../escape-html.ts';
import { toast } from '../toast.ts';
import { openReactModal } from '../modal.tsx';
import { MachineFormFields } from './MachineFormFields.tsx';
import { MaintenanceSlotEditor } from './MaintenanceSlotEditor.tsx';
import { store } from '../../store-instance.ts';
import { machById } from '../machine-lookup.ts';
import { fillGroupSel } from './GroupFilterDropdown.tsx';
import { openAdmin } from './AdminModal.tsx';

interface SaveMachineFormInput {
  machineId: string | null;
  state: MachineFormState;
}

/** Validates, then creates/updates the machine and returns to Admin. `saveMachine` returns
 *  void (not a truthy result) on success — only `{abort: true}` is truthy — so the success
 *  path below is unconditional except on that one case. */
async function saveMachineForm({ machineId, state }: SaveMachineFormInput): Promise<void> {
  const validated = validateMachineForm(state);
  if ('error' in validated) {
    toast(validated.error);
    return;
  }
  const result = await window.mutate(
    (fresh) => saveMachine(fresh, machineId, validated.form),
    machineId
      ? `Maschine bearbeitet: ${validated.form.name}`
      : `Maschine angelegt: ${validated.form.name}`,
  );
  if (result && result.abort) return;
  fillGroupSel();
  openAdmin();
  toast('Gespeichert ✓');
}

/** Confirms, then deletes the machine (and its bookings) and returns to Admin. */
async function deleteMachineForm(machineId: string, machine: Machine): Promise<void> {
  const confirmed = await window.askConfirm({
    title: 'Maschine löschen?',
    body: `<b>${escapeHtml(machine.name)}</b> (${escapeHtml(machine.group)}) wird entfernt — <b>inklusive aller zugehörigen Buchungen</b>. Das lässt sich nicht rückgängig machen.`,
    yes: 'Maschine löschen',
  });
  if (!confirmed) return;
  const result = await window.mutate(
    (fresh) => deleteMachine(fresh, machineId),
    `Maschine gelöscht: ${machine.name}`,
  );
  if (result && result.abort) return;
  fillGroupSel();
  openAdmin();
  toast('Maschine gelöscht.');
}

interface MachineFormModalProps {
  machineId: string | null;
}

export function MachineFormModal({ machineId }: MachineFormModalProps) {
  const machines = store.get('data')!.machines;
  const machine = machineId ? (machById(machineId) ?? null) : null;
  const [state, setState] = useState<MachineFormState>(() =>
    initialMachineFormState(machine, machines),
  );

  const groupOptions = groupsByCategory(machines);
  const reduOptions = [
    ...new Set(machines.map((m) => m.redu).filter((redu): redu is string => !!redu)),
  ].sort();

  function patch(next: Partial<MachineFormState>): void {
    setState((prev) => ({ ...prev, ...next }));
  }

  return (
    <>
      <h2>{machineId ? 'Ressource bearbeiten' : 'Neue Ressource'}</h2>
      <MachineFormFields
        state={state}
        onChange={patch}
        groupOptions={groupOptions}
        reduOptions={reduOptions}
      />
      <MaintenanceSlotEditor slots={state.maint} onChange={(maint) => patch({ maint })} />
      <div className="modal-actions">
        {machineId && machine && (
          <>
            <button
              className="btn danger"
              onClick={() => void deleteMachineForm(machineId, machine)}
            >
              Löschen
            </button>
            <span className="spacer" />
          </>
        )}
        <button className="btn" onClick={() => openAdmin()}>
          Zurück
        </button>
        <button className="btn primary" onClick={() => void saveMachineForm({ machineId, state })}>
          Speichern
        </button>
      </div>
    </>
  );
}

/** Opens the machine form: `machineId` to edit that machine, `null` for a new one. */
export function openMachineForm(machineId: string | null): void {
  openReactModal(<MachineFormModal machineId={machineId} />);
}
