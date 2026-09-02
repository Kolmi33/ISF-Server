// The grid's own category (Maschinen/Messtechnik) ein-/ausklappen (Phase 7 slice B10e).
// Faithful port of legacy `toggleCat`/`toggleAllGroupsInCat`/`catTap`/`catTapCancel`. Entirely
// separate from — and unrelated to — the "Filtern" dropdown's `mfShow`
// (`ui/components/MachineFilterDropdown.tsx`), which only toggles what's shown INSIDE that
// dropdown's own list, never the grid itself (legacy's own comment is explicit about this).
// Called from `ui/components/Grid.tsx` (B1) and `ui/grid-interaction.ts` (B2), both already
// gated — imported directly rather than kept behind the window bridge.
//
// legacy's own `groupCat` (a `group name → category` lookup, defined alongside these) had no
// remaining callers anywhere — confirmed dead and deleted outright, not ported.

import { categoryOf } from '../core/machines-queries.ts';
import { store } from '../store-instance.ts';

/** Toggle whether `category`'s rows are shown in the grid at all. Faithful port of legacy
 *  `toggleCat`. */
export function toggleCategory(category: string): void {
  const cats = store.get('cats');
  if (cats.has(category)) cats.delete(category);
  else cats.add(category);
  localStorage.setItem('mb_cats', JSON.stringify([...cats]));
  store.notify();
}

/** Expand or collapse every group within `category` at once (a double-click on its header/
 *  toggle button): all-open → all-closed, otherwise all-open (and the category itself opened).
 *  Faithful port of legacy `toggleAllGroupsInCat`. */
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
        .machines.filter((machine) => categoryOf(machine) === category)
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

/** A single click on the category toggle: debounced 220ms so a double-click doesn't also fire
 *  the single-click toggle. Faithful port of legacy `catTap`. */
export function categoryTap(category: string): void {
  if (categoryTapTimer) clearTimeout(categoryTapTimer);
  categoryTapTimer = setTimeout(() => toggleCategory(category), 220);
}

/** Cancel a pending single-click toggle — called on double-click, before
 *  `toggleAllGroupsInCategory` runs. Faithful port of legacy `catTapCancel`. */
export function categoryTapCancel(): void {
  if (categoryTapTimer) clearTimeout(categoryTapTimer);
}
