import { describe, it, expect } from 'vitest';
import type { Machine } from '../../../shared/types.ts';
import { orderedMachines } from './grid.ts';
import { buildMachineFilterRows } from './machine-filter.ts';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'M1', group: 'Halle 1', ...overrides };
}

const fav = machine({ id: 'fav1', name: 'FavMaschine', group: 'Halle 1' });
const m1 = machine({ id: 'm1', name: 'Fräse', group: 'Halle 1' });
const m2 = machine({ id: 'm2', name: 'Presse', group: 'Halle 2' });
const meas = machine({ id: 'meas1', name: 'Messgerät', group: 'Labor', cat: 'messtechnik' });
const machines = orderedMachines([m1, m2, meas, fav], new Set(['fav1']));
const base = {
  favoriteIds: new Set(['fav1']),
  searchQuery: '',
  openKeys: new Set<string>(),
  shownCategories: new Set<'maschine' | 'messtechnik'>(['maschine', 'messtechnik']),
};

describe('buildMachineFilterRows', () => {
  it('shows a "★ Favoriten" category header (open state reflects openKeys) with no group sub-level', () => {
    const rows = buildMachineFilterRows(machines, { ...base, openKeys: new Set(['fav']) });
    expect(rows[0]).toEqual({ kind: 'category', key: 'fav', label: '★ Favoriten', open: true });
    expect(rows[1]).toEqual({ kind: 'machine', machine: fav });
  });

  it('hides favorite machines when the favorites category is closed', () => {
    const rows = buildMachineFilterRows(machines, base);
    expect(rows.filter((r) => r.kind === 'machine' && r.machine.id === 'fav1')).toEqual([]);
  });

  it('emits a category header per non-favorite category, Maschinen before Messtechnik', () => {
    const rows = buildMachineFilterRows(machines, base);
    expect(rows.filter((r) => r.kind === 'category').map((r) => r.key)).toEqual([
      'fav',
      'maschine',
      'messtechnik',
    ]);
  });

  it('emits a group header per group within an open category, in first-seen order', () => {
    const rows = buildMachineFilterRows(machines, { ...base, openKeys: new Set(['maschine']) });
    expect(rows.filter((r) => r.kind === 'group').map((r) => r.label)).toEqual([
      'Halle 1',
      'Halle 2',
    ]);
  });

  it('only shows a machine when both its category AND its group are open', () => {
    const openCategoryOnly = buildMachineFilterRows(machines, {
      ...base,
      openKeys: new Set(['maschine']),
    });
    expect(openCategoryOnly.filter((r) => r.kind === 'machine')).toEqual([]);

    const openBoth = buildMachineFilterRows(machines, {
      ...base,
      openKeys: new Set(['maschine', 'maschine::Halle 1']),
    });
    expect(openBoth.filter((r) => r.kind === 'machine').map((r) => r.machine.name)).toEqual([
      'Fräse',
    ]);
  });

  it('while searching, every header vanishes and matches ignore fold state entirely', () => {
    const rows = buildMachineFilterRows(machines, { ...base, searchQuery: 'Presse' });
    expect(rows.every((r) => r.kind === 'machine')).toBe(true);
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual(['Presse']);
  });

  it('search matches against "name group", case-insensitively', () => {
    const rows = buildMachineFilterRows(machines, { ...base, searchQuery: 'HALLE 2' });
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual(['Presse']);
  });

  it('search also matches a closed favorite', () => {
    const rows = buildMachineFilterRows(machines, { ...base, searchQuery: 'favmaschine' });
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual([
      'FavMaschine',
    ]);
  });

  describe('shownCategories (legacy mfShow — filters the LIST, never the grid)', () => {
    it('omits an entire category section (header, groups, machines) when not shown', () => {
      const rows = buildMachineFilterRows(machines, {
        ...base,
        openKeys: new Set(['maschine', 'maschine::Halle 1', 'maschine::Halle 2']),
        shownCategories: new Set(['maschine']),
      });
      expect(rows.some((r) => r.kind === 'category' && r.key === 'messtechnik')).toBe(false);
      expect(rows.some((r) => r.kind === 'machine' && r.machine.id === 'meas1')).toBe(false);
    });

    it('always shows favorites regardless of shownCategories', () => {
      const rows = buildMachineFilterRows(machines, {
        ...base,
        openKeys: new Set(['fav']),
        shownCategories: new Set(),
      });
      expect(rows[0]).toEqual({ kind: 'category', key: 'fav', label: '★ Favoriten', open: true });
      expect(rows.some((r) => r.kind === 'machine' && r.machine.id === 'fav1')).toBe(true);
    });

    it('a hidden category is still excluded from search results', () => {
      const rows = buildMachineFilterRows(machines, {
        ...base,
        searchQuery: 'Messgerät',
        shownCategories: new Set(['maschine']),
      });
      expect(rows).toEqual([]);
    });
  });
});
