// The app's single, module-singleton Store instance.
//
// Split out from app.ts (the boot/orchestration entry) so plain .ts modules can import
// `store` directly and read/write state through `store.get()`/`store.set()`/`store.notify()`
// instead of reaching through the `window.S`/`window.notify()` bridge. app.ts still does
// `window.S = store.state` for the pieces that haven't migrated yet (mostly React
// components — a separate, later decision, ARCHITECTURE_AUDIT.md §7/F9) — both read the
// same live object, so the two are always in sync.
//
// Hydration (localStorage + today's date) stays here rather than in state.ts, which stays
// pure/DOM-free on purpose (D3/E4: `createStore` never does its own impure hydration).

import type { AppState } from '../../shared/types.ts';
import { mondayOfDate } from '../../shared/dates.ts';
import { createStore } from './state.ts';

function jsonSet(key: string, defaultJson: string): Set<string> {
  return new Set<string>(JSON.parse(localStorage.getItem(key) || defaultJson));
}

/** Build the initial runtime state from device-local prefs (localStorage) + this week's
 *  Monday. Faithful to the former `const S = {…}` at the top of the pre-Phase-2 monolith. */
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
