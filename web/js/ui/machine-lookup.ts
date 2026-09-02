// O(1) machine lookup by id (Phase 7 slice B10f). Faithful port of legacy `machById` — a
// memoized `Map`, rebuilt automatically whenever `S.data.machines` is replaced by a new array
// reference (this app never mutates that array in place — every write replaces it wholesale,
// e.g. the machine form's save/delete, `readFile`'s reload). Every caller imports this
// directly (F8 cleanup, ARCHITECTURE_AUDIT.md) — it's a pure function with no dependents of
// its own, so there was never a cycle risk, only historical convenience.

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
