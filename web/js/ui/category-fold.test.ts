// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppState, Machine } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';
import {
  selectCategory,
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
  // What: toggling a shown category hides it, persists the new set to localStorage, and
  // triggers exactly one store notify (repaint).
  // How: toggles a category present in the initial set and checks it's removed from the
  // live state, the persisted JSON matches, and notify fired once.
  it('removes a currently-shown category, persists, and notifies', () => {
    toggleCategory('maschine');
    expect(window.S.cats.has('maschine')).toBe(false);
    expect(JSON.parse(localStorage.getItem('mb_cats')!)).toEqual(['messtechnik']);
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  // What: toggling a currently-hidden category shows it again — the same function handles
  // both directions.
  // How: starts with the category already hidden, toggles it, and checks it's back in the set.
  it('adds a currently-hidden category back', () => {
    window.S.cats = new Set(['messtechnik']);
    toggleCategory('maschine');
    expect([...window.S.cats].sort()).toEqual(['maschine', 'messtechnik']);
  });
});

describe('selectCategory', () => {
  it('selects exactly one category, persists it, and refreshes the grid', () => {
    selectCategory('messtechnik');
    expect(window.S.cats).toEqual(new Set(['messtechnik']));
    expect(JSON.parse(localStorage.getItem('mb_cats')!)).toEqual(['messtechnik']);
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });
});

describe('toggleAllGroupsInCategory', () => {
  // What: when any group in the category is folded (or the category itself is hidden),
  // toggling shows the category and unfolds every one of its groups — an "any closed → open
  // all" rule, not per-group toggling.
  // How: hides the category and folds both its groups, then toggles and checks the category
  // is shown, both groups are unfolded, the persisted collapsed list is empty, and notify fired.
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

  // What: when every group in the category is already open, toggling flips to the opposite
  // state — collapsing every group in that category, leaving other categories' groups alone.
  // How: starts from the default all-open state, toggles, and checks both of the category's
  // own groups are now collapsed while a group belonging to a different category isn't touched.
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

  // What: a single tap doesn't toggle immediately — it's debounced, only taking effect after
  // the delay elapses (so a rapid double-tap, tested below, can be distinguished from two
  // separate single taps).
  // How: taps once, checks the category is still shown right away, advances past the debounce
  // window, and checks it's now hidden.
  it('toggles the category after the debounce delay', () => {
    categoryTap('maschine');
    expect(window.S.cats.has('maschine')).toBe(true); // not yet
    vi.advanceTimersByTime(220);
    expect(window.S.cats.has('maschine')).toBe(false);
  });

  // What: canceling a pending tap before its delay elapses prevents the toggle from ever
  // happening, and no notify fires for a toggle that never occurred.
  // How: taps, immediately cancels, advances well past the debounce window, and checks the
  // category is unchanged and notify was never called.
  it('categoryTapCancel prevents the pending toggle', () => {
    categoryTap('maschine');
    categoryTapCancel();
    vi.advanceTimersByTime(300);
    expect(window.S.cats.has('maschine')).toBe(true); // never toggled
    expect(notifySpy).not.toHaveBeenCalled();
  });

  // What: a second tap arriving before the first's debounce delay elapses resets the timer
  // rather than stacking up a second pending toggle — only one toggle ever fires.
  // How: taps, advances partway through the delay, taps again (resetting the timer), advances
  // partway again (still pending), then advances past the full delay and checks exactly one
  // toggle (one notify call) happened.
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
