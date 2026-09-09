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

import '../css/tailwind.css';
import type { AppState } from '../../shared/types.ts';
import * as api from './net/api.ts';
import * as gridInteraction from './ui/grid-interaction.ts';
import * as gridScroll from './ui/grid-scroll.ts';
import * as favoriteJump from './ui/favorite-jump.ts';
import * as askUserNameModal from './ui/components/AskUserNameModal.tsx';
import * as gridComponent from './ui/components/Grid.tsx';
import * as userChip from './ui/user-chip.ts';
import * as collisionBanner from './ui/collision-banner.ts';
import * as liveConnection from './ui/live-connection.ts';
import * as contextMenu from './ui/components/ContextMenu.tsx';
import * as confirm from './ui/confirm.ts';
import type { AskConfirmOptions } from './ui/confirm.ts';
import * as machineFilterDropdown from './ui/components/MachineFilterDropdown.tsx';
import * as activeGridFilters from './ui/components/ActiveGridFilters.tsx';
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
import type { MutateOptions, MutateResult } from './ui/mutate.ts';
import { triggerGridRender } from './ui/grid-render-bridge.ts';
import { applyGridlineWidth, applyGridlineWidthHeader } from './ui/grid-style-settings.ts';

const loadAssistant = () => import('./ui/components/AssistantModal.tsx');
const loadMyBookings = () => import('./ui/components/MyBookingsModal.tsx');
const loadStats = () => import('./ui/components/StatsModal.tsx');
const loadAdmin = () => import('./ui/components/AdminModal.tsx');
const loadSettings = () => import('./ui/components/SettingsModal.tsx');
const loadHelp = () => import('./ui/components/HelpModal.tsx');
const loadActiveUsers = () => import('./ui/components/ActiveUsersModal.tsx');
const loadBookingDetail = () => import('./ui/components/BookingDetailModal.tsx');

function runLazyFeature<T>(loader: () => Promise<T>, run: (module: T) => void): void {
  void loader()
    .then(run)
    .catch((error: unknown) => debugPanel.handleError('ui/lazy-feature', error));
}

function warmFeatureOnIntent(elementId: string, loader: () => Promise<unknown>): void {
  const element = document.getElementById(elementId)!;
  const warm = () => void loader().catch(() => undefined);
  element.addEventListener('pointerenter', warm, { once: true });
  element.addEventListener('focus', warm, { once: true });
}

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
      options?: MutateOptions,
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
createRoot(document.getElementById('activeFilters')!).render(
  createElement(activeGridFilters.ActiveGridFilters),
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
  openCellAction: (machineId, date) =>
    runLazyFeature(loadBookingDetail, (module) => module.openCellAction(machineId, date)),
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
{
  const storedGridlineWidth = parseFloat(localStorage.getItem('mb_gridline_width') || '');
  if (Number.isFinite(storedGridlineWidth)) applyGridlineWidth(storedGridlineWidth);
  const storedGridlineWidthHeader = parseFloat(
    localStorage.getItem('mb_gridline_width_header') || '',
  );
  if (Number.isFinite(storedGridlineWidthHeader)) {
    applyGridlineWidthHeader(storedGridlineWidthHeader);
  }
}

/**
 * Wires toolbar buttons to open their respective modal dialogs.
 */
function wireToolbarButtons(): void {
  document.getElementById('btnAssist')!.onclick = () =>
    runLazyFeature(loadAssistant, (module) => module.openAssistant());
  document.getElementById('btnBookings')!.onclick = () =>
    runLazyFeature(loadMyBookings, (module) => module.openBookings());
  document.getElementById('btnAllBookings')!.onclick = () =>
    runLazyFeature(loadMyBookings, (module) => module.openBookings('all'));
  document.getElementById('btnSettings')!.onclick = () =>
    runLazyFeature(loadSettings, (module) => module.openSettings());
  document.getElementById('btnHelp')!.onclick = () =>
    runLazyFeature(loadHelp, (module) => module.openHelp());
  document.getElementById('btnStats')!.onclick = () =>
    runLazyFeature(loadStats, (module) => module.openStats());
  document.getElementById('btnAdmin')!.onclick = () =>
    runLazyFeature(loadAdmin, (module) => module.openAdmin());
  document.getElementById('btnRefresh')!.onclick = () => void mutateModule.refreshNow(false);
  // The toolbar's own quick-clear "×" next to the machine/group filter buttons (user request):
  // remove an active filter instantly from the main view, no need to open the dropdown first.
  document.getElementById('machClearBtn')!.onclick = machineFilterDropdown.clearMachineFilter;
  document.getElementById('groupClearBtn')!.onclick = groupFilterDropdown.clearGroupFilter;

  warmFeatureOnIntent('btnAssist', loadAssistant);
  warmFeatureOnIntent('btnBookings', loadMyBookings);
  warmFeatureOnIntent('btnAllBookings', loadMyBookings);
  warmFeatureOnIntent('btnSettings', loadSettings);
  warmFeatureOnIntent('btnHelp', loadHelp);
  warmFeatureOnIntent('btnStats', loadStats);
  warmFeatureOnIntent('btnAdmin', loadAdmin);
}

function wireDisplayControls(): void {
  const toggle = document.getElementById('onlyMineToggle') as HTMLInputElement;
  toggle.checked = store.get('personOnly');
  toggle.onchange = () => {
    store.set({ personOnly: toggle.checked });
    localStorage.setItem('mb_persononly', toggle.checked ? 'on' : 'off');
  };

  const trigger = document.getElementById('btnMore')!;
  const menu = document.getElementById('toolbarMore')!;
  const close = () => {
    menu.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  };
  trigger.onclick = (event) => {
    event.stopPropagation();
    const open = menu.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(open));
  };
  menu.addEventListener('click', close);
  document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) close();
  });
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
    runLazyFeature(loadActiveUsers, (module) => void module.openActiveUsers());
  };
  chip.title = 'Klick: Namen ändern · Doppelklick: aktive Nutzer';
}

wireToolbarButtons();
wireUserChip();
wireDisplayControls();

/**
 * Transitions from the loading screen to the live interactive application once data is loaded.
 */
function startUI(): void {
  document.getElementById('startScreen')!.style.display = 'none';
  document.getElementById('toolbar')!.style.display = '';
  document.getElementById('gridWrap')!.style.display = 'block';
  document.getElementById('gridLegend')!.style.display = 'flex';
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
