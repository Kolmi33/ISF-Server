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
  // What: a brand-new machine (no existing data to edit) has no draft slots at all.
  // How: calls draftMaintSlots(null) and checks the result is an empty array.
  it('is empty for a new machine (null)', () => {
    expect(draftMaintSlots(null)).toEqual([]);
  });

  // What: an existing machine's slots are converted into edit-ready drafts where every field
  // is always a real string (never omitted), so the form inputs stay controlled.
  // How: gives a machine one slot missing `until`/`note` and checks the draft fills both in
  // as empty strings rather than leaving them undefined.
  it("normalizes an existing machine's slots, defaulting missing fields to empty strings", () => {
    const m = machine({ maint: [{ type: 'defekt', from: '2021-01-01' }] });
    expect(draftMaintSlots(m)).toEqual([
      { type: 'defekt', from: '2021-01-01', until: '', note: '' },
    ]);
  });

  // What: a slot type outside the two recognized values ('defekt'/'wartung') normalizes to
  // 'wartung' in the draft, so the form's type selector always has a valid option selected.
  // How: gives a machine a slot with an unrecognized type string and checks the draft's type.
  it('normalizes an unrecognized slot type to "wartung"', () => {
    const m = machine({ maint: [{ type: 'sonstiges' }] });
    expect(draftMaintSlots(m)[0]!.type).toBe('wartung');
  });
});

