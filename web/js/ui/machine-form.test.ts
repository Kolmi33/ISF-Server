import { describe, it, expect } from 'vitest';
import type { Machine } from '../../../shared/types.ts';
import {
  draftMaintSlots,
  initialMachineFormState,
  validateMachineForm,
  type MachineFormState,
} from './machine-form.ts';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'M1', group: 'Halle 1', ...overrides };
}

const validState = (overrides: Partial<MachineFormState> = {}): MachineFormState => ({
  name: 'Fräse',
  cat: 'maschine',
  group: 'Halle 1',
  newGroup: '',
  info: '',
  redu: '',
  dayChecked: [true, true, true, true, true, true, true],
  maint: [],
  ...overrides,
});

describe('draftMaintSlots', () => {
  it('is empty for a new machine (null)', () => {
    expect(draftMaintSlots(null)).toEqual([]);
  });

  it("normalizes an existing machine's slots, defaulting missing fields to empty strings", () => {
    const m = machine({ maint: [{ type: 'defekt', from: '2021-01-01' }] });
    expect(draftMaintSlots(m)).toEqual([
      { type: 'defekt', from: '2021-01-01', until: '', note: '' },
    ]);
  });

  it('normalizes an unrecognized slot type to "wartung"', () => {
    const m = machine({ maint: [{ type: 'sonstiges' }] });
    expect(draftMaintSlots(m)[0]!.type).toBe('wartung');
  });
});

describe('initialMachineFormState', () => {
  it("is empty, defaulting the group to the first machine's group, for a new machine", () => {
    const machines = [
      machine({ id: 'm1', group: 'Halle 1' }),
      machine({ id: 'm2', group: 'Labor' }),
    ];
    const state = initialMachineFormState(null, machines);
    expect(state.name).toBe('');
    expect(state.group).toBe('Halle 1');
    expect(state.cat).toBe('maschine');
    expect(state.dayChecked).toEqual([true, true, true, true, true, true, true]);
    expect(state.maint).toEqual([]);
  });

  it('defaults the group to empty when there are no machines at all', () => {
    expect(initialMachineFormState(null, []).group).toBe('');
  });

  it('populates every field from an existing machine', () => {
    const m = machine({
      name: 'Presse',
      group: 'Labor',
      cat: 'messtechnik',
      info: 'Ansprechpartner: X',
      redu: 'Rauheitsmessgerät',
      days: '1111100', // Sa/So off
    });
    const state = initialMachineFormState(m, [m]);
    expect(state.name).toBe('Presse');
    expect(state.cat).toBe('messtechnik');
    expect(state.group).toBe('Labor');
    expect(state.info).toBe('Ansprechpartner: X');
    expect(state.redu).toBe('Rauheitsmessgerät');
    expect(state.dayChecked).toEqual([true, true, true, true, true, false, false]);
  });

  it('treats an absent/wrong-length days mask as every day available', () => {
    expect(initialMachineFormState(machine({ days: undefined }), []).dayChecked).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(initialMachineFormState(machine({ days: '111' }), []).dayChecked).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('validateMachineForm', () => {
  it('accepts a minimal valid form, trimming text fields', () => {
    const result = validateMachineForm(validState({ name: '  Fräse  ', info: ' i ', redu: ' r ' }));
    expect(result).toEqual({
      form: {
        name: 'Fräse',
        group: 'Halle 1',
        cat: 'maschine',
        info: 'i',
        redu: 'r',
        daysMask: null,
        maint: [],
      },
    });
  });

  it('rejects a maintenance slot whose from is after its until', () => {
    const result = validateMachineForm(
      validState({
        maint: [{ type: 'wartung', from: '2021-02-01', until: '2021-01-01', note: '' }],
      }),
    );
    expect(result).toEqual({ error: 'Wartungs-Zeitraum ungültig (von liegt nach bis).' });
  });

  it('allows an open-ended slot (from or until blank)', () => {
    const result = validateMachineForm(
      validState({ maint: [{ type: 'defekt', from: '', until: '2021-01-01', note: '' }] }),
    );
    expect('error' in result).toBe(false);
  });

  it('requires a non-empty name', () => {
    expect(validateMachineForm(validState({ name: '  ' }))).toEqual({
      error: 'Name und Bereich sind Pflicht.',
    });
  });

  it('requires a group — falls back to the free-text new-group field only when it is set', () => {
    expect(validateMachineForm(validState({ group: '', newGroup: '' }))).toEqual({
      error: 'Name und Bereich sind Pflicht.',
    });
    const withNewGroup = validateMachineForm(validState({ group: '', newGroup: ' Neue Halle ' }));
    expect(withNewGroup).toMatchObject({ form: { group: 'Neue Halle' } });
  });

  it('a free-text new group overrides a selected one', () => {
    const result = validateMachineForm(validState({ group: 'Halle 1', newGroup: 'Neue Halle' }));
    expect(result).toMatchObject({ form: { group: 'Neue Halle' } });
  });

  it('encodes all-on as null (not the literal mask string)', () => {
    const result = validateMachineForm(
      validState({ dayChecked: [true, true, true, true, true, true, true] }),
    );
    expect(result).toMatchObject({ form: { daysMask: null } });
  });

  it('encodes a partial mask as its raw string', () => {
    const result = validateMachineForm(
      validState({ dayChecked: [true, true, true, true, true, false, false] }),
    );
    expect(result).toMatchObject({ form: { daysMask: '1111100' } });
  });

  it('rejects an all-off mask (no bookable weekday at all)', () => {
    const result = validateMachineForm(
      validState({ dayChecked: [false, false, false, false, false, false, false] }),
    );
    expect(result).toEqual({ error: 'Mindestens einen verfügbaren Wochentag wählen.' });
  });

  it('normalizes an unrecognized maintenance type to "wartung" and omits a blank note', () => {
    const result = validateMachineForm(
      validState({ maint: [{ type: 'sonstiges', from: '', until: '', note: '  ' }] }),
    );
    expect(result).toMatchObject({ form: { maint: [{ type: 'wartung', from: '', until: '' }] } });
    expect((result as { form: { maint: unknown[] } }).form.maint[0]).not.toHaveProperty('note');
  });

  it('keeps a trimmed, non-blank note', () => {
    const result = validateMachineForm(
      validState({ maint: [{ type: 'defekt', from: '', until: '', note: '  Kalibrierung  ' }] }),
    );
    expect(result).toMatchObject({ form: { maint: [{ note: 'Kalibrierung' }] } });
  });

  it('stores cat as given (messtechnik or otherwise) — applyFormFieldsToMachine handles the default', () => {
    expect(validateMachineForm(validState({ cat: 'messtechnik' }))).toMatchObject({
      form: { cat: 'messtechnik' },
    });
  });
});
