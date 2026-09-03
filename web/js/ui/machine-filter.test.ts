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
  // What: favorite machines get their own "★ Favoriten" pseudo-category header (not a real
  // category/group), whose open/closed state is driven by openKeys like any other header.
  // How: opens the 'fav' key and checks the header row's exact shape plus the favorite
  // machine row right after it.
  it('shows a "★ Favoriten" category header (open state reflects openKeys) with no group sub-level', () => {
    const rows = buildMachineFilterRows(machines, { ...base, openKeys: new Set(['fav']) });
    expect(rows[0]).toEqual({ kind: 'category', key: 'fav', label: '★ Favoriten', open: true });
    expect(rows[1]).toEqual({ kind: 'machine', machine: fav });
  });

  // What: with the favorites header closed (the default state), the favorite machine's row
  // doesn't appear at all.
  // How: builds rows with default (closed) openKeys and checks no row is the favorite machine.
  it('hides favorite machines when the favorites category is closed', () => {
    const rows = buildMachineFilterRows(machines, base);
    expect(rows.filter((r) => r.kind === 'machine' && r.machine.id === 'fav1')).toEqual([]);
  });

  // What: besides the favorites pseudo-category, one real header appears per actual category
  // present, in a fixed order — Maschinen before Messtechnik.
  // How: checks the category-kind rows' keys are exactly ['fav', 'maschine', 'messtechnik'].
  it('emits a category header per non-favorite category, Maschinen before Messtechnik', () => {
    const rows = buildMachineFilterRows(machines, base);
    expect(rows.filter((r) => r.kind === 'category').map((r) => r.key)).toEqual([
      'fav',
      'maschine',
      'messtechnik',
    ]);
  });

  // What: within an open category, one group header appears per distinct group, in the order
  // those groups were first seen in the machine list.
  // How: opens the 'maschine' category and checks the group-kind rows' labels are in
  // first-seen order.
  it('emits a group header per group within an open category, in first-seen order', () => {
    const rows = buildMachineFilterRows(machines, { ...base, openKeys: new Set(['maschine']) });
    expect(rows.filter((r) => r.kind === 'group').map((r) => r.label)).toEqual([
      'Halle 1',
      'Halle 2',
    ]);
  });

  // What: a machine row only appears when BOTH its category AND its specific group are open
  // — opening just the category isn't enough to reveal its machines.
  // How: checks opening only the category yields zero machine rows, then opening both the
  // category and one specific group reveals exactly that group's machine.
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

  // What: once a search query is active, every header (category and group) disappears and
  // matching machines are shown flat, completely ignoring the open/closed fold state.
  // How: searches for a machine that's normally hidden behind closed headers and checks the
  // result is a flat list of only machine rows.
  it('while searching, every header vanishes and matches ignore fold state entirely', () => {
    const rows = buildMachineFilterRows(machines, { ...base, searchQuery: 'Presse' });
    expect(rows.every((r) => r.kind === 'machine')).toBe(true);
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual(['Presse']);
  });

  // What: search matches against the combined "name group" string, case-insensitively — a
  // query matching only the group name (not the machine's own name) still finds it.
  // How: searches for a group name in uppercase and checks it finds the machine in that group.
  it('search matches against "name group", case-insensitively', () => {
    const rows = buildMachineFilterRows(machines, { ...base, searchQuery: 'HALLE 2' });
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual(['Presse']);
  });

  // What: search finds a favorite machine too, even though its category is normally closed
  // by default — searching bypasses the favorites fold state the same way it bypasses others.
  // How: searches for the favorite machine's name (with default closed openKeys) and checks
  // it's found.
  it('search also matches a closed favorite', () => {
    const rows = buildMachineFilterRows(machines, { ...base, searchQuery: 'favmaschine' });
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual([
      'FavMaschine',
    ]);
  });

  describe('shownCategories (legacy mfShow — filters the LIST, never the grid)', () => {
    // What: a category not in shownCategories is omitted entirely from the list — its header,
    // its groups, and its machines all disappear, even if its fold keys are open.
    // How: opens every fold key for both categories but only shows 'maschine', and checks
    // no messtechnik header or machine row appears.
    it('omits an entire category section (header, groups, machines) when not shown', () => {
      const rows = buildMachineFilterRows(machines, {
        ...base,
        openKeys: new Set(['maschine', 'maschine::Halle 1', 'maschine::Halle 2']),
        shownCategories: new Set(['maschine']),
      });
      expect(rows.some((r) => r.kind === 'category' && r.key === 'messtechnik')).toBe(false);
      expect(rows.some((r) => r.kind === 'machine' && r.machine.id === 'meas1')).toBe(false);
    });

    // What: the favorites pseudo-category is exempt from shownCategories filtering — it shows
    // regardless of which real categories are toggled on/off (favorites aren't a category).
    // How: opens the favorites header with shownCategories completely empty (no real category
    // shown) and checks the favorites header and machine still appear.
    it('always shows favorites regardless of shownCategories', () => {
      const rows = buildMachineFilterRows(machines, {
        ...base,
        openKeys: new Set(['fav']),
        shownCategories: new Set(),
      });
      expect(rows[0]).toEqual({ kind: 'category', key: 'fav', label: '★ Favoriten', open: true });
      expect(rows.some((r) => r.kind === 'machine' && r.machine.id === 'fav1')).toBe(true);
    });

    // What: a category hidden via shownCategories is excluded even from search results — search
    // doesn't bypass this filter the way it bypasses the fold state.
    // How: searches for a machine belonging to the hidden messtechnik category and checks the
    // result is empty.
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
