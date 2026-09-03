// =======================================================================================
// GROUP FILTER DROPDOWN COMPONENT (web/js/ui/components/GroupFilterDropdown.tsx)
// =======================================================================================
//
// The toolbar "Alle Bereiche ▾" group-filter dropdown. Mounted once at boot onto
// `#groupDrop`, the same pattern `MachineFilterDropdown.tsx` uses onto `#machDrop`; its
// open/close mechanics are the shared `ui/toolbar-dropdown.ts` hook.
//
// =======================================================================================

import { useEffect, useReducer } from 'react';
import { saveFilters } from './MachineFilterDropdown.tsx';
import { useToolbarDropdown } from '../toolbar-dropdown.ts';
import { store } from '../../store-instance.ts';

/** Lists the distinct group names across every machine, in first-seen order. */
function groupList(): string[] {
  return [...new Set(store.get('data')!.machines.map((m) => m.group))];
}

/** Refreshes `#groupBtn`'s label from the current group selection. `#groupBtn` is static
 *  markup, not React-rendered, so its text is mutated directly rather than through JSX. */
function updateGroupBtn(): void {
  const button = document.getElementById('groupBtn');
  if (!button) return;
  const count = store.get('groupsSel').size;
  button.textContent =
    count === 0 ? 'Alle Bereiche ▾' : `${count} Bereich${count > 1 ? 'e' : ''} ▾`;
}

let refreshGroupList: (() => void) | null = null;

/** Forces the dropdown to recompute its group list on next render — e.g. after a machine
 *  form save adds/renames/removes a group, or a "structural" SSE update reloads the
 *  machine data. The checkbox-wiring side needs no equivalent hook, since React already
 *  re-derives each `checked` prop from the live selection on every render. */
export function fillGroupSel(): void {
  refreshGroupList?.();
}

/** Mounted once at boot onto `#groupDrop`. */
export function GroupFilterDropdown() {
  const { isOpen } = useToolbarDropdown('groupDrop', 'groupBtn');
  const [, bumpTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    refreshGroupList = bumpTick;
    return () => {
      refreshGroupList = null;
    };
  }, []);

  useEffect(updateGroupBtn);

  if (!isOpen) return null;

  function handleAllChange(): void {
    store.get('groupsSel').clear();
    saveFilters();
    store.notify();
    bumpTick();
  }

  function handleGroupChange(group: string, checked: boolean): void {
    if (checked) store.get('groupsSel').add(group);
    else store.get('groupsSel').delete(group);
    if (store.get('groupsSel').size === groupList().length) store.get('groupsSel').clear(); // all = all
    saveFilters();
    store.notify();
    bumpTick();
  }

  const groups = groupList();
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={store.get('groupsSel').size === 0}
          onChange={handleAllChange}
        />{' '}
        <b>Alle Bereiche</b>
      </label>
      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />
      {groups.map((group) => (
        <label key={group}>
          <input
            type="checkbox"
            checked={store.get('groupsSel').has(group)}
            onChange={(event) => handleGroupChange(group, event.target.checked)}
          />{' '}
          {group}
        </label>
      ))}
    </>
  );
}
