// The machine form's static fields (Phase 7 slice B6) — everything except the dynamic
// maintenance-slot list (`MaintenanceSlotEditor.tsx`). Split out of `MachineFormModal.tsx`
// purely to stay under the file-length/function-length budgets; part of the same form
// conceptually.

import type { ChangeEvent } from 'react';
import { CATEGORIES, groupsByCategory } from '../../core/machines.ts';
import type { MachineFormState } from '../machine-form.ts';
import { WEEKDAY_SHORT_LABELS } from '../machine-text.ts';
import { GroupOptions } from './GroupOptions.tsx';

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
  const onInput = (key: keyof MachineFormState) => onFieldInput(state, onChange, key);
  return (
    <>
      <div className="formrow">
        <label>Name</label>
        <input type="text" value={state.name} onChange={onInput('name')} />
      </div>
      <div className="formrow">
        <label>Kategorie</label>
        <select value={state.cat} onChange={onInput('cat')}>
          {CATEGORIES.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="formrow">
        <label>Bereich</label>
        <select value={state.group} onChange={onInput('group')}>
          <GroupOptions groupOptions={groupOptions} />
        </select>
        <input
          type="text"
          placeholder="…oder neuen Bereich eingeben"
          style={{ flex: 1 }}
          value={state.newGroup}
          onChange={onInput('newGroup')}
        />
      </div>
      <div className="formrow">
        <label>Info</label>
        <input
          type="text"
          value={state.info}
          onChange={onInput('info')}
          placeholder="z. B. Ansprechpartner, Hinweise"
        />
      </div>
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

/** Redundanzgruppe (+ its datalist) and the Verfügbare-Tage weekday checkboxes. */
function MachineAvailabilityFields({ state, onChange, reduOptions }: AvailabilityFieldsProps) {
  return (
    <>
      <div className="formrow">
        <label>Redundanzgruppe</label>
        <input
          type="text"
          value={state.redu}
          onChange={onFieldInput(state, onChange, 'redu')}
          placeholder='z. B. „Rauheitsmessgerät" – gleichwertige Geräte, gleicher Name'
          style={{ flex: 1 }}
          list="mfReduList"
        />
        <datalist id="mfReduList">
          {reduOptions.map((redundancyGroup) => (
            <option key={redundancyGroup} value={redundancyGroup} />
          ))}
        </datalist>
      </div>
      <div className="formrow">
        <label>Verfügbare Tage</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, flex: 1 }}>
          {WEEKDAY_SHORT_LABELS.map((weekday, i) => (
            <label
              key={weekday}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontWeight: 400,
                minWidth: 'auto',
              }}
            >
              <input
                type="checkbox"
                checked={state.dayChecked[i]}
                onChange={() => onChange({ dayChecked: toggleDay(state.dayChecked, i) })}
              />{' '}
              {weekday}
            </label>
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
