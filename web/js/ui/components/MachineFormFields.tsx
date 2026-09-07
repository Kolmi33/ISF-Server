// =======================================================================================
// MACHINE FORM FIELDS COMPONENT (web/js/ui/components/MachineFormFields.tsx)
// =======================================================================================
//
// The machine form's static fields — everything except the dynamic maintenance-slot list
// (`MaintenanceSlotEditor.tsx`). Split out of `MachineFormModal.tsx` purely to stay under
// the file-length/function-length budgets — part of the same form conceptually.
//
// =======================================================================================

import { useId, type ChangeEvent } from 'react';
import { CATEGORIES, groupsByCategory } from '../../core/machines.ts';
import type { MachineFormState } from '../machine-form.ts';
import { WEEKDAY_SHORT_LABELS } from '../machine-text.ts';
import { GroupOptions } from './GroupOptions.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Input } from '../../components/ui/input.tsx';
import { NativeSelect } from '../../components/ui/native-select.tsx';
import { FormField } from './app/FormField.tsx';
import { FieldLabel } from './app/FormField.tsx';

function onFieldInput(
  state: MachineFormState,
  onChange: (patch: Partial<MachineFormState>) => void,
  key: keyof MachineFormState,
) {
  return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ [key]: event.target.value });
}

interface IdentityFieldsProps {
  state: MachineFormState;
  onChange: (patch: Partial<MachineFormState>) => void;
  groupOptions: ReturnType<typeof groupsByCategory>;
}

/** Name, Kategorie, Bereich (+ free-text new group), Info. */
function MachineIdentityFields({ state, onChange, groupOptions }: IdentityFieldsProps) {
  const ids = { name: useId(), cat: useId(), group: useId(), info: useId() };
  const onInput = (key: keyof MachineFormState) => onFieldInput(state, onChange, key);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Name" htmlFor={ids.name}>
          <Input
            id={ids.name}
            type="text"
            className="h-10 rounded-lg"
            value={state.name}
            onChange={onInput('name')}
          />
        </FormField>
        <FormField label="Kategorie" htmlFor={ids.cat}>
          <NativeSelect id={ids.cat} value={state.cat} onChange={onInput('cat')}>
            {CATEGORIES.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      <FormField
        label="Bereich"
        htmlFor={ids.group}
        hint="Einen bestehenden Bereich wählen oder rechts einen neuen eintragen."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NativeSelect id={ids.group} value={state.group} onChange={onInput('group')}>
            <GroupOptions groupOptions={groupOptions} />
          </NativeSelect>
          <Input
            type="text"
            className="h-10 rounded-lg"
            placeholder="…oder neuen Bereich eingeben"
            aria-label="Neuen Bereich eingeben"
            value={state.newGroup}
            onChange={onInput('newGroup')}
          />
        </div>
      </FormField>
      <FormField label="Info" htmlFor={ids.info}>
        <Input
          id={ids.info}
          type="text"
          className="h-10 rounded-lg"
          value={state.info}
          onChange={onInput('info')}
          placeholder="z. B. Ansprechpartner, Hinweise"
        />
      </FormField>
    </>
  );
}

interface AvailabilityFieldsProps {
  state: MachineFormState;
  onChange: (patch: Partial<MachineFormState>) => void;
  reduOptions: readonly string[];
}

function toggleDay(dayChecked: readonly boolean[], index: number): boolean[] {
  return dayChecked.map((checked, i) => (i === index ? !checked : checked));
}

/** One weekday checkbox in the Verfügbare-Tage row. */
function WeekdayToggle({
  weekday,
  checked,
  onToggle,
}: {
  weekday: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer select-none items-center gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-sm transition-colors hover:bg-muted has-[[data-checked]]:border-primary/45 has-[[data-checked]]:bg-primary/[0.08]"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      {weekday}
    </label>
  );
}

/** Redundanzgruppe (+ its datalist) and the Verfügbare-Tage weekday checkboxes. */
function MachineAvailabilityFields({ state, onChange, reduOptions }: AvailabilityFieldsProps) {
  const reduId = useId();
  return (
    <>
      <FormField
        label="Redundanzgruppe"
        htmlFor={reduId}
        hint="Gleichwertige Geräte bekommen denselben Namen."
      >
        <Input
          id={reduId}
          type="text"
          className="h-10 rounded-lg"
          value={state.redu}
          onChange={onFieldInput(state, onChange, 'redu')}
          placeholder='z. B. „Rauheitsmessgerät" – gleichwertige Geräte, gleicher Name'
          list="mfReduList"
        />
        <datalist id="mfReduList">
          {reduOptions.map((redundancyGroup) => (
            <option key={redundancyGroup} value={redundancyGroup} />
          ))}
        </datalist>
      </FormField>
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel>Verfügbare Tage</FieldLabel>
        <div className="flex flex-wrap gap-1">
          {WEEKDAY_SHORT_LABELS.map((weekday, i) => (
            <WeekdayToggle
              key={weekday}
              weekday={weekday}
              checked={state.dayChecked[i]!}
              onToggle={() => onChange({ dayChecked: toggleDay(state.dayChecked, i) })}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export interface MachineFormFieldsProps {
  state: MachineFormState;
  onChange: (patch: Partial<MachineFormState>) => void;
  groupOptions: ReturnType<typeof groupsByCategory>;
  reduOptions: readonly string[];
}

/** Every static field: Name/Kategorie/Bereich/Info/Redundanzgruppe/Verfügbare Tage. */
export function MachineFormFields({
  state,
  onChange,
  groupOptions,
  reduOptions,
}: MachineFormFieldsProps) {
  return (
    <>
      <MachineIdentityFields state={state} onChange={onChange} groupOptions={groupOptions} />
      <MachineAvailabilityFields state={state} onChange={onChange} reduOptions={reduOptions} />
    </>
  );
}
