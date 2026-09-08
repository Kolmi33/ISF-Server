import { describe, it, expect, vi } from 'vitest';
import type { AppState } from '../../shared/types.ts';
import { createStore } from './state.ts';

// A minimal, valid AppState for the store's mechanics (contents are irrelevant to the store).
function initial(): AppState {
  return {
    data: null,
    readOnly: false,
    user: 'anna',
    startMonday: new Date('2021-01-04T00:00:00Z'),
    weeks: 2,
    extraWeeks: 0,
    machSel: new Set(),
    groupsSel: new Set(),
    cats: new Set(['maschine']),
    collapsed: new Set(),
    person: '',
    personOnly: false,
    gridQuery: '',
    gridAvailableOnly: false,
    gridOperationalOnly: false,
    gridFavoritesOnly: false,
    favs: new Set(),
    visM: [],
    visD: [],
  };
}

describe('createStore', () => {
  // What: the store wraps the given state object by reference, not a copy — the same object
  // `app.ts` bridges as `window.S`, so mutating it in place must stay visible everywhere.
  // How: creates a store from a known object and checks `store.state` is that exact reference.
  it('exposes the injected object by reference (the bridged window.S)', () => {
    const init = initial();
    const store = createStore(init);
    expect(store.state).toBe(init); // same reference, not a copy
  });

  // What: get reads back whatever value is currently on that field.
  // How: checks two different fields' values against the known initial state.
  it('get returns the current field value', () => {
    const store = createStore(initial());
    expect(store.get('user')).toBe('anna');
    expect(store.get('weeks')).toBe(2);
  });

  // What: set shallow-merges the given fields into the SAME state object (mutates in place)
  // rather than replacing it with a new object, and any field not mentioned is left alone.
  // How: captures the state reference before a set() with two fields, checks the reference is
  // unchanged afterward, both given fields updated, and an untouched field kept its old value.
  it('set shallow-merges in place and keeps the same object reference', () => {
    const store = createStore(initial());
    const before = store.state;
    store.set({ user: 'bob', weeks: 5 });
    expect(store.state).toBe(before); // mutated in place, not replaced
    expect(store.get('user')).toBe('bob');
    expect(store.get('weeks')).toBe(5);
    expect(store.get('readOnly')).toBe(false); // untouched fields survive
  });

  // What: calling set also notifies every subscriber, passing the (mutated) state object.
  // How: subscribes a spy, calls set with one field, and checks the spy fired once with the
  // store's state object.
  it('set notifies subscribers with the state', () => {
    const store = createStore(initial());
    const seen = vi.fn();
    store.subscribe(seen);
    store.set({ readOnly: true });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(store.state);
    expect(store.get('readOnly')).toBe(true);
  });

  // What: notify() (called directly, not via set) reaches every subscriber, not just the first.
  // How: subscribes two independent spies and checks both fired exactly once after one notify() call.
  it('notify calls every subscriber', () => {
    const store = createStore(initial());
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);
    store.notify();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  // What: the function subscribe() returns actually unsubscribes — a later notify() no longer
  // reaches that listener.
  // How: subscribes a spy, notifies once (spy fires), calls the returned unsubscribe, notifies
  // again, and checks the spy's call count didn't increase.
  it('subscribe returns an unsubscribe that stops further notifications', () => {
    const store = createStore(initial());
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.notify();
    off();
    store.notify();
    expect(fn).toHaveBeenCalledTimes(1); // only the first notify reached it
  });
});
