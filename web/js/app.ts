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
import * as machineFilterDropdown from './ui/components/MachineFilterDropdown.tsx';
import * as groupFilterDropdown from './ui/components/GroupFilterDropdown.tsx';
import * as machineLookup from './ui/machine-lookup.ts';
import * as theme from './ui/theme.ts';
import * as debugPanel from './ui/debug-panel.ts';
import * as mutateModule from './ui/mutate.ts';
import * as columnResize from './ui/column-resize.ts';
import { errorMessage } from './ui/debug-panel.ts';
import { escapeHtml } from './ui/escape-html.ts';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { createStore } from './state.ts';
import type { BookingData, Machine, ServerData } from '../../shared/types.ts';
import type { Cell } from './ui/selection.ts';
import type { MutateResult } from './ui/mutate.ts';

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
    /** Bridged from ui/debug-panel.ts (Phase 7 slice B10f); logs one event to the debug
     *  panel (a no-op unless the device-local debug flag is on). */
    dbg: (kind: string, msg: string) => void;
    /** Bridged from net/live-connection.ts (Phase 7 slice B8); the React name-prompt/settings
     *  call this to reconnect SSE under a new name. */
    presenceTick: () => Promise<void>;
    /** Bridged from ui/theme.ts (Phase 7 slice B10f); the boot-time init (still legacy, B10g)
     *  and the Settings modal's (B9) theme row call this. */
    applyTheme: () => void;
    /** Bridged from net/live-connection.ts (Phase 7 slice B8); called by legacy's own boot
     *  sequence (`startLiveTimers`) and by the Settings modal's (B9) presence-share toggle. */
    connectSSE: () => void;
    /** Bridged from ui/mutate.ts (Phase 7 slice B10f); re-fetches and reconciles the view to
     *  the server's authoritative state. Called by the refresh button, `mutate`'s own
     *  error/conflict paths, net/live-connection.ts's (B8) focus timer, and the Settings
     *  modal's (B9) "Neu verbinden". */
    refreshNow: (silent: boolean) => Promise<void>;
    /** Bridged from ui/debug-panel.ts (Phase 7 slice B10f); syncs `#dbgPanel`'s visibility
     *  with the debug flag. Called by the Settings modal's (B9) debug toggle. */
    applyDebug: () => void;
    /** Bridged from ui/debug-panel.ts (Phase 7 slice B10f); the Settings modal (B9) reads
     *  this to show the debug toggle's current state. */
    dbgOn: () => boolean;
    /** Bridged from ui/mutate.ts (Phase 7 slice B10f); timestamps `#lastRef` with the last
     *  successful sync time. Called by net/live-connection.ts's (B8) `hello`/`update` SSE
     *  handlers. */
    stampRef: () => void;
    /** Bridged from ui/debug-panel.ts (Phase 7 slice B10f); logs to console + the debug
     *  panel, swallowing `AbortError`. Called by net/live-connection.ts's (B8) SSE error
     *  paths. */
    handleError: (ctx: string, err: unknown) => void;
    /** Bridged from net/api.ts (Phase 7 slice B10f); fetches and normalizes the full server
     *  state. Called by net/live-connection.ts's (B8) `structural` SSE handler. */
    readFile: () => Promise<ServerData>;
    /** Bridged from ui/grid-scroll.ts (Phase 7 slice B3); called by legacy's own boot sequence
     *  and by the "Ändern…"-adjacent Settings row (React, B9). */
    centerToday: () => void;
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
    /** Bridged from ui/machine-lookup.ts (Phase 7 slice B10f); O(1) machine lookup by id (an
     *  internally-memoized Map, rebuilt whenever `S.data.machines` is replaced by a new array
     *  reference). */
    machById: (mid: string) => Machine | undefined;
    /** Bridged from ui/components/MachineFilterDropdown.tsx (Phase 7 slice B10e); persists
     *  the machine/group filter selections. Called by the My Bookings modal's (B5) "only my
     *  machines" shortcut and the Assistant's (B7) "go to run" jump, besides the dropdowns
     *  themselves. */
    saveFilters: () => void;
    /** Bridged from ui/components/MachineFilterDropdown.tsx (Phase 7 slice B10e); refreshes
     *  the toolbar button's label/highlight from `S.machSel`. Same callers as `saveFilters`. */
    updateMachBtn: () => void;
    /** Bridged from ui/components/GroupFilterDropdown.tsx (Phase 7 slice B10e); forces the
     *  dropdown to recompute its group list next render. Called after the machine form (B6)
     *  creates, edits, or deletes a machine (a save can add/rename/remove a group), and by
     *  net/live-connection.ts's (B8) "structural" SSE handler. */
    fillGroupSel: () => void;
    /** Bridged from ui/mutate.ts (Phase 7 slice B10f) — the single authoritative write path
     *  (CLAUDE.md): applies `fn` to the in-memory `S.data` synchronously, logs the action,
     *  repaints (patch or full), then persists to the server in the background. Returns
     *  `fn`'s own result (or `null` in read-only mode). */
    mutate: (
      fn: (fresh: BookingData) => unknown,
      logAction: string,
    ) => Promise<MutateResult | null>;
    /** Bridged from ui/confirm.ts (Phase 7 slice B10c); called by every "delete more"/
     *  destructive-action confirmation across the app (B4/B6/B7/B10b). */
    askConfirm: (options: AskConfirmOptions) => Promise<boolean>;
    /** Bridged from ui/components/StatsModal.tsx (Phase 7 slice B5); called from the booking
     *  detail modal's (B4) "Statistik" shortcut to open pre-filtered to one person. */
    openStats: (personFilter?: string) => void;
    /** Bridged from ui/cell-patch.ts (Phase 7 slice B4); called by ui/mutate.ts's (B10f)
     *  optimistic-apply path to patch only the cells a write actually touched. */
    patchCells: (entries: readonly { mid: string; date: string }[]) => void;
    /** Bridged from ui/components/BookingForm.tsx (Phase 7 slice B4); called directly by
     *  ui/components/ContextMenu.tsx (B10b) and the assistant (B7). */
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
Object.assign(window, machineFilterDropdown);
Object.assign(window, groupFilterDropdown);
Object.assign(window, machineLookup);
Object.assign(window, theme);
Object.assign(window, debugPanel);
Object.assign(window, mutateModule);

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
createRoot(document.getElementById('machDrop')!).render(
  createElement(machineFilterDropdown.MachineFilterDropdown),
);
createRoot(document.getElementById('groupDrop')!).render(
  createElement(groupFilterDropdown.GroupFilterDropdown),
);

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
debugPanel.initDebugPanel();
columnResize.initColumnResize();

