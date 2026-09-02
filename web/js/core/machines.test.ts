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
  groupsByCategory,
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
  category: 'maschine',
  info: '',
  redundancyGroup: '',
  weekdayAvailabilityMask: null,
  maintenanceSlots: [],
  ...overrides,
});

describe('generateMachineIdFromName (ID generation)', () => {
  it('transliterates German umlauts and removes invalid symbols', () => {
    expect(generateMachineIdFromName('Über-Prüfgerät 3000!')).toBe('ueber-pruefgeraet-3000');
    expect(generateMachineIdFromName('Große Säge')).toBe('grosse-saege');
  });

  it('normalizes European accented letters (French, Spanish, Nordic)', () => {
    expect(generateMachineIdFromName('Électro-Découpe')).toBe('electro-decoupe');
    expect(generateMachineIdFromName('Laser-Måler')).toBe('laser-maler');
    expect(generateMachineIdFromName('Cizalla & Piñón')).toBe('cizalla-pinon');
  });

  it('generates a stable deterministic m_<hash> ID for non-Latin scripts', () => {
    const cyrillicId = generateMachineIdFromName('Фрезерный станок');
    expect(cyrillicId).toMatch(/^m_[a-f0-9]{6}$/);

    // Deterministic: same input gives exact same ID
    expect(generateMachineIdFromName('Фрезерный станок')).toBe(cyrillicId);

    const chineseId = generateMachineIdFromName('五轴加工中心');
    expect(chineseId).toMatch(/^m_[a-f0-9]{6}$/);
    expect(chineseId).not.toBe(cyrillicId);
  });

  it('handles empty or pure symbol strings gracefully', () => {
    const symbolId = generateMachineIdFromName('⚡⚡⚡');
    expect(symbolId).toMatch(/^m_[a-f0-9]{6}$/);
    expect(generateMachineIdFromName('')).toBe('machine');
  });

  it('keeps a single-character Latin slug as-is, not the hash fallback', () => {
    expect(generateMachineIdFromName('Z')).toBe('z');
    expect(generateMachineIdFromName('3')).toBe('3');
  });
});

describe('ensureUniqueMachineId & findGroupInsertionIndex', () => {
  it('returns candidate ID directly if no collision exists', () => {
    const existing = [createMachine({ id: 'fraese-1' })];
    expect(ensureUniqueMachineId(existing, 'fraese-2')).toBe('fraese-2');
  });

  it('increments numeric suffix on ID collision', () => {
    const existing = [createMachine({ id: 'fraese' }), createMachine({ id: 'fraese-2' })];
    expect(ensureUniqueMachineId(existing, 'fraese')).toBe('fraese-3');
  });

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
  it('returns messtechnik for machines tagged with cat="messtechnik"', () => {
    expect(getMachineCategory(createMachine({ cat: 'messtechnik' }))).toBe('messtechnik');
  });

  it('defaults to maschine for empty or standard machine', () => {
    expect(getMachineCategory(createMachine({ cat: 'maschine' }))).toBe('maschine');
    expect(getMachineCategory(createMachine())).toBe('maschine');
    expect(getMachineCategory(null)).toBe('maschine');
  });
});

describe('CATEGORIES & groupsByCategory', () => {
  it('exports standard categories', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(['maschine', 'messtechnik']);
  });

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

describe('getMaintenanceSlots & isSlotCoveringDate', () => {
  it('returns modern maintenance array when present', () => {
    const slots: MaintenanceSlot[] = [{ type: 'wartung', from: '2026-01-01', until: '2026-01-05' }];
    const machine = createMachine({ maint: slots });
    expect(getMaintenanceSlots(machine)).toBe(slots);
  });

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
  it('evaluates weekday mask Mo..So correctly', () => {
    const machine = createMachine({ days: '1111100' });
    expect(isMachineAvailableOnWeekday(machine, '2026-06-01')).toBe(true); // Monday
    expect(isMachineAvailableOnWeekday(machine, '2026-06-06')).toBe(false); // Saturday
  });

  it('defaults to available every day when no mask (or a malformed one) is set', () => {
    expect(isMachineAvailableOnWeekday(createMachine(), '2026-06-06')).toBe(true); // no days field
    expect(isMachineAvailableOnWeekday(createMachine({ days: '101' }), '2026-06-06')).toBe(true); // wrong length
  });

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

  it('aborts when machine ID is not found in data', () => {
    const data = createBookingData([createMachine({ id: 'm1' })]);
    expect(saveMachine(data, 'non-existent', createForm())).toEqual({ abort: true });
  });

  it('sets redu/days/maint/cat when the form actually provides them (not just clearing them)', () => {
    const data = createBookingData([createMachine({ id: 'm1' })]);
    const slots: MaintenanceSlot[] = [{ type: 'wartung', from: '2026-01-01', until: '2026-01-02' }];

    saveMachine(
      data,
      'm1',
      createForm({
        category: 'messtechnik',
        redundancyGroup: 'red-1',
        weekdayAvailabilityMask: '1111100',
        maintenanceSlots: slots,
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
  it('removes machine and cleans up all associated bookings', () => {
    const data = createBookingData([createMachine({ id: 'm1' }), createMachine({ id: 'm2' })], {
      m1: { '2026-06-01': { name: 'Alice' } },
    });

    expect(deleteMachine(data, 'm1')).toBeUndefined();
    expect(data.machines.map((machine) => machine.id)).toEqual(['m2']);
    expect(data.bookings.m1).toBeUndefined();
  });

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

  it('swaps machine position upwards with "up" or -1', () => {
    const data = setupThreeMachines();
    expect(moveMachine(data, 'b', 'up')).toBeUndefined();
    expect(data.machines.map((machine) => machine.id)).toEqual(['b', 'a', 'c']);

    const data2 = setupThreeMachines();
    expect(moveMachine(data2, 'b', -1)).toBeUndefined();
    expect(data2.machines.map((machine) => machine.id)).toEqual(['b', 'a', 'c']);
  });

  it('swaps machine position downwards with "down" or 1', () => {
    const data = setupThreeMachines();
    expect(moveMachine(data, 'b', 'down')).toBeUndefined();
    expect(data.machines.map((machine) => machine.id)).toEqual(['a', 'c', 'b']);

    const data2 = setupThreeMachines();
    expect(moveMachine(data2, 'b', 1)).toBeUndefined();
    expect(data2.machines.map((machine) => machine.id)).toEqual(['a', 'c', 'b']);
  });

  it('aborts at top and bottom list boundaries', () => {
    const data = setupThreeMachines();
    expect(moveMachine(data, 'a', 'up')).toEqual({ abort: true });
    expect(moveMachine(data, 'c', 'down')).toEqual({ abort: true });
  });

  it('aborts when attempting to swap with a machine in a different group', () => {
    const data = createBookingData([
      createMachine({ id: 'a', group: 'Group A' }),
      createMachine({ id: 'b', group: 'Group B' }),
    ]);
    expect(moveMachine(data, 'a', 'down')).toEqual({ abort: true });
    expect(data.machines.map((machine) => machine.id)).toEqual(['a', 'b']);
  });

  it('aborts when the machine id does not exist at all (not just a boundary case)', () => {
    const data = setupThreeMachines();
    expect(moveMachine(data, 'ghost', 'up')).toEqual({ abort: true });
    expect(data.machines.map((machine) => machine.id)).toEqual(['a', 'b', 'c']);
  });
});
