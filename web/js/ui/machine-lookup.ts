// =======================================================================================
// MACHINE LOOKUP MODULE (web/js/ui/machine-lookup.ts)
// =======================================================================================
//
// O(1) machine lookup by id: a memoized `Map`, rebuilt whenever `store`'s machine list is
// replaced by a new array reference, or whenever explicitly invalidated.
//
// Key Principles:
// - CACHE INVALIDATION IS EXPLICIT, NOT JUST REFERENCE-BASED: `core/machines.ts`'s machine
//   CRUD (`saveMachine`/`deleteMachine`/`moveMachine`) mutates the `machines` array IN
//   PLACE (`.splice()`, element swap) rather than replacing it — the array reference alone
//   can't tell this cache a machine was added or removed, since the reference never
//   actually changes. `invalidateMachineLookupCache()` exists for exactly that gap;
//   `ui/mutate.ts` calls it after any structural mutate() call. An edit or a reorder is
//   unaffected either way, since those mutate/swap the same cached object references the
//   Map already points at.
//
// =======================================================================================

import type { Machine } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';

let cache: Map<string, Machine> | null = null;
let cachedMachines: readonly Machine[] | null | undefined;

/**
 * Looks up a machine by id in O(1).
 *
 * How it works: rebuilds the cache Map only when the machine list's array reference has
 * changed since the last call (a cheap `!==` check) — repeated lookups against the same
 * unchanged list are pure Map reads with no rebuild cost.
 */
export function machById(id: string): Machine | undefined {
  const data = store.get('data');
  const currentMachines = data && data.machines;
  if (!cache || cachedMachines !== currentMachines) {
    cachedMachines = currentMachines;
    cache = new Map((currentMachines || []).map((machine) => [machine.id, machine]));
  }
  return cache.get(id);
}

/** Forces the next {@link machById} call to rebuild its cache, even though the machine
 *  list's own array reference hasn't changed — see the file header for why this is needed. */
export function invalidateMachineLookupCache(): void {
  cache = null;
}
