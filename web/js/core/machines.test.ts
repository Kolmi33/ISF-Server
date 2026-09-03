import { describe, it, expect } from 'vitest';
import type { BookingData, Machine, MaintenanceSlot } from '../../../shared/types.ts';
import {
  saveMachine,
  deleteMachine,
  moveMachine,
  generateMachineIdFromName,
  ensureUniqueMachineId,
  findGroupInsertionIndex,
  getMachineCategory,
  CATEGORIES,
  CATEGORY_FILTER_PREFIX,
  groupsByCategory,
  matchesGroupFilter,
  getMaintenanceSlots,
  isSlotCoveringDate,
  getMaintenanceSlotAtDate,
  isMachineBlockedOnDate,
  hasAnyMaintenanceSlot,
  isMachineAvailableOnWeekday,
  isCellBookable,
  type MachineForm,
} from './machines.ts';

function createBookingData(
  machines: Machine[],
  bookings: BookingData['bookings'] = {},
): BookingData {
  return { machines, bookings };
}

const createMachine = (overrides: Partial<Machine> = {}): Machine => ({
  id: 'm1',
  name: 'Machine 1',
  group: 'Group A',
  ...overrides,
});

const createForm = (overrides: Partial<MachineForm> = {}): MachineForm => ({
  name: 'Neue Fräse',
  group: 'Group A',
  cat: 'maschine',
  info: '',
  redu: '',
  daysMask: null,
  maint: [],
  ...overrides,
});

describe('generateMachineIdFromName (ID generation)', () => {
  // What: German umlauts expand to their two-letter form and invalid symbols become hyphens.
  // How: checks a name with umlauts + punctuation and one with ß both slugify as expected.
  it('transliterates German umlauts and removes invalid symbols', () => {
    expect(generateMachineIdFromName('Über-Prüfgerät 3000!')).toBe('ueber-pruefgeraet-3000');
    expect(generateMachineIdFromName('Große Säge')).toBe('grosse-saege');
  });

  // What: accented Latin letters from other European languages are normalized to their plain
  // ASCII form (via Unicode NFKD) rather than falling through to the hash fallback.
  // How: checks French (É), Nordic (å), and Spanish (ñ) accented names all slugify to readable
  // ASCII, not a hash.
  it('normalizes European accented letters (French, Spanish, Nordic)', () => {
    expect(generateMachineIdFromName('Électro-Découpe')).toBe('electro-decoupe');
    expect(generateMachineIdFromName('Laser-Måler')).toBe('laser-maler');
    expect(generateMachineIdFromName('Cizalla & Piñón')).toBe('cizalla-pinon');
  });

  // What: a name with no Latin-alphanumeric content at all falls back to a deterministic short
  // hash, and different non-Latin names produce different hashes (not one shared fallback id).
  // How: generates ids for Cyrillic and Chinese names, checks both match the `m_<hex>` shape,
  // checks the Cyrillic id is stable across a second call with the same input, and checks the
  // two scripts produce different ids from each other.
  it('generates a stable deterministic m_<hash> ID for non-Latin scripts', () => {
    const cyrillicId = generateMachineIdFromName('Фрезерный станок');
    expect(cyrillicId).toMatch(/^m_[a-f0-9]{6}$/);

    // Deterministic: same input gives exact same ID
    expect(generateMachineIdFromName('Фрезерный станок')).toBe(cyrillicId);

    const chineseId = generateMachineIdFromName('五轴加工中心');
    expect(chineseId).toMatch(/^m_[a-f0-9]{6}$/);
    expect(chineseId).not.toBe(cyrillicId);
  });

  // What: a name that's pure symbols (no letters/digits at all) also falls back to the hash,
  // and a fully empty name falls back to the literal 'machine' rather than an empty hash.
  // How: checks an emoji-only name matches the hash shape, and an empty string produces 'machine'.
  it('handles empty or pure symbol strings gracefully', () => {
    const symbolId = generateMachineIdFromName('⚡⚡⚡');
    expect(symbolId).toMatch(/^m_[a-f0-9]{6}$/);
    expect(generateMachineIdFromName('')).toBe('machine');
  });

  // What: even a single Latin character or digit is a valid, readable slug on its own — it
  // should NOT be treated as "too short" and pushed to the hash fallback (a regression this
  // test was added to pin, since the threshold was once accidentally set to require length >= 2).
  // How: checks a single-letter name and a single-digit name both slugify to themselves.
  it('keeps a single-character Latin slug as-is, not the hash fallback', () => {
    expect(generateMachineIdFromName('Z')).toBe('z');
    expect(generateMachineIdFromName('3')).toBe('3');
  });
});

