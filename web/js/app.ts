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
import * as grid from './ui/grid.ts';
import * as selection from './ui/selection.ts';
import * as navigation from './ui/navigation.ts';
import { createStore } from './state.ts';

declare global {
  interface Window {
    /** Legacy compat bridge for the runtime state (ARCHITECTURE §14). It IS `store.state`
     *  — the same object reference. Only shrinks as legacy sites migrate to `store`. */
    S: AppState;
    /** The legacy full-grid renderer (defined by legacy.js); subscribed to the store in 4.1c. */
    render: () => void;
    /** Trigger a store notify (→ the subscribed render). Bridged for the legacy layer (4.1c). */
    notify: () => void;
  }
}

// Bridge extracted pure modules onto the global scope for the legacy layer.
Object.assign(window, dates);
Object.assign(window, machines);
Object.assign(window, weekend);
Object.assign(window, assistant);
Object.assign(window, api);
Object.assign(window, sse);
Object.assign(window, grid);
Object.assign(window, selection);
Object.assign(window, navigation);

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

// Phase 4.1c — the store drives repaints. The legacy `render()` subscribes to the store, and the
// data-load/SSE paths call the bridged `notify()` instead of `render()` directly, so those repaints
// flow through the store (SSE/refresh → store change → notify → render). The guard preserves the
// legacy invariant that the grid never renders before the first data load. Remaining direct
// `render()` calls stay valid during the migration — they simply don't route through the store yet.
store.subscribe(() => {
  if (window.S.data) window.render();
});
window.notify = () => {
  store.notify();
};
