// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppState, Machine } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';
import {
  toggleCategory,
  toggleAllGroupsInCategory,
  categoryTap,
  categoryTapCancel,
} from './category-fold.ts';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'M1', group: 'Halle 1', ...overrides };
}

// category-fold.ts now reads/writes state via the real `store` singleton — spied once here
// (call history cleared per test below) rather than relying on a mocked window.notify.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  store.set({
    cats: new Set(['maschine', 'messtechnik']),
    collapsed: new Set(),
    data: {
      machines: [
        machine({ id: 'm1', group: 'Halle 1' }),
        machine({ id: 'm2', group: 'Halle 2' }),
        machine({ id: 'm3', group: 'Labor', cat: 'messtechnik' }),
      ],
      bookings: {},
    },
  } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
  localStorage.clear();
});

describe('toggleCategory', () => {
  it('removes a currently-shown category, persists, and notifies', () => {
    toggleCategory('maschine');
    expect(window.S.cats.has('maschine')).toBe(false);
    expect(JSON.parse(localStorage.getItem('mb_cats')!)).toEqual(['messtechnik']);
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('adds a currently-hidden category back', () => {
    window.S.cats = new Set(['messtechnik']);
    toggleCategory('maschine');
    expect([...window.S.cats].sort()).toEqual(['maschine', 'messtechnik']);
  });
});

describe('toggleAllGroupsInCategory', () => {
  it('opens every group in the category and the category itself, when any are closed', () => {
    window.S.cats = new Set(['messtechnik']); // maschine currently hidden
    window.S.collapsed = new Set(['Halle 1', 'Halle 2']);
    toggleAllGroupsInCategory('maschine');
    expect(window.S.cats.has('maschine')).toBe(true);
    expect(window.S.collapsed.has('Halle 1')).toBe(false);
    expect(window.S.collapsed.has('Halle 2')).toBe(false);
    expect(JSON.parse(localStorage.getItem('mb_collapsed')!)).toEqual([]);
    expect(notifySpy).toHaveBeenCalled();
  });

  it('collapses every group in the category when all are already open', () => {
    toggleAllGroupsInCategory('maschine');
    expect(window.S.collapsed.has('Halle 1')).toBe(true);
    expect(window.S.collapsed.has('Halle 2')).toBe(true);
    expect(window.S.collapsed.has('Labor')).toBe(false); // a different category, untouched
  });
});

describe('categoryTap / categoryTapCancel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('toggles the category after the debounce delay', () => {
    categoryTap('maschine');
    expect(window.S.cats.has('maschine')).toBe(true); // not yet
    vi.advanceTimersByTime(220);
    expect(window.S.cats.has('maschine')).toBe(false);
  });

  it('categoryTapCancel prevents the pending toggle', () => {
    categoryTap('maschine');
    categoryTapCancel();
    vi.advanceTimersByTime(300);
    expect(window.S.cats.has('maschine')).toBe(true); // never toggled
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('a second tap before the delay resets the debounce (only one toggle fires)', () => {
    categoryTap('maschine');
    vi.advanceTimersByTime(100);
    categoryTap('maschine');
    vi.advanceTimersByTime(100);
    expect(window.S.cats.has('maschine')).toBe(true); // still pending
    vi.advanceTimersByTime(120);
    expect(window.S.cats.has('maschine')).toBe(false);
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });
});