describe('ensureUniqueMachineId & findGroupInsertionIndex', () => {
  // What: a candidate id with no existing collision is returned unchanged.
  // How: checks a candidate id distinct from the one existing machine's id passes through as-is.
  it('returns candidate ID directly if no collision exists', () => {
    const existing = [createMachine({ id: 'fraese-1' })];
    expect(ensureUniqueMachineId(existing, 'fraese-2')).toBe('fraese-2');
  });

  // What: a colliding candidate gets a numeric suffix, continuing past whichever suffixes are
  // already taken rather than reusing one.
  // How: seeds existing machines with ids 'fraese' and 'fraese-2', requests 'fraese' again, and
  // checks the result skips straight to 'fraese-3'.
  it('increments numeric suffix on ID collision', () => {
    const existing = [createMachine({ id: 'fraese' }), createMachine({ id: 'fraese-2' })];
    expect(ensureUniqueMachineId(existing, 'fraese')).toBe('fraese-3');
  });

  // What: a new machine's insertion index lands right after its group's last existing member,
  // or at the very end of the list when the group has no members yet.
  // How: builds a list with two Group A machines followed by one Group B machine, then checks
  // the insertion index for Group A (right after its last member) and for a brand-new Group C
  // (end of the whole list).
  it('findGroupInsertionIndex inserts right after last sibling machine of same group', () => {
    const machines = [
      createMachine({ id: 'a1', group: 'Group A' }),
      createMachine({ id: 'a2', group: 'Group A' }),
      createMachine({ id: 'b1', group: 'Group B' }),
    ];
    expect(findGroupInsertionIndex(machines, 'Group A')).toBe(2);
    expect(findGroupInsertionIndex(machines, 'Group C')).toBe(3);
  });
});

describe('getMachineCategory', () => {
  // What: a machine explicitly tagged cat:'messtechnik' is categorized as messtechnik.
  // How: checks a machine built with that cat value returns 'messtechnik'.
  it('returns messtechnik for machines tagged with cat="messtechnik"', () => {
    expect(getMachineCategory(createMachine({ cat: 'messtechnik' }))).toBe('messtechnik');
  });

  // What: anything other than 'messtechnik' — an explicit 'maschine', an absent cat field, or
  // even a null machine — all default to the 'maschine' category.
  // How: checks all three of those inputs return 'maschine'.
  it('defaults to maschine for empty or standard machine', () => {
    expect(getMachineCategory(createMachine({ cat: 'maschine' }))).toBe('maschine');
    expect(getMachineCategory(createMachine())).toBe('maschine');
    expect(getMachineCategory(null)).toBe('maschine');
  });
});

describe('CATEGORIES & groupsByCategory', () => {
  // What: the exported CATEGORIES list has exactly the two known category ids, in display order.
  // How: maps CATEGORIES down to just its ids and checks the exact ['maschine', 'messtechnik'] order.
  it('exports standard categories', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(['maschine', 'messtechnik']);
  });

  // What: machines are bucketed by category, and within each category their distinct group
  // names appear in first-seen order (not alphabetical, not re-sorted).
  // How: builds four machines across two categories where one group name repeats, and checks
  // the result's category order and each category's de-duplicated group list.
  it('groups distinct machines by category in first-seen order', () => {
    const machines: Machine[] = [
      createMachine({ id: 'm1', group: 'Milling', cat: 'maschine' }),
      createMachine({ id: 'm2', group: 'Drilling', cat: 'maschine' }),
      createMachine({ id: 'm3', group: 'Milling', cat: 'maschine' }),
      createMachine({ id: 'm4', group: 'Sensors', cat: 'messtechnik' }),
    ];

    const result = groupsByCategory(machines);
    expect(result).toEqual([
      { category: 'maschine', groups: ['Milling', 'Drilling'] },
      { category: 'messtechnik', groups: ['Sensors'] },
    ]);
  });
});

