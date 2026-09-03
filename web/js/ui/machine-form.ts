// =======================================================================================
// MACHINE FORM MODULE (web/js/ui/machine-form.ts)
// =======================================================================================
//
// The machine form's state shape, defaults, and validation — pure over `core/machines`; no
// DOM. The form chrome (`ui/components/MachineFormModal.tsx` + its split-out
// `MachineFormFields.tsx`/`MaintenanceSlotEditor.tsx`) just renders this and calls
// `validateMachineForm` before mutating.
//
// Key Principles:
// - THIS MODULE ONLY PREPARES THE INPUT: the actual save/delete reducers (slug/id
//   generation, group insertion, field application) already live in `core/machines.ts`
//   (`saveMachine`/`deleteMachine`) — this module's job ends at producing a valid
//   `MachineForm` for them to consume.
//
// =======================================================================================

import type { Machine, MaintSlot } from '../../../shared/types.ts';
import type { MachineForm } from '../core/machines.ts';
import { getMachineCategory, getMaintenanceSlots } from '../core/machines.ts';
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
  return getMaintenanceSlots(machine).map((slot) => ({
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
 * Builds the form's starting state: an existing machine's fields, or — for a new machine —
 * the first machine's group as a reasonable default (a brand-new machine most likely
 * belongs with the ones already showing, rather than starting on an arbitrary empty group).
 */
export function initialMachineFormState(
  machine: Machine | null,
  machines: readonly Machine[],
): MachineFormState {
  const days = machine?.days;
  return {
    name: machine?.name ?? '',
    cat: getMachineCategory(machine),
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
 * Normalizes and validates the form state into a `MachineForm`, or returns the first
 * validation error.
 *
 * How it works, checked in this order: maintenance date ranges (each `from` must not be
 * after its own `until`), then name/group both being non-empty, then the weekday mask
 * having at least one available day. A day mask of all 1s normalizes to `null`
 * ("available every day", the same meaning, but without storing a redundant all-available
 * mask).
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
