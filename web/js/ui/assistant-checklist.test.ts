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
  // What: favorite machines get their own "★ Favoriten" pseudo-category header (not a real
  // category/group), whose open/closed state is driven by openKeys like any other header —
  // the same row-building shape `machine-filter.ts`'s buildMachineFilterRows uses.
  // How: opens the 'fav' key and checks the header row's exact shape plus the favorite
  // machine row right after it.
  it('shows a "★ Favoriten" category header (open state reflects openKeys) with no group sub-level', () => {
    const rows = buildChecklistRows(machines, { ...noneOpen, openKeys: new Set(['fav']) });
    expect(rows[0]).toEqual({ kind: 'category', key: 'fav', label: '★ Favoriten', open: true });
    expect(rows[1]).toEqual({ kind: 'machine', machine: fav });
  });

  // What: with the favorites header closed (the default state), the favorite machine's row
  // doesn't appear at all.
  // How: builds rows with default (closed) openKeys and checks no row is the favorite machine.
  it('hides favorite machines when the favorites category is closed', () => {
    const rows = buildChecklistRows(machines, noneOpen);
    expect(rows.filter((r) => r.kind === 'machine' && r.machine.id === 'fav1')).toEqual([]);
  });

  // What: when there are no favorite machines at all, the favorites header doesn't appear
  // either — unlike the real categories, an empty favorites section is omitted entirely.
  // How: builds rows from a machine list/favorites set with no favorites and checks no
  // category row uses the 'fav' key.
  it('omits the favorites category header entirely when there are no favorites', () => {
    const rows = buildChecklistRows(orderedMachines([m1], new Set()), {
      ...noneOpen,
      favoriteIds: new Set(),
    });
    expect(rows.some((r) => r.kind === 'category' && r.key === 'fav')).toBe(false);
  });

  // What: besides the favorites pseudo-category, one real header appears per actual category
  // present, in a fixed order — Maschinen before Messtechnik.
  // How: checks the category-kind rows' keys are exactly ['fav', 'maschine', 'messtechnik'].
  it('emits a category header per non-favorite category, Maschinen before Messtechnik', () => {
    const rows = buildChecklistRows(machines, noneOpen);
    const categoryKeys = rows.filter((r) => r.kind === 'category').map((r) => r.key);
    expect(categoryKeys).toEqual(['fav', 'maschine', 'messtechnik']);
  });

  // What: within an open category, one group header appears per distinct group, in the order
  // those groups were first seen in the machine list.
  // How: opens the 'maschine' category and checks the group-kind rows' labels are in
  // first-seen order.
  it('emits a group header per group within an open category, in first-seen order', () => {
    const rows = buildChecklistRows(machines, { ...noneOpen, openKeys: new Set(['maschine']) });
    const groups = rows.filter((r) => r.kind === 'group');
    expect(groups.map((r) => r.label)).toEqual(['Halle 1', 'Halle 2']);
  });

  // What: a machine row only appears when BOTH its category AND its specific group are open
  // — opening just the category isn't enough to reveal its machines.
  // How: checks opening only the category yields zero machine rows, then opening both the
  // category and one specific group reveals exactly that group's machine.
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

  // What: a group header never appears while its parent category is closed — group headers
  // only exist inside an already-open category.
  // How: builds rows with every category closed (the default) and checks no group rows appear.
  it('a group header only appears when its category is open', () => {
    const rows = buildChecklistRows(machines, noneOpen);
    expect(rows.filter((r) => r.kind === 'group')).toEqual([]);
  });

  // What: once a search query is active, every header (category and group) disappears and
  // matching machines are shown flat, completely ignoring the open/closed fold state.
  // How: searches for a machine that's normally hidden behind closed headers and checks the
  // result is a flat list of only machine rows.
  it('while searching, every header vanishes and matches ignore fold state entirely', () => {
    const rows = buildChecklistRows(machines, { ...noneOpen, searchQuery: 'Presse' });
    expect(rows.every((r) => r.kind === 'machine')).toBe(true);
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual(['Presse']);
  });

  // What: search matches against the combined "name group" string, case-insensitively.
  // How: searches for a group name in uppercase and checks it finds the machine in that group.
  it('search matches against "name group", case-insensitively', () => {
    const rows = buildChecklistRows(machines, { ...noneOpen, searchQuery: 'HALLE 2' });
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual(['Presse']);
  });

  // What: search finds a favorite machine too, even though its category is normally closed
  // by default.
  // How: searches for the favorite machine's name (with default closed openKeys) and checks
  // it's found.
  it('search also matches a closed favorite', () => {
    const rows = buildChecklistRows(machines, { ...noneOpen, searchQuery: 'favmaschine' });
    expect(rows.map((r) => (r.kind === 'machine' ? r.machine.name : null))).toEqual([
      'FavMaschine',
    ]);
  });
});
