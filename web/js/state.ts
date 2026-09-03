// =======================================================================================
// REACTIVE STATE STORE MODULE (web/js/state.ts)
// =======================================================================================
//
// Reactive central state store for the frontend application.
//
// Responsibilities:
// 1. Single Source of Truth: Holds the live `AppState` object containing both server data and local UI state.
// 2. Read/Write Access: Provides `get` and `set` methods with TypeScript key safety.
// 3. Reactive Subscriptions: Allows UI components and render triggers to subscribe to state modifications.
// 4. In-Place Merging: Merges updates via `Object.assign` to maintain object identity across views.
//
// =======================================================================================

import type { AppState } from '../../shared/types.ts';

/** Callback listener invoked whenever the store state changes. */
type StateListener = (state: AppState) => void;

/**
 * Public interface of the reactive store.
 */
export interface Store {
  /** The live application state object. */
  state: AppState;
  /** Reads a property from state with strong typing. */
  get<Key extends keyof AppState>(key: Key): AppState[Key];
  /** Shallow-merges `partialState` into the state object and triggers a change notification. */
  set(partialState: Partial<AppState>): void;
  /** Registers a change listener; returns an unsubscribe function. */
  subscribe(listener: StateListener): () => void;
  /** Manually notifies all registered listeners with the current state. */
  notify(): void;
}

/**
 * Factory function creating a reactive `Store` instance around `initialState`.
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