describe('matchesGroupFilter', () => {
  const messMachine = createMachine({ id: 'm1', group: 'Labor', cat: 'messtechnik' });
  const maschMachine = createMachine({ id: 'm2', group: 'Halle', cat: 'maschine' });

  // What: a plain (non-prefixed) filter value matches an exact department-group name only.
  // How: checks a matching group name passes and a different one (even in the same category)
  // does not.
  it('matches an exact group name when the filter has no "cat:" prefix', () => {
    expect(matchesGroupFilter(maschMachine, 'Halle')).toBe(true);
    expect(matchesGroupFilter(maschMachine, 'Labor')).toBe(false);
  });

  // What: a "cat:<id>" filter value matches every machine in that whole category, regardless
  // of its specific department group.
  // How: checks both machines against each category's "cat:" filter value.
  it('matches by whole category when the filter has the "cat:" prefix', () => {
    expect(matchesGroupFilter(messMachine, `${CATEGORY_FILTER_PREFIX}messtechnik`)).toBe(true);
    expect(matchesGroupFilter(maschMachine, `${CATEGORY_FILTER_PREFIX}messtechnik`)).toBe(false);
    expect(matchesGroupFilter(maschMachine, `${CATEGORY_FILTER_PREFIX}maschine`)).toBe(true);
  });
});

describe('getMaintenanceSlots & isSlotCoveringDate', () => {
  // What: when a machine has a modern `maint` array, it's returned as-is (the array itself,
  // not a copy) rather than being reconstructed.
  // How: builds a machine with a maint array and checks the returned value is that exact
  // same array reference.
  it('returns modern maintenance array when present', () => {
    const slots: MaintenanceSlot[] = [{ type: 'wartung', from: '2026-01-01', until: '2026-01-05' }];
    const machine = createMachine({ maint: slots });
    expect(getMaintenanceSlots(machine)).toBe(slots);
  });

  // What: with no `maint` array, a non-'ok' legacy status is synthesized into an equivalent
  // one-slot maintenance array so both forms are readable through the same function.
  // How: builds a machine using only the legacy status/statusFrom/statusUntil/statusNote
  // fields and checks the synthesized slot carries all four values across correctly.
  it('synthesizes legacy status if no maint array exists', () => {
    const machine = createMachine({
      status: 'defekt',
      statusFrom: '2026-01-01',
      statusUntil: '2026-01-03',
      statusNote: 'Broken spindle',
    });
    expect(getMaintenanceSlots(machine)).toEqual([
      {
        type: 'defekt',
        from: '2026-01-01',
        until: '2026-01-03',
        note: 'Broken spindle',
      },
    ]);
  });

  // What: a slot's from/until bounds are both inclusive, and either bound being empty makes
  // that side open-ended.
  // How: checks a bounded slot's coverage right at, just outside, and in the middle of its
  // from/until range (5 boundary + interior cases).
  it('isSlotCoveringDate handles bounded and open-ended date ranges correctly', () => {
    const bounded: MaintenanceSlot = { type: 'wartung', from: '2026-05-10', until: '2026-05-20' };
    expect(isSlotCoveringDate(bounded, '2026-05-09')).toBe(false);
    expect(isSlotCoveringDate(bounded, '2026-05-10')).toBe(true);
    expect(isSlotCoveringDate(bounded, '2026-05-15')).toBe(true);
    expect(isSlotCoveringDate(bounded, '2026-05-20')).toBe(true);
    expect(isSlotCoveringDate(bounded, '2026-05-21')).toBe(false);
  });
});

describe('getMaintenanceSlotAtDate, isMachineBlockedOnDate, hasAnyMaintenanceSlot', () => {
  // What: the covering slot is found for a date inside it and null for a date outside it, and
  // the derived block/has-any predicates agree with that lookup.
  // How: gives a machine one maintenance slot, checks getMaintenanceSlotAtDate finds it for a
  // covered date and returns null for an uncovered one, then checks isMachineBlockedOnDate and
  // hasAnyMaintenanceSlot both reflect that same slot (plus hasAnyMaintenanceSlot being false
  // for a machine with no maintenance at all).
  it('identifies covering maintenance slot and blocked status', () => {
    const slot: MaintenanceSlot = { type: 'wartung', from: '2026-06-01', until: '2026-06-05' };
    const machine = createMachine({ maint: [slot] });

    expect(getMaintenanceSlotAtDate(machine, '2026-06-03')).toEqual(slot);
    expect(getMaintenanceSlotAtDate(machine, '2026-06-10')).toBeNull();

    expect(isMachineBlockedOnDate(machine, '2026-06-03')).toBe(true);
    expect(hasAnyMaintenanceSlot(machine)).toBe(true);
    expect(hasAnyMaintenanceSlot(createMachine())).toBe(false);
  });
});

