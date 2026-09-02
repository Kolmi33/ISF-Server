// The Assistant's device checklist — pure over `core/machines`; no DOM. Faithful port of
// legacy `machineChecklist`/`wireChecklistFilter`'s row structure and visibility rules: a
// collapsible "★ Favoriten" bucket (open by default, no group sub-level) followed by
// Maschinen/Messtechnik, each split into their groups. While searching, every header vanishes
// and the list is a flat name/group substring match, bypassing fold state entirely — matching
// legacy's `searching` branch exactly.

import type { Machine } from '../../../shared/types.ts';
import { CATEGORIES, categoryOf } from '../core/machines.ts';

const FAVORITES_KEY = 'fav';
const FAVORITES_LABEL = '★ Favoriten';

export type ChecklistRow =
  | { kind: 'category'; key: string; label: string; open: boolean }
  | { kind: 'group'; key: string; label: string; open: boolean }
  | { kind: 'machine'; machine: Machine };

export interface ChecklistOptions {
  favoriteIds: ReadonlySet<string>;
  searchQuery: string;
  /** Folded-open category/group keys — `'fav'`, a `MachineCategory`, or `'<category>::<group>'`. */
  openKeys: ReadonlySet<string>;
}

function matchesSearch(machine: Machine, lowercaseQuery: string): boolean {
  return `${machine.name} ${machine.group}`.toLowerCase().includes(lowercaseQuery);
}

function categoryLabel(category: string): string {
  return CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

function pushFavoriteRows(
  rows: ChecklistRow[],
  favorites: readonly Machine[],
  searching: boolean,
  lowercaseQuery: string,
  openKeys: ReadonlySet<string>,
): void {
  if (!favorites.length) return;
  if (!searching)
    rows.push({
      kind: 'category',
      key: FAVORITES_KEY,
      label: FAVORITES_LABEL,
      open: openKeys.has(FAVORITES_KEY),
    });
  const categoryOpen = searching || openKeys.has(FAVORITES_KEY);
  for (const machine of favorites) {
    const visible = searching ? matchesSearch(machine, lowercaseQuery) : categoryOpen;
    if (visible) rows.push({ kind: 'machine', machine });
  }
}

function pushNonFavoriteRows(
  rows: ChecklistRow[],
  rest: readonly Machine[],
  searching: boolean,
  lowercaseQuery: string,
  openKeys: ReadonlySet<string>,
): void {
  let currentCategory: string | null = null;
  let currentGroupKey: string | null = null;
  for (const machine of rest) {
    const category = categoryOf(machine);
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
      ? matchesSearch(machine, lowercaseQuery)
      : openKeys.has(category) && openKeys.has(groupKey);
    if (visible) rows.push({ kind: 'machine', machine });
  }
}

/**
 * The checklist's rows, in legacy's exact display order: favorites (flat, no groups), then
 * Maschinen before Messtechnik, each split into groups. `machines` is expected pre-ordered
 * (favorites first) — pass `orderedMachines()`'s result. Faithful port of
 * `machineChecklist`/`wireChecklistFilter`'s combined structure + visibility.
 */
export function buildChecklistRows(
  machines: readonly Machine[],
  options: ChecklistOptions,
): ChecklistRow[] {
  const { favoriteIds, searchQuery, openKeys } = options;
  const lowercaseQuery = searchQuery.trim().toLowerCase();
  const searching = !!lowercaseQuery;
  const favorites = machines.filter((m) => favoriteIds.has(m.id));
  const rest = machines.filter((m) => !favoriteIds.has(m.id));
  const rows: ChecklistRow[] = [];
  pushFavoriteRows(rows, favorites, searching, lowercaseQuery, openKeys);
  pushNonFavoriteRows(rows, rest, searching, lowercaseQuery, openKeys);
  return rows;
}
