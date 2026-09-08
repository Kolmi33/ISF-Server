// =======================================================================================
// CATEGORY FOLD/UNFOLD MODULE (web/js/ui/category-fold.ts)
// =======================================================================================
//
// The grid's own category (Maschinen/Messtechnik) collapse/expand controls.
// This module:
// 1. Toggles whether a whole category's rows show in the grid at all.
// 2. Expands or collapses every group within a category at once.
// 3. Debounces the single-click toggle so a double-click doesn't also fire it.
//
// Key Principles:
// - DISTINCT FROM THE FILTER DROPDOWN: entirely separate from — and unrelated to — the
//   "Filtern" dropdown's own show/hide (`ui/components/MachineFilterDropdown.tsx`), which
//   only toggles what's shown INSIDE that dropdown's own list, never the grid itself.
// - PLAIN MODULE, DIRECTLY IMPORTED: called from `ui/components/Grid.tsx` and
//   `ui/grid-interaction.ts`, both already gated — imported directly rather than kept
//   behind the window bridge.
//
// =======================================================================================

import { getMachineCategory } from '../core/machines.ts';
import { store } from '../store-instance.ts';

/** Toggles whether `category`'s rows are shown in the grid at all, persisting the choice. */
export function toggleCategory(category: string): void {
  const cats = store.get('cats');
  if (cats.has(category)) cats.delete(category);
  else cats.add(category);
  localStorage.setItem('mb_cats', JSON.stringify([...cats]));
  store.notify();
}

/** Selects exactly one main-grid category, as required by the segmented tab in the reference UI. */
export function selectCategory(category: string): void {
  store.state.cats = new Set([category]);
  localStorage.setItem('mb_cats', JSON.stringify([category]));
  store.notify();
}

/**
 * Expands or collapses every group within `category` at once — a double-click on its
 * header/toggle button.
 *
 * How it works: if every one of the category's groups is already open, this collapses all
 * of them; otherwise it opens all of them (and, if the category itself was hidden, shows it
 * too — a double-click always ends with something visible, never a fully collapsed category).
 */
export function toggleAllGroupsInCategory(category: string): void {
  const cats = store.get('cats');
  if (!cats.has(category)) {
    cats.add(category);
    localStorage.setItem('mb_cats', JSON.stringify([...cats]));
  }
  const groups = [
    ...new Set(
      store
        .get('data')!
        .machines.filter((machine) => getMachineCategory(machine) === category)
        .map((machine) => machine.group),
    ),
  ];
  const collapsed = store.get('collapsed');
  const allOpen = groups.every((group) => !collapsed.has(group));
  for (const group of groups) {
    if (allOpen) collapsed.add(group);
    else collapsed.delete(group);
  }
  localStorage.setItem('mb_collapsed', JSON.stringify([...collapsed]));
  store.notify();
}

let categoryTapTimer: ReturnType<typeof setTimeout> | null = null;

/** Handles a single click on the category toggle: debounced 220ms so a double-click doesn't
 *  also fire the single-click toggle in between. */
export function categoryTap(category: string): void {
  if (categoryTapTimer) clearTimeout(categoryTapTimer);
  categoryTapTimer = setTimeout(() => toggleCategory(category), 220);
}

/** Cancels a pending single-click toggle — called the instant a double-click is detected,
 *  before {@link toggleAllGroupsInCategory} runs, so the two never both fire for one gesture. */
export function categoryTapCancel(): void {
  if (categoryTapTimer) clearTimeout(categoryTapTimer);
}
