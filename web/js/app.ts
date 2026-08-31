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
import * as gridScroll from './ui/grid-scroll.ts';
import * as navigation from './ui/navigation.ts';
import * as favoriteJump from './ui/favorite-jump.ts';
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
import * as cellPatch from './ui/cell-patch.ts';
import * as toastModule from './ui/toast.ts';
import * as userChip from './ui/user-chip.ts';
import * as collisionBanner from './ui/collision-banner.ts';
import * as liveConnection from './ui/live-connection.ts';
import * as bookingFormModal from './ui/components/BookingForm.tsx';
import * as bookingDetailModal from './ui/components/BookingDetailModal.tsx';
import * as myBookingsModal from './ui/components/MyBookingsModal.tsx';
import * as statsModal from './ui/components/StatsModal.tsx';
import * as allBookingsModal from './ui/components/AllBookingsModal.tsx';
import * as adminModal from './ui/components/AdminModal.tsx';
import * as machineFormModal from './ui/components/MachineFormModal.tsx';
import * as assistantModal from './ui/components/AssistantModal.tsx';
import * as contextMenu from './ui/components/ContextMenu.tsx';
import * as confirm from './ui/confirm.ts';
import type { AskConfirmOptions } from './ui/confirm.ts';
import * as activeUsersModal from './ui/components/ActiveUsersModal.tsx';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { createStore } from './state.ts';
import type { BookingData, Machine, ServerData } from '../../shared/types.ts';
import type { Cell } from './ui/selection.ts';
import type { CellUndo, Conflict } from './core/booking.ts';