describe('initialMachineFormState', () => {
  // What: for a brand-new machine, the form starts empty except the group, which defaults to
  // the first existing machine's group (a reasonable starting point rather than blank).
  // How: builds the initial state for a null machine against a list of two machines and
  // checks the name/maint are empty, the group matches the first machine's, and every
  // weekday defaults to checked (available).
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

  // What: with no existing machines to default from, the group falls back to an empty string
  // rather than throwing.
  // How: calls with an empty machines list and checks the group is ''.
  it('defaults the group to empty when there are no machines at all', () => {
    expect(initialMachineFormState(null, []).group).toBe('');
  });

  // What: editing an existing machine populates every form field from its actual current values.
  // How: builds a machine with every editable field set (including a partial days mask) and
  // checks the resulting form state matches each one, with the mask correctly expanded into
  // per-weekday checkboxes.
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

  // What: a missing days field or a malformed (wrong-length) mask both default to every
  // weekday checked, same fallback the pure `isMachineAvailableOnWeekday` predicate uses.
  // How: checks a machine with `days: undefined` and one with a too-short mask both produce
  // an all-true dayChecked array.
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
  // What: a minimal valid form passes validation, and its text fields (name/info/redu) are
  // trimmed of surrounding whitespace in the produced MachineForm.
  // How: builds a valid state with padded whitespace on three text fields and checks the
  // result's form has each one trimmed, plus the rest of the shape.
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

  // What: a maintenance slot with an inverted date range (from after until) fails validation
  // with a specific German error message, rather than silently accepting nonsensical dates.
  // How: builds a slot with from > until and checks the exact error result.
  it('rejects a maintenance slot whose from is after its until', () => {
    const result = validateMachineForm(
      validState({
        maint: [{ type: 'wartung', from: '2021-02-01', until: '2021-01-01', note: '' }],
      }),
    );
    expect(result).toEqual({ error: 'Wartungs-Zeitraum ungültig (von liegt nach bis).' });
  });

  // What: a slot with one bound left blank (open-ended) is valid — the from>until check only
  // applies when BOTH bounds are actually set.
  // How: builds a slot with an empty `from` and checks validation succeeds (no error key).
  it('allows an open-ended slot (from or until blank)', () => {
    const result = validateMachineForm(
      validState({ maint: [{ type: 'defekt', from: '', until: '2021-01-01', note: '' }] }),
    );
    expect('error' in result).toBe(false);
  });

  // What: a blank (whitespace-only) name fails validation with the same combined
  // name/group error message.
  // How: builds a state with a whitespace-only name and checks the error.
  it('requires a non-empty name', () => {
    expect(validateMachineForm(validState({ name: '  ' }))).toEqual({
      error: 'Name und Bereich sind Pflicht.',
    });
  });

  // What: a group is required, but it can come from either the dropdown selection OR the
  // free-text "new group" field — only both being empty is an error.
  // How: checks both blank fails validation, and a blank group with a real newGroup value
  // succeeds using that new group name.
  it('requires a group — falls back to the free-text new-group field only when it is set', () => {
    expect(validateMachineForm(validState({ group: '', newGroup: '' }))).toEqual({
      error: 'Name und Bereich sind Pflicht.',
    });
    const withNewGroup = validateMachineForm(validState({ group: '', newGroup: ' Neue Halle ' }));
    expect(withNewGroup).toMatchObject({ form: { group: 'Neue Halle' } });
  });

  // What: when BOTH a selected group and a free-text new group are given, the free-text one wins.
  // How: sets both fields and checks the resulting form uses the free-text value.
  it('a free-text new group overrides a selected one', () => {
    const result = validateMachineForm(validState({ group: 'Halle 1', newGroup: 'Neue Halle' }));
    expect(result).toMatchObject({ form: { group: 'Neue Halle' } });
  });

  // What: a fully-checked weekday mask (every day available) is encoded as null on the wire,
  // not the literal '1111111' string — "no mask" already means "every day" (see machines.ts's
  // isMachineAvailableOnWeekday default), so storing an explicit all-on mask would be redundant.
  // How: checks all seven days checked encodes daysMask as null.
  it('encodes all-on as null (not the literal mask string)', () => {
    const result = validateMachineForm(
      validState({ dayChecked: [true, true, true, true, true, true, true] }),
    );
    expect(result).toMatchObject({ form: { daysMask: null } });
  });

  // What: a genuinely partial mask (some days off) IS encoded as its raw 7-character string.
  // How: checks a Mon-Fri-only mask encodes as the literal '1111100' string.
  it('encodes a partial mask as its raw string', () => {
    const result = validateMachineForm(
      validState({ dayChecked: [true, true, true, true, true, false, false] }),
    );
    expect(result).toMatchObject({ form: { daysMask: '1111100' } });
  });

  // What: a mask with every day unchecked fails validation — a machine must be bookable on
  // at least one weekday.
  // How: checks all seven days unchecked produces the specific "pick at least one weekday" error.
  it('rejects an all-off mask (no bookable weekday at all)', () => {
    const result = validateMachineForm(
      validState({ dayChecked: [false, false, false, false, false, false, false] }),
    );
    expect(result).toEqual({ error: 'Mindestens einen verfügbaren Wochentag wählen.' });
  });

  // What: an unrecognized maintenance slot type normalizes to 'wartung' during validation
  // (same fallback draftMaintSlots uses on the read side), and a blank note is omitted from
  // the output entirely rather than stored as an empty string.
  // How: builds a slot with an unrecognized type and a whitespace-only note, validates, and
  // checks the type normalized and the note key is absent from the result.
  it('normalizes an unrecognized maintenance type to "wartung" and omits a blank note', () => {
    const result = validateMachineForm(
      validState({ maint: [{ type: 'sonstiges', from: '', until: '', note: '  ' }] }),
    );
    expect(result).toMatchObject({ form: { maint: [{ type: 'wartung', from: '', until: '' }] } });
    expect((result as { form: { maint: unknown[] } }).form.maint[0]).not.toHaveProperty('note');
  });

  // What: a real (non-blank) note is kept, trimmed of surrounding whitespace.
  // How: builds a slot with a padded note and checks the result's note is trimmed.
  it('keeps a trimmed, non-blank note', () => {
    const result = validateMachineForm(
      validState({ maint: [{ type: 'defekt', from: '', until: '', note: '  Kalibrierung  ' }] }),
    );
    expect(result).toMatchObject({ form: { maint: [{ note: 'Kalibrierung' }] } });
  });

  // What: validateMachineForm stores `cat` verbatim (whatever value the dropdown gave) without
  // itself applying the "anything but messtechnik defaults to maschine" rule — that
  // normalization is `applyFormFieldsToMachine`'s job, not this validation step's.
  // How: validates a state with cat:'messtechnik' and checks it passes through unchanged.
  it('stores cat as given (messtechnik or otherwise) — applyFormFieldsToMachine handles the default', () => {
    expect(validateMachineForm(validState({ cat: 'messtechnik' }))).toMatchObject({
      form: { cat: 'messtechnik' },
    });
  });
});
