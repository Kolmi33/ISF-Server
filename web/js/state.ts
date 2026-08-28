// The state store — owner of the frontend runtime state (ARCHITECTURE §14).
//
// `createStore` is PURE: the initial state is injected (E4), so the store is unit-tested
// in Node with no `localStorage`/DOM. `app.ts` hydrates the real initial state (localStorage
// + `mondayOf(new Date())`) and bridges the live object as `window.S`, the legacy compat
// alias. `store` is the canonical abstraction from Phase 3.1 on; `window.S` only shrinks
// (migration rule, §14). The store mutates its state object IN PLACE so the bridged
// `window.S` reference legacy holds stays valid.
//
// D2 (§14): subscribe/notify is built and tested now but not yet wired to `render()`.
// Its first consumer is SSE in Phase 3.3; UI reactivity is revisited in Phase 4.

import type { AppState } from '../../shared/types.ts';

export interface Store {
  /** The live state object (bridged as `window.S`; same reference throughout). */
  state: AppState;
  get<K extends keyof AppState>(k: K): AppState[K];
  /** Shallow-merge `patch` into state (in place), then `notify()`. */
  set(patch: Partial<AppState>): void;
  /** Register a subscriber; returns an unsubscribe function. */
  subscribe(fn: (s: AppState) => void): () => void;
  notify(): void;
}

export function createStore(initial: AppState): Store {
  const state = initial;
  const subs = new Set<(s: AppState) => void>();
  const store: Store = {
    state,
    get(k) {
      return state[k];
    },
    set(patch) {
      Object.assign(state, patch);
      store.notify();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    notify() {
      for (const fn of subs) fn(state);
    },
  };
  return store;
}
