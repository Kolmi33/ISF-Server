// =======================================================================================
// APPLICATION ENTRY POINT (web/js/app.ts)
// =======================================================================================
//
// The application's ES-module entry point: boot/orchestration.
// This module:
// 1. Hydrates the runtime state and mounts the app's React roots.
// 2. Wires the few remaining imperative DOM handlers (toolbar buttons, user chip, theme).
// 3. Loads the initial server state and starts the app (or shows a connection-failed screen).
//
// Key Principles:
// - RUNS ONCE, EARLY: `index.html` loads this as `type="module"`, so it executes once,
//   after parsing, before anything else on the page.
// - MINIMAL WINDOW BRIDGE: a small `window`-bridge remains below (`declare global`/
//   `Object.assign`) for two genuinely still-current needs — (1) the runtime state itself
//   (`S`, shrinking as F9's remaining call sites migrate to importing `store` directly) and
//   (2) `mutate`/`askConfirm`, kept as a deliberate convenience for their very wide fan-out
//   across already-gated components (not a coupling problem — see their own modules).
// - NOT A SHARED-TREE PROBLEM: what looked like "the 4 independently-mounted React roots
//   (Grid, ContextMenu, the two filter dropdowns) need to talk to each other" turned out on
//   closer inspection (F8, ARCHITECTURE_AUDIT.md) to be ordinary ES-module coupling with
//   nothing tree-shaped about it: plain direct imports for the vast majority, an injected
//   `GridInteractionHandlers` struct (`ui/grid-interaction.ts`) for the handful of cases
//   where direct imports would cycle, and a tiny `ui/grid-render-bridge.ts` for the one case
//   (repainting the mounted Grid) that imperative, non-React modules genuinely need a live
//   registration slot for. Merging the roots into one tree was rejected: nothing here
//   actually needed shared-tree machinery (context, refs across siblings) — every component
//   already reads the same module-singleton `store` regardless of where it's mounted.
//
// =======================================================================================

import type { AppState } from '../../shared/types.ts';
import * as api from './net/api.ts';
import * as gridInteraction from './ui/grid-interaction.ts';
import * as gridScroll from './ui/grid-scroll.ts';
import * as favoriteJump from './ui/favorite-jump.ts';
import * as helpModal from './ui/components/HelpModal.tsx';
import * as askUserNameModal from './ui/components/AskUserNameModal.tsx';
import * as settingsModal from './ui/components/SettingsModal.tsx';
import * as gridComponent from './ui/components/Grid.tsx';
import * as userChip from './ui/user-chip.ts';
import * as collisionBanner from './ui/collision-banner.ts';
import * as liveConnection from './ui/live-connection.ts';
import * as bookingDetailModal from './ui/components/BookingDetailModal.tsx';
import * as myBookingsModal from './ui/components/MyBookingsModal.tsx';
import * as statsModal from './ui/components/StatsModal.tsx';
import * as allBookingsModal from './ui/components/AllBookingsModal.tsx';
import * as adminModal from './ui/components/AdminModal.tsx';
import * as assistantModal from './ui/components/AssistantModal.tsx';
import * as contextMenu from './ui/components/ContextMenu.tsx';
import * as confirm from './ui/confirm.ts';
import type { AskConfirmOptions } from './ui/confirm.ts';
import * as activeUsersModal from './ui/components/ActiveUsersModal.tsx';
import * as machineFilterDropdown from './ui/components/MachineFilterDropdown.tsx';
import * as groupFilterDropdown from './ui/components/GroupFilterDropdown.tsx';
import * as theme from './ui/theme.ts';
import * as debugPanel from './ui/debug-panel.ts';
import * as mutateModule from './ui/mutate.ts';
import * as columnResize from './ui/column-resize.ts';
import { errorMessage } from './ui/debug-panel.ts';
import { escapeHtml } from './ui/escape-html.ts';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { store } from './store-instance.ts';
import type { BookingData } from '../../shared/types.ts';
import type { MutateResult } from './ui/mutate.ts';
import { triggerGridRender } from './ui/grid-render-bridge.ts';

declare global {
  interface Window {
    /** Legacy compat bridge for the runtime state (ARCHITECTURE §14). It IS `store.state`
     *  — the same object reference. Only shrinks as legacy sites migrate to `store`. */
    S: AppState;
    /** Trigger a store notify. Dead as an actual call target since F9 completed (every
     *  migrated module calls `store.notify()` directly) — kept assigned as a working no-op
     *  fallback rather than deleted outright, since several component tests still wire it
     *  defensively as a safety net for "did something still call the old bridge". */
    notify: () => void;
    /** Bridged from ui/mutate.ts (Phase 7 slice B10f) — the single authoritative write path
     *  (CLAUDE.md): applies `fn` to the in-memory `S.data` synchronously, logs the action,
     *  repaints (patch or full), then persists to the server in the background. Returns
     *  `fn`'s own result (or `null` in read-only mode). Deliberately kept window-bridged
     *  rather than direct-imported (F8, ARCHITECTURE_AUDIT.md): dozens of call sites across
     *  already-gated components, a separate convenience tradeoff from the cross-module
     *  coupling F8 investigated. */
    mutate: (
      fn: (fresh: BookingData) => unknown,
      logAction: string,
    ) => Promise<MutateResult | null>;
    /** Bridged from ui/confirm.ts (Phase 7 slice B10c); called by every "delete more"/
     *  destructive-action confirmation across the app (B4/B6/B7/B10b) — same "many call
     *  sites, deliberate convenience" reasoning as `mutate` above. */
    askConfirm: (options: AskConfirmOptions) => Promise<boolean>;
  }
}

