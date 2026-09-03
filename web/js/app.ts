// =======================================================================================
// APPLICATION BOOT & ORCHESTRATION MODULE (web/js/app.ts)
// =======================================================================================
//
// Primary entry point for the browser application.
//
// Boot Sequence & Responsibilities:
// 1. Store Initialization: Connects the global store instance and binds reactive render triggers.
// 2. React UI Mounting: Mounts the interactive Calendar Grid, Context Menu, and Filter Dropdowns.
// 3. Global Event Handlers: Initializes grid interactions (marquee selection, keyboard navigation,
//    drag-select, infinite horizontal scrolling, column resizing, and theme switching).
// 4. Toolbar Action Wiring: Binds modal dialog openers (Assistant, Statistics, Admin, Logs, Settings).
// 5. Server Synchronization: Fetches initial dataset from `/api/state`, starts Server-Sent Events (SSE)
//    for live multi-user synchronization, and reveals the interactive UI.
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
    /** Global reference to the application state store. */
    S: AppState;
    /** Triggers a reactive store notification to repaint all subscribed UI views. */
    notify: () => void;
    /**
     * Authoritative write pipeline: applies optimistic mutation locally, updates UI immediately,
     * and persists changes to the backend in the background with automatic conflict detection.
     */
    mutate: (
      fn: (fresh: BookingData) => unknown,
      logAction: string,
    ) => Promise<MutateResult | null>;
    /** Opens an interactive modal confirmation prompt before destructive operations. */
    askConfirm: (options: AskConfirmOptions) => Promise<boolean>;
  }
}

// Attach write and confirm utilities to window for global convenience across UI components
Object.assign(window, confirm);
Object.assign(window, mutateModule);

// Bridge store state reference to window.S
window.S = store.state;

// Subscribe the Grid renderer to store updates: triggers a repaint whenever server data or filters change
store.subscribe(() => {
  if (store.get('data')) triggerGridRender();
});
window.notify = () => {
  store.notify();
};

// Mount primary React interface roots
createRoot(document.getElementById('grid')!).render(createElement(gridComponent.Grid));
createRoot(document.getElementById('ctxMenu')!).render(createElement(contextMenu.ContextMenu));
createRoot(document.getElementById('machDrop')!).render(
  createElement(machineFilterDropdown.MachineFilterDropdown),
);
createRoot(document.getElementById('groupDrop')!).render(
  createElement(groupFilterDropdown.GroupFilterDropdown),
);

// Initialize grid user interactions: cell selection, context menu, favorite machine navigation
gridInteraction.initGridInteraction({
  showCtx: contextMenu.showCtx,
  hideCtx: contextMenu.hideCtx,
  toggleFav: favoriteJump.toggleFav,
  gotoPrevFree: favoriteJump.gotoPrevFree,
  gotoNextFree: favoriteJump.gotoNextFree,
  openCellAction: bookingDetailModal.openCellAction,
  prependWeek: gridScroll.prependWeek,
});

// Initialize infinite horizontal scrolling, date jumping, collision banners, debug logs, and column resizing
gridScroll.initGridScroll();
collisionBanner.initCollisionBanner();
debugPanel.initDebugPanel();
columnResize.initColumnResize();

// Initialize theme styling (light/dark mode & compact grid option)
theme.applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  theme.applyTheme();
  if (store.get('data')) store.notify();
});
if (localStorage.getItem('mb_compact') === 'on') document.body.classList.add('compact');

/**
 * Wires toolbar buttons to open their respective modal dialogs.
 */
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

/**
 * Wires the current user chip in the toolbar:
 * - Single click: Prompt to change user name.
 * - Double click: Show active online users.
 */
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

/**
 * Transitions from the loading screen to the live interactive application once data is loaded.
 */
function startUI(): void {
  document.getElementById('startScreen')!.style.display = 'none';
  document.getElementById('toolbar')!.style.display = '';
  document.getElementById('gridWrap')!.style.display = 'block';
  groupFilterDropdown.fillGroupSel();
  machineFilterDropdown.updateMachBtn();
  if (!store.get('user') && !store.get('readOnly')) askUserNameModal.askUserName(true);
  userChip.updateUserChip();
  store.notify();
  gridScroll.prependWeek();
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
  if (!store.get('readOnly')) liveConnection.startLiveTimers();
}

/**
 * Main application bootloader: fetches server state and initializes the workspace.
 */
async function init(): Promise<void> {
  document.getElementById('startScreen')!.style.display = 'none';
  try {
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
