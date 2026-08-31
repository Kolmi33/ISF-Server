// The toolbar "Alle Bereiche ▾" group-filter dropdown (Phase 7 slice B10e). Faithful port of
// legacy `fillGroupSel`/`updateGroupBtn`/`groupList`. Mounted once at boot onto `#groupDrop`,
// same pattern as `MachineFilterDropdown.tsx` onto `#machDrop`; open/close mechanics are
// `ui/toolbar-dropdown.ts`, shared with it.

import { useEffect, useReducer } from 'react';
import { saveFilters } from './MachineFilterDropdown.tsx';
import { useToolbarDropdown } from '../toolbar-dropdown.ts';

/** The distinct group names across every machine, first-seen order. Faithful port of legacy
 *  `groupList`. */
function groupList(): string[] {
  return [...new Set(window.S.data!.machines.map((m) => m.group))];
}

/** Refresh `#groupBtn`'s label from `S.groupsSel`. `#groupBtn` is static markup, not
 *  React-rendered — mutated directly, matching legacy. Faithful port of legacy
 *  `updateGroupBtn`. */
function updateGroupBtn(): void {
  const button = document.getElementById('groupBtn');
  if (!button) return;
  const count = window.S.groupsSel.size;
  button.textContent =
    count === 0 ? 'Alle Bereiche ▾' : `${count} Bereich${count > 1 ? 'e' : ''} ▾`;
}

let refreshGroupList: (() => void) | null = null;

/** Force the dropdown to recompute its group list next render — e.g. after a machine form
 *  (B6) save adds/renames/removes a group, or a "structural" SSE update reloads `S.data`.
 *  Faithful port of legacy `fillGroupSel`'s "rebuild the list" half (the checkbox-wiring half
 *  needs no equivalent — React re-derives `checked` from `S.groupsSel` on every render). */
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
    window.S.groupsSel.clear();
    saveFilters();
    window.notify();
    bumpTick();
  }

  function handleGroupChange(group: string, checked: boolean): void {
    if (checked) window.S.groupsSel.add(group);
    else window.S.groupsSel.delete(group);
    if (window.S.groupsSel.size === groupList().length) window.S.groupsSel.clear(); // all = all
    saveFilters();
    window.notify();
    bumpTick();
  }

  const groups = groupList();
  return (
    <>
      <label>
        <input type="checkbox" checked={window.S.groupsSel.size === 0} onChange={handleAllChange} />{' '}
        <b>Alle Bereiche</b>
      </label>
      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />
      {groups.map((group) => (
        <label key={group}>
          <input
            type="checkbox"
            checked={window.S.groupsSel.has(group)}
            onChange={(event) => handleGroupChange(group, event.target.checked)}
          />{' '}
          {group}
        </label>
      ))}
    </>
  );
}
