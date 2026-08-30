// The state store — owner of the frontend runtime state (ARCHITECTURE §14).
//
// `createStore` is PURE: the initial state is injected (E4), so the store is unit-tested
// in Node with no `localStorage`/DOM. `app.ts` hydrates the real initial state (localStorage
// + `mondayOfDate(new Date())`) and bridges the live object as `window.S`, the legacy compat
// alias. `store` is the canonical abstraction from Phase 3.1 on; `window.S` only shrinks
// (migration rule, §14). The store mutates its state object IN PLACE so the bridged
// `window.S` reference legacy holds stays valid.
//
// D2 (§14): subscribe/notify is built and tested now but not yet wired to `render()`.
// Its first consumer is SSE in Phase 3.3; UI reactivity is revisited in Phase 4.

import type { AppState } from '../../shared/types.ts';

/** A function notified with the current state every time the store changes. */
type StateListener = (state: AppState) => void;

export interface Store {
  /** The live state object (bridged as `window.S`; same reference throughout). */
  state: AppState;
  get<Key extends keyof AppState>(key: Key): AppState[Key];
  /** Shallow-merge `partialState` into state (in place), then `notify()`. */
  set(partialState: Partial<AppState>): void;
  /** Register a subscriber; returns an unsubscribe function. */
  subscribe(listener: StateListener): () => void;
  notify(): void;
}

export function createStore(initialState: AppState): Store {
  const state = initialState;
  const subscribers = new Set<StateListener>();
  const store: Store = {
    state,
    get(key) {
      return state[key];
    },
    set(partialState) {
      Object.assign(state, partialState);
      store.notify();
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    notify() {
      for (const listener of subscribers) listener(state);
    },
  };
  return store;
}
