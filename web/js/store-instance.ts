// =======================================================================================
// STORE INSTANCE MODULE (web/js/store-instance.ts)
// =======================================================================================
//
// Application-wide singleton instance of the reactive Store.
//
// Responsibilities:
// 1. LocalStorage Hydration: Restores user preferences, active filters, selected categories,
//    collapsed groups, and favorite machine lists on page boot.
// 2. Calendar Initialization: Anchors the initial view to Monday of the current week.
// 3. Singleton Export: Exports the shared `store` instance used by all UI components and views.
//
// =======================================================================================

import type { AppState } from '../../shared/types.ts';
import { mondayOfDate } from '../../shared/dates.ts';
import { createStore } from './state.ts';

/**
 * Safely parses a JSON array from localStorage into a Set of strings, with fallback.
 */
function jsonSet(key: string, defaultJson: string): Set<string> {
  return new Set<string>(JSON.parse(localStorage.getItem(key) || defaultJson));
}

/**
 * Hydrates the initial `AppState` object from localStorage and the current wall clock time.
 */
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
    cats: jsonSet('mb_cats', '["maschine"]'),
    collapsed: jsonSet('mb_collapsed', '[]'),
    person: localStorage.getItem('mb_person') || '',
    personOnly: localStorage.getItem('mb_persononly') === 'on',
    gridQuery: localStorage.getItem('mb_grid_query') || '',
    gridAvailableOnly: localStorage.getItem('mb_grid_available') === 'on',
    gridOperationalOnly: localStorage.getItem('mb_grid_operational') === 'on',
    gridFavoritesOnly: localStorage.getItem('mb_grid_favorites') === 'on',
    favs: jsonSet('mb_favs', '[]'),
    visM: [],
    visD: [],
  };
}

/**
 * The application's reactive store singleton.
 */
export const store = createStore(hydrateState());