declare global {
  interface Window {
    /** Legacy compat bridge for the runtime state (ARCHITECTURE §14). It IS `store.state`
     *  — the same object reference. Only shrinks as legacy sites migrate to `store`. */
    S: AppState;
    /** The legacy full-grid renderer (defined by legacy.js); subscribed to the store in 4.1c. */
    render: () => void;
    /** Trigger a store notify (→ the subscribed render). Bridged for the legacy layer (4.1c). */
    notify: () => void;
    /** Bridged from ui/components/AdminModal.tsx (Phase 7 slice B5); called from the React
     *  LogModal's "Zurück" button. */
    openAdmin: () => void;
    /** Bridged from ui/components/MachineFormModal.tsx (Phase 7 slice B6); routed to by the
     *  Admin modal's (B5) "＋ Maschine hinzufügen" and each row's "Bearbeiten". */
    openMachineForm: (mid: string | null) => void;
    /** Bridged from ui/user-chip.ts (Phase 7 slice B8); the React name-prompt/settings call
     *  this after changing `S.user` so the toolbar chip's label updates. */
    updateUserChip: () => void;
    dbg: (kind: string, msg: string) => void;
    /** Bridged from net/live-connection.ts (Phase 7 slice B8); the React name-prompt/settings
     *  call this to reconnect SSE under a new name. */
    presenceTick: () => Promise<void>;
    applyTheme: () => void;
    /** Bridged from net/live-connection.ts (Phase 7 slice B8); called by legacy's own boot
     *  sequence (`startLiveTimers`) and by the Settings modal's (B9) presence-share toggle. */
    connectSSE: () => void;
    refreshNow: (silent: boolean) => Promise<void>;
    applyDebug: () => void;
    dbgOn: () => boolean;
    /** Still legacy — timestamps `#lastRef` with the last successful sync time. Called by
     *  net/live-connection.ts's (B8) `hello`/`update` SSE handlers. */
    stampRef: () => void;
    /** Still legacy — logs to console + the debug panel, swallowing `AbortError`. Called by
     *  net/live-connection.ts's (B8) SSE error paths. */
    handleError: (ctx: string, err: unknown) => void;
    /** Still legacy — fetches and normalizes the full server state. Called by
     *  net/live-connection.ts's (B8) `structural` SSE handler. */
    readFile: () => Promise<ServerData>;
    /** Bridged from ui/grid-scroll.ts (Phase 7 slice B3); called by legacy's own boot sequence
     *  and by the "Ändern…"-adjacent Settings row (React, B9). */
    centerToday: () => void;
    /** Still legacy — the grid's category ein-/ausklappen. Called by both the React Grid
     *  (B1, its toggle buttons) and ui/grid-interaction.ts (B2, its group-row click/dblclick). */
    catTap: (category: string) => void;
    catTapCancel: () => void;
    toggleAllGroupsInCat: (category: string) => void;
    /** Bridged from ui/grid-interaction.ts (Phase 7 slice B2); called by the React Grid's
     *  post-render effect. (ui/favorite-jump.ts's `jumpToSlot`, B10a, imports `paintSelection`
     *  directly — both are gated.) */
    paintSel: () => void;
    /** Bridged from ui/grid-scroll.ts (Phase 7 slice B3); called by the React Grid's
     *  post-render effect to keep the month/year jump controls in sync. */
    syncJumpControls: () => void;
    /** Bridged from ui/grid-scroll.ts (Phase 7 slice B3); called by the React Grid's
     *  post-render effect to keep the grid wider than the viewport. */
    ensureOverflow: () => void;
    /** Bridged from ui/favorite-jump.ts (Phase 7 slice B10a) — mid → the last free day jumped
     *  to; the React Grid (B1) reads it for the row header's "back" button. */
    nextFreePtr: Record<string, string>;
    /** Bridged from ui/favorite-jump.ts (Phase 7 slice B10a). */
    prevFreeBefore: (machine: Machine, fromIso: string) => string | null;
    /** Bridged from ui/components/ContextMenu.tsx (Phase 7 slice B10b); called by
     *  ui/grid-interaction.ts's (B2) after-drag-select and Enter-key routing. */
    hideCtx: () => void;
    showCtx: (x: number, y: number) => void;
    /** Bridged from ui/favorite-jump.ts (Phase 7 slice B10a); called by
     *  ui/grid-interaction.ts's (B2) row-header ⏮/⏭ buttons. */
    gotoPrevFree: (mid: string) => void;
    gotoNextFree: (mid: string) => void;
    /** Bridged from ui/components/BookingDetailModal.tsx (Phase 7 slice B4); called by
     *  ui/grid-interaction.ts's (B2) click/dblclick/Enter routing. */
    openCellAction: (mid: string, date: string) => void;
    /** Bridged from ui/favorite-jump.ts (Phase 7 slice B10a); called by
     *  ui/grid-interaction.ts's (B2) row-header favorite star. */
    toggleFav: (mid: string) => void;
    /** Still legacy — machine lookup by id (an internally-memoized Map, rebuilt whenever
     *  `S.data.machines` is replaced by a new array reference). */
    machById: (mid: string) => Machine | undefined;
    /** Still legacy — persists the machine/group filter selections; toolbar chip refresh for
     *  the same filter. Called by the My Bookings modal's (B5) "only my machines" shortcut. */
    saveFilters: () => void;
    updateMachBtn: () => void;
    /** Still legacy — rebuilds the toolbar's group-filter checkbox list; called after the
     *  machine form (B6) creates, edits, or deletes a machine (a save can add/rename/remove a
     *  group). */
    fillGroupSel: () => void;
    /** Still legacy — the optimistic write pipeline every mutation goes through: applies `fn`
     *  to the in-memory `S.data` synchronously, logs the action, repaints (patch or full), then
     *  persists to the server in the background. Returns `fn`'s own result (or `null` in
     *  read-only mode). */
    mutate: (
      fn: (fresh: BookingData) => unknown,
      logAction: string,
    ) => Promise<{
      abort?: boolean;
      conflicts?: Conflict[];
      count?: number;
      n?: number;
      undo?: CellUndo[];
    } | null>;
    /** Bridged from ui/confirm.ts (Phase 7 slice B10c); called by every "delete more"/
     *  destructive-action confirmation across the app (B4/B6/B7/B10b). */
    askConfirm: (options: AskConfirmOptions) => Promise<boolean>;
    /** Bridged from ui/components/StatsModal.tsx (Phase 7 slice B5); called from the booking
     *  detail modal's (B4) "Statistik" shortcut to open pre-filtered to one person. */
    openStats: (personFilter?: string) => void;
    /** Bridged from ui/cell-patch.ts (Phase 7 slice B4); called by the still-legacy `mutate`'s
     *  optimistic-apply path to patch only the cells a write actually touched. */
    patchCells: (entries: readonly { mid: string; date: string }[]) => void;
    /** Bridged from ui/components/BookingForm.tsx (Phase 7 slice B4); called by legacy's
     *  still-unported context menu ("Buchen…") and the assistant. */
    openBookingForm: (machineIds: readonly string[], from: string, to: string) => void;
    /** Bridged from ui/grid-scroll.ts (Phase 7 slice B3); called by ui/grid-interaction.ts's
     *  (B2) drag-auto-scroll and arrow-key growth at the grid's edges. */
    prependWeek: () => void;
    /** Bridged from ui/grid-interaction.ts (Phase 7 slice B2) under its legacy name `Sel` —
     *  read/mutated directly by legacy's still-unported `jumpToSlot`, `prependWeek`'s scroll
     *  handler (ui/grid-scroll.ts, B3) and `showCtx` (still legacy). */
    Sel: {
      anchor: Cell | null;
      focus: Cell | null;
      cells: Cell[];
      dragging: boolean;
      didDrag: boolean;
    };
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
Object.assign(window, gridScroll);
Object.assign(window, navigation);
Object.assign(window, favoriteJump);
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
Object.assign(window, cellPatch);
Object.assign(window, toastModule);
Object.assign(window, userChip);
Object.assign(window, collisionBanner);
Object.assign(window, liveConnection);
Object.assign(window, bookingFormModal);
Object.assign(window, bookingDetailModal);
Object.assign(window, myBookingsModal);
Object.assign(window, statsModal);
Object.assign(window, allBookingsModal);
Object.assign(window, adminModal);
Object.assign(window, machineFormModal);
Object.assign(window, assistantModal);
Object.assign(window, contextMenu);
Object.assign(window, confirm);
Object.assign(window, activeUsersModal);

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
createRoot(document.getElementById('ctxMenu')!).render(createElement(contextMenu.ContextMenu));

// Phase 7 slice B2 — selection, drag-select and keyboard navigation (`ui/grid-interaction.ts`).
// Wired once at boot, same as legacy's own top-level `gridEl.addEventListener(...)` calls did;
// event delegation means it doesn't matter that the React grid mounted just above hasn't
// necessarily painted its rows yet.
gridInteraction.initGridInteraction();

// Phase 7 slice B3 — infinite scroll / week growth and the month-jump controls
// (`ui/grid-scroll.ts`). Wired once at boot, same as legacy's own top-level
// `gridWrap.addEventListener(...)`/`.onchange=`/`.onclick=` assignments did.
gridScroll.initGridScroll();

// Phase 7 slice B8 — the write-collision banner's dismiss button (`ui/collision-banner.ts`).
// Wired once at boot, same as legacy's own top-level `document.getElementById('collOk')
// .onclick=...` assignment did.
collisionBanner.initCollisionBanner();
