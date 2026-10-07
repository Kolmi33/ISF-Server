// =======================================================================================
// ASSISTANT CHECKLIST MODULE (web/js/ui/assistant-checklist.ts)
// =======================================================================================
//
// The Assistant's device checklist — pure over `core/machines`; no DOM.
// This module builds the checklist's row list, in a fixed display order:
// 1. A collapsible "★ Favoriten" bucket (open by default, no group sub-level).
// 2. Maschinen, then Messtechnik, each split into their own groups.
//
// Key Principles:
// - SEARCH BYPASSES FOLD STATE: while searching, every category/group header vanishes and
//   the list becomes a flat name/group substring match — a search result should never be
//   hidden just because its group happens to be collapsed.
//
// =======================================================================================

import type { Machine } from '../../../shared/types.ts';
import { CATEGORIES, getMachineCategory, partitionFavoriteMachines } from '../core/machines.ts';

const FAVORITES_KEY = 'fav';
const FAVORITES_LABEL = '★ Favoriten';

export type ChecklistRow =
  | { kind: 'category'; key: string; label: string; open: boolean; icon: string }
  | { kind: 'group'; key: string; label: string; open: boolean }
  | { kind: 'machine'; machine: Machine };

/** The `Icon` name for a category header — a star for the favorites bucket, otherwise
 *  whichever icon `CATEGORIES` (`core/machines.ts`) already carries for that category. */
function categoryIcon(category: string): string {
  return category === FAVORITES_KEY
    ? 'star'
    : (CATEGORIES.find((c) => c.id === category)?.icon ?? 'factory');
}

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

/** Appends the favorites bucket's rows: a header (unless searching) followed by every
 *  favorite machine that's currently visible — visible means "matches the search" while
 *  searching, or "the favorites bucket is open" otherwise. */
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
      icon: categoryIcon(FAVORITES_KEY),
    });
  const categoryOpen = searching || openKeys.has(FAVORITES_KEY);
  for (const machine of favorites) {
    const visible = searching ? matchesSearch(machine, lowercaseQuery) : categoryOpen;
    if (visible) rows.push({ kind: 'machine', machine });
  }
}

/**
 * Appends the non-favorite rows, walking `rest` once and emitting a category header each
 * time the category changes, a group header each time the group changes (only while that
 * category is open), and each machine row when it should actually be visible — the same
 * three-level nesting (category > group > machine) the checklist displays, built in a
 * single linear pass since `rest` is expected pre-sorted by category then group.
 */
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
    const category = getMachineCategory(machine);
    if (category !== currentCategory) {
      currentCategory = category;
      currentGroupKey = null;
      if (!searching) {
        rows.push({
          kind: 'category',
          key: category,
          label: categoryLabel(category),
          open: openKeys.has(category),
          icon: categoryIcon(category),
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
 * Builds the checklist's full row list, in display order: favorites (flat, no groups),
 * then Maschinen before Messtechnik, each split into groups.
 *
 * `machines` is expected pre-ordered (favorites first) — pass `orderedMachines()`'s result.
 */
export function buildChecklistRows(
  machines: readonly Machine[],
  options: ChecklistOptions,
): ChecklistRow[] {
  const { favoriteIds, searchQuery, openKeys } = options;
  const lowercaseQuery = searchQuery.trim().toLowerCase();
  const searching = !!lowercaseQuery;
  const { favorites, rest } = partitionFavoriteMachines(machines, favoriteIds);
  const rows: ChecklistRow[] = [];
  pushFavoriteRows(rows, favorites, searching, lowercaseQuery, openKeys);
  pushNonFavoriteRows(rows, rest, searching, lowercaseQuery, openKeys);
  return rows;
}
