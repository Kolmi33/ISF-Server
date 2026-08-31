import { describe, it, expect } from 'vitest';
import type { Machine } from '../../../shared/types.ts';
import { orderedMachines } from './grid.ts';
import { buildChecklistRows } from './assistant-checklist.ts';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'M1', group: 'Halle 1', ...overrides };
}

const fav = machine({ id: 'fav1', name: 'FavMaschine', group: 'Halle 1' });
const m1 = machine({ id: 'm1', name: 'Fräse', group: 'Halle 1' });
const m2 = machine({ id: 'm2', name: 'Presse', group: 'Halle 2' });
const meas = machine({ id: 'meas1', name: 'Messgerät', group: 'Labor', cat: 'messtechnik' });
const machines = orderedMachines([m1, m2, meas, fav], new Set(['fav1']));
const noneOpen = { favoriteIds: new Set(['fav1']), searchQuery: '', openKeys: new Set<string>() };

describe('buildChecklistRows', () => {
  it('shows a "★ Favoriten" category header (open state reflects openKeys) with no group sub-level', () => {
    const rows = buildChecklistRows(machines, { ...noneOpen, openKeys: new Set(['fav']) });
    expect(rows[0]).toEqual({ kind: 'category', key: 'fav', label: '★ Favoriten', open: true });
    expect(rows[1]).toEqual({ kind: 'machine', machine: fav });
  });

  it('hides favorite machines when the favorites category is closed', () => {
    const rows = buildChecklistRows(machines, noneOpen);
    expect(rows.filter((r) => r.kind === 'machine' && r.machine.id === 'fav1')).toEqual([]);
  });

  it('omits the favorites category header entirely when there are no favorites', () => {
    const rows = buildChecklistRows(orderedMachines([m1], new Set()), {
      ...noneOpen,
      favoriteIds: new Set(),
    });
    expect(rows.some((r) => r.kind === 'category' && r.key === 'fav')).toBe(false);
  });

  it('emits a category header per non-favorite category, Maschinen before Messtechnik', () => {
    const rows = buildChecklistRows(machines, noneOpen);
    const categoryKeys = rows.filter((r) => r.kind === 'category').map((r) => r.key);
    expect(categoryKeys).toEqual(['fav', 'maschine', 'messtechnik']);
  });

  it('emits a group header per group within an open category, in first-seen order', () => {
    const rows = buildChecklistRows(machines, { ...noneOpen, openKeys: new Set(['maschine']) });
    const groups = rows.filter((r) => r.kind === 'group');
    expect(groups.map((r) => r.label)).toEqual(['Halle 1', 'Halle 2']);
  });

  it('only shows a machine when both its category AND its group are open', () => {
    const openCategoryOnly = buildChecklistRows(machines, {
      ...noneOpen,
      openKeys: new Set(['maschine']),
    });
    expect(openCategoryOnly.filter((r) => r.kind === 'machine')).toEqual([]);

    const openBoth = buildChecklistRows(machines, {
      ...noneOpen,
      openKeys: new Set(['maschine', 'maschine::Halle 1']),
    });
    expect(openBoth.filter((r) => r.kind === 'machine').map((r) => r.machine.name)).toEqual([
      'Fräse',
    ]);
  });

  it('a group header only appears when its category is open', () => {
    const rows = buildChecklistRows(machines, noneOpen);
    expect(rows.filter((r) => r.kind === 'group')).toEqual([]);
  });

  it('while searching, every header vanishes and matches ignore fold state entirely', () => {
    const rows = buildChecklistRows(machines, { ...noneOpen, searchQuery: 'Presse' });
    expect(rows.every((r) => r.kind === 'machine')).toBe(true);
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual(['Presse']);
  });

  it('search matches against "name group", case-insensitively', () => {
    const rows = buildChecklistRows(machines, { ...noneOpen, searchQuery: 'HALLE 2' });
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual(['Presse']);
  });

  it('search also matches a closed favorite', () => {
    const rows = buildChecklistRows(machines, { ...noneOpen, searchQuery: 'favmaschine' });
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual([
      'FavMaschine',
    ]);
  });
});