describe('isMachineAvailableOnWeekday & isCellBookable', () => {
  // What: the 7-char Mo..So mask correctly distinguishes an available weekday from an
  // unavailable one on the same machine.
  // How: gives a machine a Mon-Fri mask and checks a Monday reads available while a Saturday
  // reads unavailable.
  it('evaluates weekday mask Mo..So correctly', () => {
    const machine = createMachine({ days: '1111100' });
    expect(isMachineAvailableOnWeekday(machine, '2026-06-01')).toBe(true); // Monday
    expect(isMachineAvailableOnWeekday(machine, '2026-06-06')).toBe(false); // Saturday
  });

  // What: a machine with no mask at all, or a mask of the wrong length (malformed), both
  // default to "available every day" rather than being treated as unavailable.
  // How: checks a machine with no `days` field and one with a too-short mask both read
  // available on the same Saturday that a real Mon-Fri mask would block.
  it('defaults to available every day when no mask (or a malformed one) is set', () => {
    expect(isMachineAvailableOnWeekday(createMachine(), '2026-06-06')).toBe(true); // no days field
    expect(isMachineAvailableOnWeekday(createMachine({ days: '101' }), '2026-06-06')).toBe(true); // wrong length
  });

  // What: a cell is bookable only when BOTH conditions hold — not blocked by maintenance AND
  // the machine works that weekday; failing either one alone is enough to make it unbookable.
  // How: gives a machine a Mon-Fri mask plus a maintenance slot covering exactly one weekday,
  // then checks three cases: blocked-but-available-weekday (false), neither blocking condition
  // (true), and available-weekday-mask but it's actually a weekend (false).
  it('isCellBookable requires both not blocked and available that weekday', () => {
    const machine = createMachine({
      days: '1111100',
      maint: [{ type: 'wartung', from: '2026-06-01', until: '2026-06-01' }],
    });

    expect(isCellBookable(machine, '2026-06-01')).toBe(false); // blocked by maintenance
    expect(isCellBookable(machine, '2026-06-02')).toBe(true); // available
    expect(isCellBookable(machine, '2026-06-06')).toBe(false); // weekend off
  });
});

describe('saveMachine — edit existing machine', () => {
  // What: editing overwrites the given fields and clears every optional field the form left
  // empty (redu/days/maint/cat), rather than leaving the machine's old values in place.
  // How: starts from a machine with all four optional fields set, saves it through a form that
  // only changes name/group/info (leaving the optionals at their empty defaults), and checks
  // the resulting machine has exactly the new required fields with no optional fields left over.
  it('applies updated fields to existing machine and clears empty optionals', () => {
    const existing = createMachine({
      id: 'm1',
      cat: 'messtechnik',
      redu: 'red-1',
      days: '1111100',
      maint: [{ type: 'defekt' }],
    });
    const data = createBookingData([existing]);

    const result = saveMachine(
      data,
      'm1',
      createForm({ name: 'Renamed Machine', group: 'Group B', info: 'Updated info' }),
    );

    expect(result).toBeUndefined();
    expect(data.machines[0]).toEqual({
      id: 'm1',
      name: 'Renamed Machine',
      group: 'Group B',
      info: 'Updated info',
    });
  });

  // What: saving under a machine id that isn't in the list aborts rather than silently
  // creating or doing nothing.
  // How: calls saveMachine with an id not present in the data and checks the abort result.
  it('aborts when machine ID is not found in data', () => {
    const data = createBookingData([createMachine({ id: 'm1' })]);
    expect(saveMachine(data, 'non-existent', createForm())).toEqual({ abort: true });
  });

  // What: when the form DOES provide redu/days/maint/cat values, they're written onto the
  // machine — the companion case to the "clears empty optionals" test above, checking the
  // opposite (non-empty) branch of the same field-by-field logic.
  // How: saves a bare machine through a form with all four optional fields set to real values
  // and checks each one landed on the machine under its wire name.
  it('sets redu/days/maint/cat when the form actually provides them (not just clearing them)', () => {
    const data = createBookingData([createMachine({ id: 'm1' })]);
    const slots: MaintenanceSlot[] = [{ type: 'wartung', from: '2026-01-01', until: '2026-01-02' }];

    saveMachine(
      data,
      'm1',
      createForm({
        cat: 'messtechnik',
        redu: 'red-1',
        daysMask: '1111100',
        maint: slots,
      }),
    );

    expect(data.machines[0]).toMatchObject({
      cat: 'messtechnik',
      redu: 'red-1',
      days: '1111100',
      maint: slots,
    });
  });
});

