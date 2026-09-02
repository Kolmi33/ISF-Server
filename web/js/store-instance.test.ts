// @vitest-environment jsdom
//
// hydrateState/jsonSet are private (only `store` is exported), and hydration runs once at
// module-load time — so each case resets the module registry and re-imports fresh, with
// localStorage seeded beforehand, to observe a distinct hydration outcome per test.
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('store-instance', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('hydrates defaults when localStorage is empty', async () => {
    const { store } = await import('./store-instance.ts');
    expect(store.state.data).toBeNull();
    expect(store.state.readOnly).toBe(false);
    expect(store.state.user).toBe('');
    expect(store.state.weeks).toBe(2);
    expect(store.state.extraWeeks).toBe(0);
    expect(store.state.machSel).toEqual(new Set());
    expect(store.state.groupsSel).toEqual(new Set());
    expect(store.state.cats).toEqual(new Set(['maschine', 'messtechnik']));
    expect(store.state.collapsed).toEqual(new Set());
    expect(store.state.person).toBe('');
    expect(store.state.personOnly).toBe(false);
    expect(store.state.favs).toEqual(new Set());
    expect(store.state.visM).toEqual([]);
    expect(store.state.visD).toEqual([]);
    expect(store.state.startMonday.getUTCDay()).toBe(1); // always a real Monday
  });

  it('hydrates persisted prefs from localStorage', async () => {
    localStorage.setItem('mb_user', 'Anna');
    localStorage.setItem('mb_machsel', JSON.stringify(['m1', 'm2']));
    localStorage.setItem('mb_groupssel', JSON.stringify(['g1']));
    localStorage.setItem('mb_cats', JSON.stringify(['maschine']));
    localStorage.setItem('mb_collapsed', JSON.stringify(['g2']));
    localStorage.setItem('mb_person', 'Bob');
    localStorage.setItem('mb_persononly', 'on');
    localStorage.setItem('mb_favs', JSON.stringify(['m3']));

    const { store } = await import('./store-instance.ts');
    expect(store.state.user).toBe('Anna');
    expect(store.state.machSel).toEqual(new Set(['m1', 'm2']));
    expect(store.state.groupsSel).toEqual(new Set(['g1']));
    expect(store.state.cats).toEqual(new Set(['maschine']));
    expect(store.state.collapsed).toEqual(new Set(['g2']));
    expect(store.state.person).toBe('Bob');
    expect(store.state.personOnly).toBe(true);
    expect(store.state.favs).toEqual(new Set(['m3']));
  });

  it('personOnly is false for any localStorage value other than the literal "on"', () => {
    localStorage.setItem('mb_persononly', 'true');
    return import('./store-instance.ts').then(({ store }) => {
      expect(store.state.personOnly).toBe(false);
    });
  });

  it('exposes a real Store: get/set/subscribe/notify all work against the same instance', async () => {
    const { store } = await import('./store-instance.ts');
    expect(store.get('user')).toBe(store.state.user);

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set({ user: 'Carl' });
    expect(store.state.user).toBe('Carl');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.notify();
    expect(listener).toHaveBeenCalledTimes(1); // unsubscribed — no further calls
  });
});
