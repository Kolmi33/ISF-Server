// The toolbar "Filtern ▾" resource-filter dropdown (Phase 7 slice B10e). Faithful port of
// legacy `fillMachSel`'s row structure and visibility rules — the pure, testable half; the
// DOM/React half is `ui/components/MachineFilterDropdown.tsx`. Same collapsible-tree shape as
// `ui/assistant-checklist.ts` (B7) — favorites (flat, no groups) then Maschinen/Messtechnik,
// each split into groups, deliberately duplicated rather than shared (the two features evolve
// independently and this one has an extra knob, below) — plus one addition: legacy's own
// `mfShow` toggle, which hides an entire category's section from the list altogether,
// independent of fold state. Legacy's own comment is explicit that this affects ONLY the
// dropdown's own list, never the grid (that's `ui/category-fold.ts`, a separate feature).

import type { Machine, MachineCategory } from '../../../shared/types.ts';
import { CATEGORIES, categoryOf } from '../core/machines-queries.ts';

const FAVORITES_KEY = 'fav';
const FAVORITES_LABEL = '★ Favoriten';

export type MachineFilterRow =
  | { kind: 'category'; key: string; label: string; open: boolean }
  | { kind: 'group'; key: string; label: string; open: boolean }
  | { kind: 'machine'; machine: Machine };

export interface MachineFilterOptions {
  favoriteIds: ReadonlySet<string>;
  searchQuery: string;
  /** Folded-open category/group keys — `'fav'`, a `MachineCategory`, or `'<category>::<group>'`.
   *  Legacy's `mfOpenCat`/`mfOpenGrp`, merged into one set since their keys never collide. */
  openKeys: ReadonlySet<string>;
  /** Which categories' sections appear in the list at all, independent of `openKeys` —
   *  legacy's `mfShow`. Favorites are always shown regardless. */
  shownCategories: ReadonlySet<MachineCategory>;
}

function matchesQuery(machine: Machine, lowercaseQuery: string): boolean {
  return `${machine.name} ${machine.group}`.toLowerCase().includes(lowercaseQuery);
}

function categoryLabel(category: string): string {
  return CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

function pushFavoriteRows(
  rows: MachineFilterRow[],
  favorites: readonly Machine[],
  searching: boolean,
  lowercaseQuery: string,
  openKeys: ReadonlySet<string>,
): void {
  if (!favorites.length) return;
  if (!searching) {
    rows.push({
      kind: 'category',
      key: FAVORITES_KEY,
      label: FAVORITES_LABEL,
      open: openKeys.has(FAVORITES_KEY),
    });
  }
  const categoryOpen = openKeys.has(FAVORITES_KEY);
  for (const machine of favorites) {
    const visible = searching ? matchesQuery(machine, lowercaseQuery) : categoryOpen;
    if (visible) rows.push({ kind: 'machine', machine });
  }
}

function pushNonFavoriteRows(
  rows: MachineFilterRow[],
  rest: readonly Machine[],
  searching: boolean,
  lowercaseQuery: string,
  openKeys: ReadonlySet<string>,
  shownCategories: ReadonlySet<MachineCategory>,
): void {
  let currentCategory: MachineCategory | null = null;
  let currentGroupKey: string | null = null;
  for (const machine of rest) {
    const category = categoryOf(machine);
    if (!shownCategories.has(category)) continue;
    if (category !== currentCategory) {
      currentCategory = category;
      currentGroupKey = null;
      if (!searching) {
        rows.push({
          kind: 'category',
          key: category,
          label: categoryLabel(category),
          open: openKeys.has(category),
        });
      }
    }
    const groupKey = `${category}::${machine.group}`;
    if (groupKey !== currentGroupKey) {
      currentGroupKey = groupKey;
      if (!searching && openKeys.has(category)) {
        rows.push({
          kind: 'group',
          key: groupKey,
          label: machine.group,
          open: openKeys.has(groupKey),
        });
      }
    }
    const visible = searching
      ? matchesQuery(machine, lowercaseQuery)
      : openKeys.has(category) && openKeys.has(groupKey);
    if (visible) rows.push({ kind: 'machine', machine });
  }
}

/**
 * The dropdown's rows, in legacy's exact display order: favorites (flat, no groups), then
 * Maschinen before Messtechnik, each split into groups. `machines` is expected pre-ordered
 * (favorites first) — pass `orderedMachines()`'s (`ui/grid.ts`) result. Faithful port of
 * `fillMachSel`'s combined structure + visibility.
 */
export function buildMachineFilterRows(
  machines: readonly Machine[],
  options: MachineFilterOptions,
): MachineFilterRow[] {
  const { favoriteIds, searchQuery, openKeys, shownCategories } = options;
  const lowercaseQuery = searchQuery.trim().toLowerCase();
  const searching = !!lowercaseQuery;
  const favorites = machines.filter((m) => favoriteIds.has(m.id));
  const rest = machines.filter((m) => !favoriteIds.has(m.id));
  const rows: MachineFilterRow[] = [];
  pushFavoriteRows(rows, favorites, searching, lowercaseQuery, openKeys);
  pushNonFavoriteRows(rows, rest, searching, lowercaseQuery, openKeys, shownCategories);
  return rows;
}