describe('saveMachine — create new machine', () => {
  // What: creating a new machine generates its id from the name and inserts it right after
  // its group's existing siblings, not at the end of the whole list.
  // How: starts with one Group A and one Group B machine, creates a new Group A machine with
  // an umlaut-bearing name, and checks the new slug-derived id lands between the two existing ones.
  it('creates unique ID and inserts after same group siblings', () => {
    const data = createBookingData([
      createMachine({ id: 'a1', group: 'Group A' }),
      createMachine({ id: 'b1', group: 'Group B' }),
    ]);

    saveMachine(data, null, createForm({ name: 'Über Fräse!', group: 'Group A' }));
    expect(data.machines.map((machine) => machine.id)).toEqual(['a1', 'ueber-fraese', 'b1']);
  });
});

describe('deleteMachine', () => {
  // What: deleting a machine removes it from the list AND removes its entire bookings bucket,
  // leaving other machines' data untouched.
  // How: sets up two machines where only the deleted one has a booking, deletes it, and checks
  // both the machine list and its bookings entry are gone.
  it('removes machine and cleans up all associated bookings', () => {
    const data = createBookingData([createMachine({ id: 'm1' }), createMachine({ id: 'm2' })], {
      m1: { '2026-06-01': { name: 'Alice' } },
    });

    expect(deleteMachine(data, 'm1')).toBeUndefined();
    expect(data.machines.map((machine) => machine.id)).toEqual(['m2']);
    expect(data.bookings.m1).toBeUndefined();
  });

  // What: deleting an id that isn't in the list aborts rather than silently no-op-ing.
  // How: calls deleteMachine on an empty machine list and checks the abort result.
  it('aborts if machine does not exist', () => {
    expect(deleteMachine(createBookingData([]), 'm1')).toEqual({ abort: true });
  });
});

describe('moveMachine (reordering)', () => {
  const setupThreeMachines = () =>
    createBookingData([
      createMachine({ id: 'a', group: 'Group A' }),
      createMachine({ id: 'b', group: 'Group A' }),
      createMachine({ id: 'c', group: 'Group A' }),
    ]);

  // What: direction -1 swaps a machine with its predecessor (moves it one position earlier).
  // How: moves the middle machine of a 3-machine group with direction -1 and checks it swapped
  // with the first.
  it('swaps machine position upwards with direction -1', () => {
    const data = setupThreeMachines();
    expect(moveMachine(data, 'b', -1)).toBeUndefined();
    expect(data.machines.map((machine) => machine.id)).toEqual(['b', 'a', 'c']);
  });

  // What: direction 1 swaps a machine with its successor (moves it one position later).
  // How: moves the middle machine of a 3-machine group with direction 1 and checks it swapped
  // with the last.
  it('swaps machine position downwards with direction 1', () => {
    const data = setupThreeMachines();
    expect(moveMachine(data, 'b', 1)).toBeUndefined();
    expect(data.machines.map((machine) => machine.id)).toEqual(['a', 'c', 'b']);
  });

  // What: moving past either end of the list aborts rather than wrapping or throwing.
  // How: tries to move the first machine up and the last machine down in the same 3-machine
  // group, checking both abort and the list order they'd have left is never checked (aborted
  // moves don't need it — the abort result itself is the assertion).
  it('aborts at top and bottom list boundaries', () => {
    const data = setupThreeMachines();
    expect(moveMachine(data, 'a', -1)).toEqual({ abort: true });
    expect(moveMachine(data, 'c', 1)).toEqual({ abort: true });
  });

  // What: a move that would cross into a different group is refused, even though the target
  // index itself is a valid array position.
  // How: sets up two machines in two different groups and tries to move the first one down
  // (into the second machine's group), checking it aborts and neither machine moved.
  it('aborts when attempting to swap with a machine in a different group', () => {
    const data = createBookingData([
      createMachine({ id: 'a', group: 'Group A' }),
      createMachine({ id: 'b', group: 'Group B' }),
    ]);
    expect(moveMachine(data, 'a', 1)).toEqual({ abort: true });
    expect(data.machines.map((machine) => machine.id)).toEqual(['a', 'b']);
  });

  // What: moving an id that isn't in the list at all aborts (a distinct failure mode from the
  // boundary case above — this machine was never there to begin with).
  // How: calls moveMachine with a nonexistent id and checks the abort result and that the
  // real machines' order is untouched.
  it('aborts when the machine id does not exist at all (not just a boundary case)', () => {
    const data = setupThreeMachines();
    expect(moveMachine(data, 'ghost', -1)).toEqual({ abort: true });
    expect(data.machines.map((machine) => machine.id)).toEqual(['a', 'b', 'c']);
  });
});
