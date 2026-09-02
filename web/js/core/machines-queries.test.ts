import { describe, it, expect } from 'vitest';
import type { Machine } from '../../../shared/types.ts';
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
} from './machines-queries.ts';

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
