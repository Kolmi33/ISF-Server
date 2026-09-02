import { describe, it, expect } from 'vitest';
import type { BookingData, Machine } from '../../../shared/types.ts';
import {
  categoryOf,
  maintenanceSlots,
  slotCovers,
  maintenanceSlotAt,
  isBlockedOnDate,
  hasAnyMaintenanceSlot,
  dayAvailable,
  cellBookable,
  groupsByCategory,
  saveMachine,
  deleteMachine,
  moveMachine,
  type MachineForm,
} from './machines.ts';

// Minimal machine factory — only the fields under test; overrides fill the rest.
function machine(over: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Werkstatt', ...over };
}

describe('categoryOf', () => {
  it("returns 'messtechnik' only when cat is exactly that", () => {
    expect(categoryOf(machine({ cat: 'messtechnik' }))).toBe('messtechnik');
  });
  it("defaults to 'maschine' when cat is absent or different", () => {
    expect(categoryOf(machine())).toBe('maschine');
    expect(categoryOf(machine({ cat: 'sonstiges' }))).toBe('maschine');
  });
  it("treats null/undefined as 'maschine'", () => {
    expect(categoryOf(null)).toBe('maschine');
    expect(categoryOf(undefined)).toBe('maschine');
  });
});

describe('maintenanceSlots', () => {
  it('returns the structured maint array as-is when present', () => {
    const slots = [{ type: 'wartung', from: '2021-01-01' }];
    expect(maintenanceSlots(machine({ maint: slots }))).toBe(slots);
  });
  it('synthesizes one slot from the legacy status fields', () => {
    const m = machine({
      status: 'defekt',
      statusFrom: '2021-01-04',
      statusUntil: '2021-01-08',
      statusNote: 'Motor',
    });
    expect(maintenanceSlots(m)).toEqual([
      { type: 'defekt', from: '2021-01-04', until: '2021-01-08', note: 'Motor' },
    ]);
  });
  it('fills empty strings for missing legacy status bounds', () => {
    expect(maintenanceSlots(machine({ status: 'wartung' }))).toEqual([
      { type: 'wartung', from: '', until: '', note: '' },
    ]);
  });
  it("returns [] for status 'ok' or no status at all", () => {
    expect(maintenanceSlots(machine({ status: 'ok' }))).toEqual([]);
    expect(maintenanceSlots(machine())).toEqual([]);
  });
});

describe('slotCovers', () => {
  it('is true within an inclusive from..until range', () => {
    const s = { type: 'wartung', from: '2021-01-04', until: '2021-01-08' };
    expect(slotCovers(s, '2021-01-04')).toBe(true); // lower edge
    expect(slotCovers(s, '2021-01-06')).toBe(true);
    expect(slotCovers(s, '2021-01-08')).toBe(true); // upper edge
  });
  it('is false outside the range', () => {
    const s = { type: 'wartung', from: '2021-01-04', until: '2021-01-08' };
    expect(slotCovers(s, '2021-01-03')).toBe(false);
    expect(slotCovers(s, '2021-01-09')).toBe(false);
  });
  it('treats an empty from/until as open-ended on that side', () => {
    expect(slotCovers({ type: 'x', until: '2021-01-08' }, '1900-01-01')).toBe(true);
    expect(slotCovers({ type: 'x', from: '2021-01-04' }, '2999-01-01')).toBe(true);
    expect(slotCovers({ type: 'x' }, '2021-06-15')).toBe(true);
  });
});

