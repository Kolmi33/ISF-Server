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
import { mondayOfDate } from './core/dates.ts';
import * as machines from './core/machines.ts';
import * as weekend from './core/weekend.ts';
import * as booking from './core/booking.ts';
import * as assistant from './core/assistant.ts';
import * as api from './net/api.ts';
import * as sse from './net/sse.ts';
import * as grid from './ui/grid.ts';
import * as selection from './ui/selection.ts';
import * as gridInteraction from './ui/grid-interaction.ts';
import * as navigation from './ui/navigation.ts';
import * as viewMyBookings from './ui/views/my-bookings.ts';
import * as viewStats from './ui/views/stats.ts';
import * as viewAllBookings from './ui/views/all-bookings.ts';
import * as viewAdmin from './ui/views/admin.ts';
import * as machineText from './ui/machine-text.ts';
import * as helpModal from './ui/components/HelpModal.tsx';
import * as logModal from './ui/components/LogModal.tsx';
import * as askUserNameModal from './ui/components/AskUserNameModal.tsx';
import * as settingsModal from './ui/components/SettingsModal.tsx';
import * as gridComponent from './ui/components/Grid.tsx';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { createStore } from './state.ts';
import type { Machine } from '../../shared/types.ts';

declare global {
  interface Window {
    /** Legacy compat bridge for the runtime state (ARCHITECTURE §14). It IS `store.state`
     *  — the same object reference. Only shrinks as legacy sites migrate to `store`. */
    S: AppState;
    /** The legacy full-grid renderer (defined by legacy.js); subscribed to the store in 4.1c. */
    render: () => void;
    /** Trigger a store notify (→ the subscribed render). Bridged for the legacy layer (4.1c). */
    notify: () => void;
    /** Still legacy (Phase 7 slice B5) — called from the React LogModal's "Zurück" button. */
    openAdmin: () => void;
    /** Still legacy — DOM/presence-chip side effects the React name-prompt/settings call. */
    updateUserChip: () => void;
    dbg: (kind: string, msg: string) => void;
    presenceTick: () => Promise<void>;
    applyTheme: () => void;
    connectSSE: () => void;
    refreshNow: (silent: boolean) => Promise<void>;
    applyDebug: () => void;
    dbgOn: () => boolean;
    centerToday: () => void;
    /** Still legacy — the grid's category ein-/ausklappen. Called by both the React Grid
     *  (B1, its toggle buttons) and ui/grid-interaction.ts (B2, its group-row click/dblclick). */
    catTap: (category: string) => void;
    catTapCancel: () => void;
    toggleAllGroupsInCat: (category: string) => void;
    /** Bridged from ui/grid-interaction.ts (Phase 7 slice B2); called by the React Grid's
     *  post-render effect and by legacy's still-unported `jumpToSlot`. */
    paintSel: () => void;
    syncJumpControls: () => void;
    ensureOverflow: () => void;
    /** Still legacy (Phase 7 slice B2 owns *reading* it) — mid → the last free day jumped to;
     *  exposed here so the React Grid can read it for the row header's "back" button. */
    nextFreePtr: Record<string, string>;
    prevFreeBefore: (machine: Machine, fromIso: string) => string | null;
    /** Still legacy — the context menu, next-free jump, and single-cell booking action
     *  (Phase 7 slices B4/B5). ui/grid-interaction.ts (B2) only calls these. */
    hideCtx: () => void;
    showCtx: (x: number, y: number) => void;
    gotoPrevFree: (mid: string) => void;
    gotoNextFree: (mid: string) => void;
    openCellAction: (mid: string, date: string) => void;
    /** Still legacy — favorite toggle (Phase 7 slice B6, machine/group management) and the
     *  week-growth-to-the-left used by drag-auto-scroll and arrow-key nav at the grid's edges
     *  (Phase 7 slice B3). */
    toggleFav: (mid: string) => void;
    prependWeek: () => void;
  }
}

// Bridge extracted pure modules onto the global scope for the legacy layer.
Object.assign(window, dates);
Object.assign(window, machines);
Object.assign(window, weekend);
Object.assign(window, booking);
Object.assign(window, assistant);
Object.assign(window, api);
Object.assign(window, sse);
Object.assign(window, grid);
Object.assign(window, selection);
Object.assign(window, gridInteraction);
Object.assign(window, navigation);
Object.assign(window, viewMyBookings);
Object.assign(window, viewStats);
Object.assign(window, viewAllBookings);
Object.assign(window, viewAdmin);
Object.assign(window, machineText);
Object.assign(window, helpModal);
Object.assign(window, logModal);
Object.assign(window, askUserNameModal);
Object.assign(window, settingsModal);
Object.assign(window, gridComponent);

// Build the initial runtime state from device-local prefs (localStorage) + this week's
// Monday. This is the impure hydration `createStore` deliberately does NOT do (D3, E4);
// the store owns the object, `window.S` bridges it for the legacy layer. Faithful to the
// former `const S = {…}` at the top of legacy.js.
function jsonSet(key: string, defaultJson: string): Set<string> {
  return new Set<string>(JSON.parse(localStorage.getItem(key) || defaultJson));
}

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

// Phase 7 slice B1 — the grid itself is now a React component (`ui/components/Grid.tsx`),
// mounted once here onto the `<table id="grid">` legacy already renders into (it manages
// `#grid`'s `<thead>`/`<tbody>` directly, replacing the empty ones from index.html). Its own
// `render()` export becomes `window.render` (bridged above), so the store subscription just
// above keeps driving it exactly as it drove legacy's `render()` before this slice.
createRoot(document.getElementById('grid')!).render(createElement(gridComponent.Grid));

// Phase 7 slice B2 — selection, drag-select and keyboard navigation (`ui/grid-interaction.ts`).
// Wired once at boot, same as legacy's own top-level `gridEl.addEventListener(...)` calls did;
// event delegation means it doesn't matter that the React grid mounted just above hasn't
// necessarily painted its rows yet.
gridInteraction.initGridInteraction();
