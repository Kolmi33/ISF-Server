import { useEffect, useReducer } from 'react';
import { X } from 'lucide-react';
import { store } from '../../store-instance.ts';
import { matchingGridMachineIds } from '../grid-filters.ts';
import { clearMachineFilter, saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';

function useStoreUpdates() {
  const [, render] = useReducer((value: number) => value + 1, 0);
  useEffect(() => store.subscribe(() => render()), []);
}

function currentCriteria() {
  return {
    query: store.get('gridQuery'),
    groups: store.get('groupsSel'),
    machineIds: store.get('machSel'),
    availableOnly: store.get('gridAvailableOnly'),
    operationalOnly: store.get('gridOperationalOnly'),
    favoritesOnly: store.get('gridFavoritesOnly'),
    favoriteIds: store.get('favs'),
  };
}

interface FilterChip {
  id: string;
  label: string;
  remove: () => void;
}

function buildChips(commit: () => void): FilterChip[] {
  const criteria = currentCriteria();
  const chips: FilterChip[] = [];
  const add = (id: string, label: string, remove: () => void) => chips.push({ id, label, remove });
  if (criteria.query.trim())
    add('query', `Suche: ${criteria.query.trim()}`, () => {
      store.state.gridQuery = '';
      commit();
    });
  for (const group of criteria.groups)
    add(`group:${group}`, group, () => {
      store.get('groupsSel').delete(group);
      commit();
    });
  if (criteria.machineIds.size)
    add('machines', `${criteria.machineIds.size} Geräte`, () => {
      store.get('machSel').clear();
      commit();
    });
  if (criteria.availableOnly)
    add('available', 'Zeitraum frei', () => {
      store.state.gridAvailableOnly = false;
      commit();
    });
  if (criteria.operationalOnly)
    add('operational', 'Betriebsbereit', () => {
      store.state.gridOperationalOnly = false;
      commit();
    });
  if (criteria.favoritesOnly)
    add('favorites', 'Favoriten', () => {
      store.state.gridFavoritesOnly = false;
      commit();
    });
  return chips;
}

export function ActiveGridFilters() {
  useStoreUpdates();
  const data = store.get('data');
  if (!data) return null;
  const commit = () => {
    saveFilters();
    updateMachBtn();
    store.notify();
  };
  const criteria = currentCriteria();
  const chips = buildChips(commit);
  if (!chips.length) return null;
  const matching = matchingGridMachineIds(data, store.get('visD'), criteria).size;
  return (
    <div className="active-filter-bar">
      {chips.map((chip) => (
        <button key={chip.id} type="button" onClick={chip.remove}>
          {chip.label}
          <X aria-hidden="true" />
        </button>
      ))}
      <span>
        {matching} von {data.machines.length} Geräten
      </span>
      <button type="button" className="clear-all" onClick={clearMachineFilter}>
        Alle löschen
      </button>
    </div>
  );
}