describe('maintenanceSlotAt / isBlockedOnDate / hasAnyMaintenanceSlot', () => {
  const m = machine({ status: 'defekt', statusFrom: '2021-01-04', statusUntil: '2021-01-08' });
  it('maintenanceSlotAt returns the covering slot or null', () => {
    expect(maintenanceSlotAt(m, '2021-01-06')?.type).toBe('defekt');
    expect(maintenanceSlotAt(m, '2021-02-01')).toBeNull();
  });
  it('isBlockedOnDate reflects coverage', () => {
    expect(isBlockedOnDate(m, '2021-01-06')).toBe(true);
    expect(isBlockedOnDate(m, '2021-02-01')).toBe(false);
  });
  it('hasAnyMaintenanceSlot reflects whether any slot exists', () => {
    expect(hasAnyMaintenanceSlot(m)).toBe(true);
    expect(hasAnyMaintenanceSlot(machine())).toBe(false);
  });
});

describe('dayAvailable', () => {
  it('is available every day when the mask is missing or malformed', () => {
    expect(dayAvailable(machine(), '2021-01-04')).toBe(true);
    expect(dayAvailable(machine({ days: '111' }), '2021-01-04')).toBe(true);
  });
  it('reads the Mo..So mask ( 2021-01-04 is a Monday = index 0 )', () => {
    expect(dayAvailable(machine({ days: '0111111' }), '2021-01-04')).toBe(false); // Mon off
    expect(dayAvailable(machine({ days: '1111111' }), '2021-01-04')).toBe(true);
    expect(dayAvailable(machine({ days: '1111110' }), '2021-01-10')).toBe(false); // Sun off
  });
});

describe('cellBookable', () => {
  it('is false when blocked', () => {
    const m = machine({ status: 'wartung', statusFrom: '2021-01-04', statusUntil: '2021-01-08' });
    expect(cellBookable(m, '2021-01-06')).toBe(false);
  });
  it('is false when the weekday is unavailable', () => {
    expect(cellBookable(machine({ days: '0111111' }), '2021-01-04')).toBe(false);
  });
  it('is true when free and available', () => {
    expect(cellBookable(machine(), '2021-01-06')).toBe(true);
  });
});

describe('groupsByCategory', () => {
  it('buckets distinct group names by category, in first-seen order', () => {
    const result = groupsByCategory([
      machine({ id: 'm1', group: 'Halle 1' }),
      machine({ id: 'm2', group: 'Halle 2' }),
      machine({ id: 'm3', group: 'Halle 1' }), // repeat — not duplicated
      machine({ id: 'm4', group: 'Labor', cat: 'messtechnik' }),
    ]);
    expect(result).toEqual([
      { category: 'maschine', groups: ['Halle 1', 'Halle 2'] },
      { category: 'messtechnik', groups: ['Labor'] },
    ]);
  });

  it('omits a category with no groups entirely, rather than an empty entry', () => {
    const result = groupsByCategory([machine({ id: 'm1', group: 'Halle 1' })]);
    expect(result).toEqual([{ category: 'maschine', groups: ['Halle 1'] }]);
  });

  it('is empty when there are no machines', () => {
    expect(groupsByCategory([])).toEqual([]);
  });
});

function data(machines: Machine[], bookings: BookingData['bookings'] = {}): BookingData {
  return { machines, bookings };
}
const M = (over: Partial<Machine> = {}): Machine => ({ id: 'm1', name: 'M1', group: 'A', ...over });

const form = (over: Partial<MachineForm> = {}): MachineForm => ({
  name: 'Neue Fräse',
  group: 'A',
  cat: 'maschine',
  info: '',
  redu: '',
  daysMask: null,
  maint: [],
  ...over,
});

