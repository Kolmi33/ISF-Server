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

  // What: with nothing in localStorage, every persisted preference field hydrates to its
  // documented default, and startMonday always lands on a real Monday.
  // How: imports a fresh module instance against empty localStorage and checks every field
  // of the resulting store's state against its expected default.
  it('hydrates defaults when localStorage is empty', async () => {
    const { store } = await import('./store-instance.ts');
    expect(store.state.data).toBeNull();
    expect(store.state.readOnly).toBe(false);
    expect(store.state.user).toBe('');
    expect(store.state.weeks).toBe(2);
    expect(store.state.extraWeeks).toBe(0);
    expect(store.state.machSel).toEqual(new Set());
    expect(store.state.groupsSel).toEqual(new Set());
    expect(store.state.cats).toEqual(new Set(['maschine']));
    expect(store.state.collapsed).toEqual(new Set());
    expect(store.state.person).toBe('');
    expect(store.state.personOnly).toBe(false);
    expect(store.state.favs).toEqual(new Set());
    expect(store.state.visM).toEqual([]);
    expect(store.state.visD).toEqual([]);
    expect(store.state.startMonday.getUTCDay()).toBe(1); // always a real Monday
  });

  // What: every persisted preference key is read back from localStorage into its matching
  // state field on hydration, with the right type conversion (JSON arrays into Sets, etc.).
  // How: seeds localStorage with one value per persisted key, imports a fresh module
  // instance, and checks each resulting state field matches what was seeded.
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

  it('normalizes the legacy multi-category preference to one selected tab', async () => {
    localStorage.setItem('mb_cats', JSON.stringify(['maschine', 'messtechnik']));
    const { store } = await import('./store-instance.ts');
    expect(store.state.cats).toEqual(new Set(['maschine']));
  });

  // What: the personOnly flag only reads as true for the exact stored string "on" — any other
  // truthy-looking string (even "true") stays false, so a stray or malformed value can't
  // silently enable the filter.
  // How: seeds localStorage with the string "true" (not "on") and checks it hydrates to false.
  it('personOnly is false for any localStorage value other than the literal "on"', () => {
    localStorage.setItem('mb_persononly', 'true');
    return import('./store-instance.ts').then(({ store }) => {
      expect(store.state.personOnly).toBe(false);
    });
  });

  // What: the module's exported `store` is a genuinely working Store instance, not just a
  // hydrated plain object — get/set/subscribe/notify/unsubscribe all function against it.
  // How: reads a field via get(), subscribes a listener, sets a field and checks both the
  // state update and the listener firing, then unsubscribes and checks a further notify()
  // no longer reaches it.
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
