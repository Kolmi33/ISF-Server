import { describe, it, expect } from 'vitest';
import type { Machine } from '../../../shared/types.ts';
import {
  catOf,
  maintSlots,
  slotCovers,
  maintAt,
  isBlockedM,
  anyMaint,
  dayAvailable,
  cellBookable,
} from './machines.ts';

// Minimal machine factory — only the fields under test; overrides fill the rest.
function machine(over: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Werkstatt', ...over };
}

describe('catOf', () => {
  it("returns 'messtechnik' only when cat is exactly that", () => {
    expect(catOf(machine({ cat: 'messtechnik' }))).toBe('messtechnik');
  });
  it("defaults to 'maschine' when cat is absent or different", () => {
    expect(catOf(machine())).toBe('maschine');
    expect(catOf(machine({ cat: 'sonstiges' }))).toBe('maschine');
  });
  it("treats null/undefined as 'maschine'", () => {
    expect(catOf(null)).toBe('maschine');
    expect(catOf(undefined)).toBe('maschine');
  });
});

describe('maintSlots', () => {
  it('returns the structured maint array as-is when present', () => {
    const slots = [{ type: 'wartung', from: '2021-01-01' }];
    expect(maintSlots(machine({ maint: slots }))).toBe(slots);
  });
  it('synthesizes one slot from the legacy status fields', () => {
    const m = machine({
      status: 'defekt',
      statusFrom: '2021-01-04',
      statusUntil: '2021-01-08',
      statusNote: 'Motor',
    });
    expect(maintSlots(m)).toEqual([
      { type: 'defekt', from: '2021-01-04', until: '2021-01-08', note: 'Motor' },
    ]);
  });
  it('fills empty strings for missing legacy status bounds', () => {
    expect(maintSlots(machine({ status: 'wartung' }))).toEqual([
      { type: 'wartung', from: '', until: '', note: '' },
    ]);
  });
  it("returns [] for status 'ok' or no status at all", () => {
    expect(maintSlots(machine({ status: 'ok' }))).toEqual([]);
    expect(maintSlots(machine())).toEqual([]);
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

describe('maintAt / isBlockedM / anyMaint', () => {
  const m = machine({ status: 'defekt', statusFrom: '2021-01-04', statusUntil: '2021-01-08' });
  it('maintAt returns the covering slot or null', () => {
    expect(maintAt(m, '2021-01-06')?.type).toBe('defekt');
    expect(maintAt(m, '2021-02-01')).toBeNull();
  });
  it('isBlockedM reflects coverage', () => {
    expect(isBlockedM(m, '2021-01-06')).toBe(true);
    expect(isBlockedM(m, '2021-02-01')).toBe(false);
  });
  it('anyMaint reflects whether any slot exists', () => {
    expect(anyMaint(m)).toBe(true);
    expect(anyMaint(machine())).toBe(false);
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
