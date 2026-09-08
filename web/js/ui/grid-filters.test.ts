import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingData } from '../../../shared/types.ts';
import { hasGridFilters, matchingGridMachineIds, type GridFilterCriteria } from './grid-filters.ts';

const data: BookingData = {
  machines: [
    { id: 'mill', name: 'DMG Fräse', group: 'Alte Halle', info: '5 Achsen' },
    { id: 'laser', name: 'TruLaser', group: 'Laserlabor' },
    {
      id: 'probe',
      name: 'Kistler Sensor',
      group: 'Messraum',
      cat: 'messtechnik',
      maint: [{ type: 'defekt', from: '2026-09-08', until: '2026-09-08' }],
    },
  ],
  bookings: { mill: { '2026-09-09': { name: 'Anna' } } },
};

function criteria(overrides: Partial<GridFilterCriteria> = {}): GridFilterCriteria {
  return {
    query: '',
    groups: new Set(),
    machineIds: new Set(),
    availableOnly: false,
    operationalOnly: false,
    favoritesOnly: false,
    favoriteIds: new Set(['laser']),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
});

describe('main grid facets', () => {
  it('matches name, location and metadata searches case-insensitively', () => {
    expect([
      ...matchingGridMachineIds(data, ['2026-09-08'], criteria({ query: 'alte halle' })),
    ]).toEqual(['mill']);
    expect([
      ...matchingGridMachineIds(data, ['2026-09-08'], criteria({ query: 'sensor' })),
    ]).toEqual(['probe']);
  });

  it('combines locations, favorites and operational state', () => {
    expect([
      ...matchingGridMachineIds(data, ['2026-09-08'], criteria({ favoritesOnly: true })),
    ]).toEqual(['laser']);
    expect([
      ...matchingGridMachineIds(data, ['2026-09-08'], criteria({ operationalOnly: true })),
    ]).toEqual(['mill', 'laser']);
  });

  it('requires every workday in the visible period to be bookable and unoccupied', () => {
    expect([
      ...matchingGridMachineIds(
        data,
        ['2026-09-08', '2026-09-09'],
        criteria({ availableOnly: true }),
      ),
    ]).toEqual(['laser']);
  });

  it('keeps an explicit zero-result set and reports active filters', () => {
    const active = criteria({ query: 'nicht vorhanden' });
    expect(matchingGridMachineIds(data, ['2026-09-08'], active).size).toBe(0);
    expect(hasGridFilters(active)).toBe(true);
    expect(hasGridFilters(criteria())).toBe(false);
  });
});
