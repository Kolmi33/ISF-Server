// O(1) machine lookup by id (Phase 7 slice B10f). Faithful port of legacy `machById` — a
// memoized `Map`, rebuilt whenever `S.data.machines` is replaced by a new array reference
// (`readFile`'s full reload does this) OR when explicitly told to via
// `invalidateMachineLookupCache()`. That second path exists because `core/booking.ts`'s
// machine CRUD (`saveMachine`/`deleteMachine`/`moveMachine`) mutates the `machines` array IN
// PLACE (`.splice()`, element swap) rather than replacing it — the array reference alone
// can't tell this cache a machine was added or removed (bug found in review, fixed here;
// edits/reorders are unaffected since they mutate/swap the same cached object references,
// which the Map already points at). `ui/mutate.ts` calls the invalidation hook after any
// machine-structural mutate() call — see its own comment for the exact signal it uses.
//
// Every caller imports this directly (F8 cleanup, ARCHITECTURE_AUDIT.md) — it's otherwise a
// pure function with no dependents of its own, so there was never a cycle risk, only
// historical convenience.

import type { Machine } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';

let cache: Map<string, Machine> | null = null;
let cachedMachines: readonly Machine[] | null | undefined;

export function machById(id: string): Machine | undefined {
  const data = store.get('data');
  const currentMachines = data && data.machines;
  if (!cache || cachedMachines !== currentMachines) {
    cachedMachines = currentMachines;
    cache = new Map((currentMachines || []).map((machine) => [machine.id, machine]));
  }
  return cache.get(id);
}

/** Force the next `machById` call to rebuild its cache, even though `S.data.machines`'s own
 *  array reference hasn't changed. See the file header for why this is needed. */
export function invalidateMachineLookupCache(): void {
  cache = null;
}