// Phase 7 slice B10g — the app's own theme/compact-mode boot init (legacy's top-level
// `applyTheme(); matchMedia(...).addEventListener(...); if(mb_compact==='on') ...`). Applied
// before the first paint, same as legacy — no flash of the wrong theme.
theme.applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  theme.applyTheme();
  if (window.S.data) window.notify();
});
if (localStorage.getItem('mb_compact') === 'on') document.body.classList.add('compact');

/** Wire the toolbar's modal-opening buttons + the refresh button. Faithful port of legacy's
 *  scattered top-level `document.getElementById(...).onclick = ...` boot-time bindings. */
function wireToolbarButtons(): void {
  document.getElementById('btnAssist')!.onclick = assistantModal.openAssistant;
  document.getElementById('btnMine')!.onclick = myBookingsModal.openMyBookings;
  document.getElementById('btnAll')!.onclick = allBookingsModal.openAllBookings;
  document.getElementById('btnSettings')!.onclick = settingsModal.openSettings;
  document.getElementById('btnHelp')!.onclick = helpModal.openHelp;
  document.getElementById('btnStats')!.onclick = () => statsModal.openStats();
  document.getElementById('btnAdmin')!.onclick = adminModal.openAdmin;
  document.getElementById('btnRefresh')!.onclick = () => void mutateModule.refreshNow(false);
}

/** Wire the user-name chip: a debounced single click changes the name (so a double-click
 *  doesn't also fire it), a double-click shows who's currently active. Faithful port of
 *  legacy's top-level `userChip` bindings. */
function wireUserChip(): void {
  let userClickTimer: ReturnType<typeof setTimeout> | null = null;
  const chip = document.getElementById('userChip')!;
  chip.onclick = () => {
    if (userClickTimer) clearTimeout(userClickTimer);
    userClickTimer = setTimeout(() => askUserNameModal.askUserName(false), 240);
  };
  chip.ondblclick = () => {
    if (userClickTimer) clearTimeout(userClickTimer);
    void activeUsersModal.openActiveUsers();
  };
  chip.title = 'Klick: Namen ändern · Doppelklick: aktive Nutzer';
}

wireToolbarButtons();
wireUserChip();

/** Finish booting once the initial data load succeeds: reveal the toolbar/grid, prime the
 *  toolbar buttons' labels, prompt for a name on a first run, start the live connection, and
 *  log the boot line. Faithful port of legacy `startUI`. */
function startUI(): void {
  document.getElementById('startScreen')!.style.display = 'none';
  document.getElementById('toolbar')!.style.display = ''; // CSS layout (Grid) takes over
  document.getElementById('gridWrap')!.style.display = 'block';
  groupFilterDropdown.fillGroupSel();
  machineFilterDropdown.updateMachBtn(); // show the persisted filter in the toolbar
  if (!window.S.user && !window.S.readOnly) askUserNameModal.askUserName(true);
  userChip.updateUserChip();
  window.notify();
  gridScroll.prependWeek(); // one week of past scroll buffer to the left
  gridScroll.centerToday();
  mutateModule.stampRef();
  debugPanel.applyDebug();
  debugPanel.dbg(
    'info',
    'App gestartet — ' +
      (window.S.data!.machines ? window.S.data!.machines.length : 0) +
      ' Maschinen geladen' +
      (window.S.readOnly ? ' (Nur-Lese-Modus)' : ''),
  );
  // Auto-refresh + presence (registered exactly once, even if read-only mode is later lifted).
  if (!window.S.readOnly) liveConnection.startLiveTimers();
}

/**
 * The real boot entry point: load the initial state, then either finish booting or show a
 * connection-failed message. Faithful port of legacy `init`. (legacy's `start` — a dead
 * near-duplicate with a slightly less complete error path — had zero callers anywhere and was
 * not ported; `init()` was always the one actually wired up, at the bottom of this file.)
 */
async function init(): Promise<void> {
  document.getElementById('startScreen')!.style.display = 'none';
  try {
    window.S.data = await api.readFile();
  } catch (error) {
    document.getElementById('startScreen')!.style.display = '';
    document.getElementById('startMsg')!.innerHTML =
      'Verbindung zum Server fehlgeschlagen: ' +
      escapeHtml(errorMessage(error)) +
      '<br>Läuft der Dienst? Bitte die Seite neu laden.';
    return;
  }
  startUI();
}

void init();
