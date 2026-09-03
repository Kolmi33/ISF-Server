// =======================================================================================
// STORE INSTANCE MODULE (web/js/store-instance.ts)
// =======================================================================================
//
// The app's single, module-singleton `Store` instance.
// This module:
// 1. Reads device-local prefs from `localStorage` and today's date into the initial state.
// 2. Creates and exports the one `store` every other module imports and shares.
//
// Key Principles:
// - SINGLE SOURCE OF TRUTH: split out from `app.ts` (the boot/orchestration entry) so plain
//   `.ts` modules can import `store` directly and read/write state through
//   `store.get()`/`store.set()`/`store.notify()`, instead of reaching through the
//   `window.S`/`window.notify()` bridge. `app.ts` still does `window.S = store.state` for
//   the pieces that haven't migrated yet (mostly React components — a separate, later
//   decision, ARCHITECTURE_AUDIT.md §7/F9) — both read the same live object, so the two
//   stay in sync automatically.
// - HYDRATION LIVES HERE, NOT IN state.ts: `state.ts`'s `createStore` stays pure/DOM-free
//   on purpose (D3/E4) — it never does its own impure hydration. Reading `localStorage`
//   and `new Date()` is this module's job specifically because it's the one place that's
//   allowed to be impure.
//
// =======================================================================================

import type { AppState } from '../../shared/types.ts';
import { mondayOfDate } from '../../shared/dates.ts';
import { createStore } from './state.ts';

function jsonSet(key: string, defaultJson: string): Set<string> {
  return new Set<string>(JSON.parse(localStorage.getItem(key) || defaultJson));
}

/** Builds the initial runtime state from device-local prefs (`localStorage`) plus this
 *  week's Monday — every filter/collapse/favorite selection the user made last time
 *  persists across a page reload, while the visible week always starts fresh at "today". */
function hydrateState(): AppState {
  return {
    data: null,
    readOnly: false,
    user: localStorage.getItem('mb_user') || '',
    startMonday: mondayOfDate(new Date()),
    weeks: 2,
    extraWeeks: 0,
    machSel: jsonSet('mb_machsel', '[]'),
    groupsSel: jsonSet('mb_groupssel', '[]'),
    cats: jsonSet('mb_cats', '["maschine","messtechnik"]'),
    collapsed: jsonSet('mb_collapsed', '[]'),
    person: localStorage.getItem('mb_person') || '',
    personOnly: localStorage.getItem('mb_persononly') === 'on',
    favs: jsonSet('mb_favs', '[]'),
    visM: [],
    visD: [],
  };
}

export const store = createStore(hydrateState());
