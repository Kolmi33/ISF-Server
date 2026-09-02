// O(1) machine lookup by id (Phase 7 slice B10f). Faithful port of legacy `machById` — a
// memoized `Map`, rebuilt automatically whenever `S.data.machines` is replaced by a new array
// reference (this app never mutates that array in place — every write replaces it wholesale,
// e.g. the machine form's save/delete, `readFile`'s reload). Kept window-bridged rather than
// converted to direct imports: it has dozens of call sites across already-gated components.

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
