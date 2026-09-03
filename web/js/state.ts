// =======================================================================================
// STATE STORE MODULE (web/js/state.ts)
// =======================================================================================
//
// The state store — owner of the frontend runtime state (ARCHITECTURE §14).
// This module provides:
// 1. `createStore`: builds a store around an injected initial state.
// 2. A get/set/subscribe/notify API every reader and writer of app state goes through.
//
// Key Principles:
// - PURE FACTORY: the initial state is injected (E4) rather than read from
//   `localStorage`/the DOM directly, so the store is unit-tested in plain Node.
//   `store-instance.ts` is the one place that actually hydrates the real initial state and
//   bridges it as `window.S`, the legacy compat alias.
// - MUTATES IN PLACE: the store mutates its state object in place (`Object.assign`, not a
//   fresh object per update) so the bridged `window.S` reference legacy code holds stays
//   valid — a fresh object each time would silently desync the two.
//
// =======================================================================================

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

/**
 * Builds a `Store` around `initialState`.
 *
 * How it works: `set` shallow-merges its argument into the live state object (in place,
 * not a replacement) then calls `notify`; `notify` simply calls every subscriber with the
 * current state. There's no diffing or batching — a caller that sets several fields in a
 * row and wants only one repaint should call `set` once with all of them together.
 */
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