describe('saveMachine — edit', () => {
  it('applies the fields onto an existing machine and clears absent optionals', () => {
    const existing = M({
      id: 'm1',
      cat: 'messtechnik',
      redu: 'x',
      days: '1111100',
      maint: [{ type: 'defekt' }],
      status: 'ok',
      statusNote: 'n',
      statusFrom: 'f',
      statusUntil: 'u',
    });
    const d = data([existing]);
    const res = saveMachine(d, 'm1', form({ name: 'Umbenannt', group: 'B', info: 'i' }));
    expect(res).toBeUndefined();
    expect(d.machines[0]).toEqual({ id: 'm1', name: 'Umbenannt', group: 'B', info: 'i' });
  });

  it('keeps the present optionals (redu / days / maint / messtechnik)', () => {
    const d = data([M({ id: 'm1' })]);
    saveMachine(
      d,
      'm1',
      form({ cat: 'messtechnik', redu: 'r', daysMask: '1111100', maint: [{ type: 'wartung' }] }),
    );
    expect(d.machines[0]).toMatchObject({
      cat: 'messtechnik',
      redu: 'r',
      days: '1111100',
      maint: [{ type: 'wartung' }],
    });
  });

  it('aborts when the machine to edit has vanished', () => {
    const d = data([M({ id: 'm1' })]);
    expect(saveMachine(d, 'gone', form())).toEqual({ abort: true });
  });
});

describe('saveMachine — create', () => {
  it('slugs the name, transliterates umlauts, and inserts after the group', () => {
    const d = data([M({ id: 'a1', group: 'A' }), M({ id: 'b1', group: 'B' })]);
    saveMachine(d, null, form({ name: 'Über Fräse!', group: 'A' }));
    expect(d.machines.map((m) => m.id)).toEqual(['a1', 'ueber-fraese', 'b1']); // after last A
  });

  it('disambiguates a colliding id with a numeric suffix', () => {
    const d = data([M({ id: 'fraese', group: 'A' }), M({ id: 'fraese-2', group: 'A' })]);
    saveMachine(d, null, form({ name: 'Fraese', group: 'A' }));
    expect(d.machines.some((m) => m.id === 'fraese-3')).toBe(true);
  });

  it('falls back to "maschine" for a name with no slug-able characters', () => {
    const d = data([]);
    saveMachine(d, null, form({ name: '!!!' }));
    expect(d.machines[0]!.id).toBe('maschine');
  });

  it('appends at the end when no machine shares the group', () => {
    const d = data([M({ id: 'a1', group: 'A' })]);
    saveMachine(d, null, form({ name: 'Z', group: 'Z' }));
    expect(d.machines.map((m) => m.id)).toEqual(['a1', 'z']);
  });
});

describe('deleteMachine', () => {
  it('removes the machine and its bookings', () => {
    const d = data([M({ id: 'm1' }), M({ id: 'm2' })], { m1: { '2021-01-04': { name: 'A' } } });
    expect(deleteMachine(d, 'm1')).toBeUndefined();
    expect(d.machines.map((m) => m.id)).toEqual(['m2']);
    expect(d.bookings.m1).toBeUndefined();
  });

  it('aborts when the machine is already gone', () => {
    expect(deleteMachine(data([]), 'm1')).toEqual({ abort: true });
  });
});

describe('moveMachine', () => {
  const three = () =>
    data([M({ id: 'a', group: 'G' }), M({ id: 'b', group: 'G' }), M({ id: 'c', group: 'G' })]);

  it('swaps up (direction -1)', () => {
    const d = three();
    expect(moveMachine(d, 'b', -1)).toBeUndefined();
    expect(d.machines.map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  it('swaps down (direction +1)', () => {
    const d = three();
    moveMachine(d, 'b', 1);
    expect(d.machines.map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });

  it('aborts at the top, at the bottom, and for an unknown id', () => {
    expect(moveMachine(three(), 'a', -1)).toEqual({ abort: true }); // neighbourIndex<0
    expect(moveMachine(three(), 'c', 1)).toEqual({ abort: true }); // neighbourIndex>=length
    expect(moveMachine(three(), 'zzz', -1)).toEqual({ abort: true }); // currentIndex<0
  });

  it('aborts when the neighbour is in a different group', () => {
    const d = data([M({ id: 'a', group: 'G' }), M({ id: 'b', group: 'H' })]);
    expect(moveMachine(d, 'a', 1)).toEqual({ abort: true });
    expect(d.machines.map((m) => m.id)).toEqual(['a', 'b']); // unchanged
  });
});
