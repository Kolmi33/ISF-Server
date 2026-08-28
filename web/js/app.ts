// Clean ES-module entry point for the reworked frontend.
//
// It runs BEFORE the legacy monolith (index.html loads this as `type="module"`,
// which — together with legacy.js being `defer` — executes it first, in document
// order, after parsing). Its job during the strangler-fig transition: re-export
// each extracted module's public functions onto `window`, so the not-yet-extracted
// code in legacy.js (which calls them as bare globals) keeps resolving unchanged.
//
// As modules are carved out of legacy.js, they are imported here and bridged. When
// legacy.js reaches zero (Phase 5), the bridge is deleted and this becomes the real
// boot/orchestration entry.

import type { AppState } from '../../shared/types.ts';
import * as dates from './core/dates.ts';
import { mondayOf } from './core/dates.ts';
import * as machines from './core/machines.ts';
import * as weekend from './core/weekend.ts';
import * as assistant from './core/assistant.ts';
import * as api from './net/api.ts';
import * as sse from './net/sse.ts';
import { createStore } from './state.ts';

declare global {
  interface Window {
    /** Legacy compat bridge for the runtime state (ARCHITECTURE §14). It IS `store.state`
     *  — the same object reference. Only shrinks as legacy sites migrate to `store`. */
    S: AppState;
  }
}

// Bridge extracted pure modules onto the global scope for the legacy layer.
Object.assign(window, dates);
Object.assign(window, machines);
Object.assign(window, weekend);
Object.assign(window, assistant);
Object.assign(window, api);
Object.assign(window, sse);

// Build the initial runtime state from device-local prefs (localStorage) + this week's
// Monday. This is the impure hydration `createStore` deliberately does NOT do (D3, E4);
// the store owns the object, `window.S` bridges it for the legacy layer. Faithful to the
// former `const S = {…}` at the top of legacy.js.
function jsonSet(key: string, fallback: string): Set<string> {
  return new Set<string>(JSON.parse(localStorage.getItem(key) || fallback));
}

function hydrateState(): AppState {
  return {
    data: null,
    readOnly: false,
    user: localStorage.getItem('mb_user') || '',
    startMonday: mondayOf(new Date()),
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
    lastRaw: '',
  };
}

const store = createStore(hydrateState());
window.S = store.state;
