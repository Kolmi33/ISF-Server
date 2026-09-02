// The machine form (Phase 7 slice B6): create/edit a resource, and delete. Faithful port of
// legacy `openMachineForm`. State shape, defaults and validation live in `ui/machine-form.ts`;
// the fields and the maintenance-slot list are split into `MachineFormFields.tsx`/
// `MaintenanceSlotEditor.tsx` — all purely to stay under the file-length/function-length
// budgets, and all one form conceptually. The actual save/delete reducers already live in
// `core/booking.ts` (`saveMachine`/`deleteMachine`, Phase 5.1).
//
// "Zurück" and a successful save/delete all route to `openAdmin()`, a direct import from
// `AdminModal.tsx` (B5) that closes a real three-way cycle with it and `LogModal.tsx` — see
// `AdminModal.tsx`'s header comment for why that's safe here.

import { useState } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { groupsByCategory } from '../../core/machines.ts';
import { saveMachine, deleteMachine } from '../../core/booking.ts';
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
  mid: string | null;
  state: MachineFormState;
}

/** Validate, then create/update the machine and return to Admin. Faithful port of legacy
 *  `mfSave`. `saveMachine` returns void (not a truthy result) on success — only
 *  `{abort: true}` is truthy — so the success path is unconditional except on that one case. */
async function saveMachineForm({ mid, state }: SaveMachineFormInput): Promise<void> {
  const validated = validateMachineForm(state);
  if ('error' in validated) {
    toast(validated.error);
    return;
  }
  const result = await window.mutate(
    (fresh) => saveMachine(fresh, mid, validated.form),
    mid
      ? `Maschine bearbeitet: ${validated.form.name}`
      : `Maschine angelegt: ${validated.form.name}`,
  );
  if (result && result.abort) return;
  fillGroupSel();
  openAdmin();
  toast('Gespeichert ✓');
}

/** Confirm, then delete the machine (and its bookings) and return to Admin. Faithful port of
 *  legacy `mfDel`. */
async function deleteMachineForm(mid: string, machine: Machine): Promise<void> {
  const confirmed = await window.askConfirm({
    title: 'Maschine löschen?',
    body: `<b>${escapeHtml(machine.name)}</b> (${escapeHtml(machine.group)}) wird entfernt — <b>inklusive aller zugehörigen Buchungen</b>. Das lässt sich nicht rückgängig machen.`,
    yes: 'Maschine löschen',
  });
  if (!confirmed) return;
  const result = await window.mutate(
    (fresh) => deleteMachine(fresh, mid),
    `Maschine gelöscht: ${machine.name}`,
  );
  if (result && result.abort) return;
  fillGroupSel();
  openAdmin();
  toast('Maschine gelöscht.');
}

interface MachineFormModalProps {
  mid: string | null;
}

export function MachineFormModal({ mid }: MachineFormModalProps) {
  const machines = store.get('data')!.machines;
  const machine = mid ? (machById(mid) ?? null) : null;
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
      <h2>{mid ? 'Ressource bearbeiten' : 'Neue Ressource'}</h2>
      <MachineFormFields
        state={state}
        onChange={patch}
        groupOptions={groupOptions}
        reduOptions={reduOptions}
      />
      <MaintenanceSlotEditor slots={state.maint} onChange={(maint) => patch({ maint })} />
      <div className="modal-actions">
        {mid && machine && (
          <>
            <button className="btn danger" onClick={() => void deleteMachineForm(mid, machine)}>
              Löschen
            </button>
            <span className="spacer" />
          </>
        )}
        <button className="btn" onClick={() => openAdmin()}>
          Zurück
        </button>
        <button className="btn primary" onClick={() => void saveMachineForm({ mid, state })}>
          Speichern
        </button>
      </div>
    </>
  );
}

/** Open the machine form: `mid` to edit that machine, `null` for a new one. Faithful port of
 *  legacy `openMachineForm`. */
export function openMachineForm(mid: string | null): void {
  openReactModal(<MachineFormModal mid={mid} />);
}