// Bridge onto the global scope only the two functions with a genuine remaining reason to be
// reached via `window` rather than a direct import — see the file header and each one's own
// doc comment above. Everything else that used to live here (F8, ARCHITECTURE_AUDIT.md) is
// now a direct import between the modules that actually need it.
Object.assign(window, confirm);
Object.assign(window, mutateModule);

// `store` (imported above from `./store-instance.ts`) already holds the hydrated state —
// `window.S` bridges the same object reference for the pieces that haven't migrated to
// importing `store` directly yet (mostly React components — a separate, later decision,
// ARCHITECTURE_AUDIT.md §7/F9).
window.S = store.state;

// The store drives repaints: the Grid's force-update trigger (registered with
// `ui/grid-render-bridge.ts` on mount) subscribes here, and the data-load/SSE paths call the
// bridged `notify()` instead of triggering a render directly, so those repaints flow through
// the store (SSE/refresh → store change → notify → render). The guard preserves the original
// invariant that the grid never renders before the first data load.
store.subscribe(() => {
  if (store.get('data')) triggerGridRender();
});
window.notify = () => {
  store.notify();
};

// Phase 7 slice B1 — the grid itself is now a React component (`ui/components/Grid.tsx`),
// mounted once here onto the `<table id="grid">` legacy already renders into (it manages
// `#grid`'s `<thead>`/`<tbody>` directly, replacing the empty ones from index.html). Its own
// mount effect registers with `ui/grid-render-bridge.ts`, so the store subscription just
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
// necessarily painted its rows yet. The handlers it hands booking actions off to are injected
// here (F8, ARCHITECTURE_AUDIT.md) rather than reached through `window` — app.ts already
// imports every module involved with no cycle risk of its own.
gridInteraction.initGridInteraction({
  showCtx: contextMenu.showCtx,
  hideCtx: contextMenu.hideCtx,
  toggleFav: favoriteJump.toggleFav,
  gotoPrevFree: favoriteJump.gotoPrevFree,
  gotoNextFree: favoriteJump.gotoNextFree,
  openCellAction: bookingDetailModal.openCellAction,
  prependWeek: gridScroll.prependWeek,
});

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
  if (store.get('data')) store.notify();
});
if (localStorage.getItem('mb_compact') === 'on') document.body.classList.add('compact');

/** Wires each toolbar button to open its own modal, plus the refresh button — one-time
 *  bindings done at boot, since these elements exist for the app's entire lifetime. */
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

/** Wires the user-name chip: a debounced single click changes the name (so a double-click
 *  doesn't also fire it), a double-click shows who's currently active. */
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

/** Finishes booting once the initial data load succeeds: reveals the toolbar/grid, primes the
 *  toolbar buttons' labels, prompts for a name on a first run, starts the live connection, and
 *  logs the boot line. */
function startUI(): void {
  document.getElementById('startScreen')!.style.display = 'none';
  document.getElementById('toolbar')!.style.display = ''; // CSS layout (Grid) takes over
  document.getElementById('gridWrap')!.style.display = 'block';
  groupFilterDropdown.fillGroupSel();
  machineFilterDropdown.updateMachBtn(); // show the persisted filter in the toolbar
  if (!store.get('user') && !store.get('readOnly')) askUserNameModal.askUserName(true);
  userChip.updateUserChip();
  store.notify();
  gridScroll.prependWeek(); // one week of past scroll buffer to the left
  gridScroll.centerToday();
  mutateModule.stampRef();
  debugPanel.applyDebug();
  debugPanel.dbg(
    'info',
    'App gestartet — ' +
      (store.get('data')!.machines ? store.get('data')!.machines.length : 0) +
      ' Maschinen geladen' +
      (store.get('readOnly') ? ' (Nur-Lese-Modus)' : ''),
  );
  // Auto-refresh + presence (registered exactly once, even if read-only mode is later lifted).
  if (!store.get('readOnly')) liveConnection.startLiveTimers();
}

/**
 * The real boot entry point: loads the initial state, then either finishes booting
 * ({@link startUI}) or shows a connection-failed message.
 */
async function init(): Promise<void> {
  document.getElementById('startScreen')!.style.display = 'none';
  try {
    // Silent — startUI() (called below on success) does its own DOM setup first and
    // notifies once, at its current spot; notifying here too would render the grid a beat
    // early, while the toolbar/gridWrap are still hidden (display:none).
    store.state.data = await api.readFile();
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
