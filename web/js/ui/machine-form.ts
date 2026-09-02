// The machine form's state shape, defaults, and validation (Phase 7 slice B6) — pure over
// `core/machines`; no DOM. The form chrome (`ui/components/MachineFormModal.tsx` + its split-
// out `MachineFormFields.tsx`/`MaintenanceSlotEditor.tsx`) just renders this and calls
// `validateMachineForm` before mutating. The actual save/delete reducers (slug/id generation,
// group insertion, field application) already live in `core/machines.ts` (`saveMachine`/
// `deleteMachine`, Phase 5.1) — this module only prepares their `MachineForm` input.

import type { Machine, MaintSlot } from '../../../shared/types.ts';
import type { MachineForm } from '../core/machines.ts';
import { categoryOf, maintenanceSlots } from '../core/machines.ts';
import { WEEKDAY_SHORT_LABELS } from './machine-text.ts';

/** One maintenance slot as edited (before trim/validate) — `MaintSlot` with `note` always a
 *  string (never omitted) so the input stays controlled. */
export interface MaintSlotDraft {
  type: string;
  from: string;
  until: string;
  note: string;
}

/** A machine's maintenance slots as edit-ready drafts; empty for a new machine. */
export function draftMaintSlots(machine: Machine | null): MaintSlotDraft[] {
  if (!machine) return [];
  return maintenanceSlots(machine).map((slot) => ({
    type: slot.type === 'defekt' ? 'defekt' : 'wartung',
    from: slot.from || '',
    until: slot.until || '',
    note: slot.note || '',
  }));
}

export interface MachineFormState {
  name: string;
  cat: string;
  group: string;
  newGroup: string;
  info: string;
  redu: string;
  /** Mo..So, matching `WEEKDAY_SHORT_LABELS`'s order. */
  dayChecked: boolean[];
  maint: MaintSlotDraft[];
}

/**
 * The form's starting state: an existing machine's fields, or — for a new one — legacy's own
 * default group, `groupList()[0]`. A `Set` built by mapping machines to their `group` always
 * inserts the first machine's group first, so that default is simply `machines[0].group`.
 */
export function initialMachineFormState(
  machine: Machine | null,
  machines: readonly Machine[],
): MachineFormState {
  const days = machine?.days;
  return {
    name: machine?.name ?? '',
    cat: categoryOf(machine),
    group: machine?.group ?? machines[0]?.group ?? '',
    newGroup: '',
    info: machine?.info || '',
    redu: machine?.redu || '',
    dayChecked: WEEKDAY_SHORT_LABELS.map(
      (_, i) => !days || days.length !== 7 || days.charAt(i) !== '0',
    ),
    maint: draftMaintSlots(machine),
  };
}

export type ValidatedMachineForm = { form: MachineForm } | { error: string };

/**
 * Normalize and validate the form state into a `MachineForm`, or the first validation error, in
 * legacy's own check order: maintenance ranges, then name/group, then the day mask. Faithful
 * port of the validation in legacy `mfSave`.
 */
export function validateMachineForm(state: MachineFormState): ValidatedMachineForm {
  const maint: MaintSlot[] = state.maint.map((slot) => ({
    type: slot.type === 'defekt' ? 'defekt' : 'wartung',
    from: slot.from.trim(),
    until: slot.until.trim(),
    ...(slot.note.trim() ? { note: slot.note.trim() } : {}),
  }));
  for (const slot of maint) {
    if (slot.from && slot.until && slot.from > slot.until) {
      return { error: 'Wartungs-Zeitraum ungültig (von liegt nach bis).' };
    }
  }
  const name = state.name.trim();
  const group = (state.newGroup.trim() || state.group).trim();
  if (!name || !group) return { error: 'Name und Bereich sind Pflicht.' };
  const daysMaskRaw = state.dayChecked.map((checked) => (checked ? '1' : '0')).join('');
  const daysMask = daysMaskRaw === '1111111' ? null : daysMaskRaw;
  if (daysMask && !daysMask.includes('1')) {
    return { error: 'Mindestens einen verfügbaren Wochentag wählen.' };
  }
  return {
    form: {
      name,
      group,
      cat: state.cat,
      info: state.info.trim(),
      redu: state.redu.trim(),
      daysMask,
      maint,
    },
  };
}
