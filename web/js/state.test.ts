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
    favs: new Set(),
    visM: [],
    visD: [],
  };
}

describe('createStore', () => {
  it('exposes the injected object by reference (the bridged window.S)', () => {
    const init = initial();
    const store = createStore(init);
    expect(store.state).toBe(init); // same reference, not a copy
  });

  it('get returns the current field value', () => {
    const store = createStore(initial());
    expect(store.get('user')).toBe('anna');
    expect(store.get('weeks')).toBe(2);
  });

  it('set shallow-merges in place and keeps the same object reference', () => {
    const store = createStore(initial());
    const before = store.state;
    store.set({ user: 'bob', weeks: 5 });
    expect(store.state).toBe(before); // mutated in place, not replaced
    expect(store.get('user')).toBe('bob');
    expect(store.get('weeks')).toBe(5);
    expect(store.get('readOnly')).toBe(false); // untouched fields survive
  });

  it('set notifies subscribers with the state', () => {
    const store = createStore(initial());
    const seen = vi.fn();
    store.subscribe(seen);
    store.set({ readOnly: true });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(store.state);
    expect(store.get('readOnly')).toBe(true);
  });

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
