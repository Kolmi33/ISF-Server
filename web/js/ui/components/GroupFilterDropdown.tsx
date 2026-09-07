// =======================================================================================
// GROUP FILTER DROPDOWN COMPONENT (web/js/ui/components/GroupFilterDropdown.tsx)
// =======================================================================================
//
// The toolbar "Alle Bereiche ▾" group-filter dropdown. Mounted once at boot onto
// `#groupDrop`, the same pattern `MachineFilterDropdown.tsx` uses onto `#machDrop`; its
// open/close mechanics are the shared `ui/toolbar-dropdown.ts` hook.
//
// =======================================================================================

import { useEffect, useId, useReducer } from 'react';
import { saveFilters } from './MachineFilterDropdown.tsx';
import { useToolbarDropdown } from '../toolbar-dropdown.ts';
import { store } from '../../store-instance.ts';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { Separator } from '../../components/ui/separator.tsx';
import { SectionHeading } from './app/SectionHeading.tsx';

/** One selectable row, matching the Assistant's own catalogue row (docs/UI_STYLE_GUIDE.md §12). */
function GroupRow({
  label,
  checked,
  strong,
  onToggle,
}: {
  label: string;
  checked: boolean;
  strong?: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer select-none items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
        checked ? 'border-primary/45 bg-primary/[0.08]' : 'border-transparent hover:bg-muted'
      }`}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onToggle(next)}
        className="size-[18px] rounded-[5px]"
      />
      <span
        className={`min-w-0 truncate ${strong ? 'font-semibold text-foreground' : 'text-foreground'}`}
      >
        {label}
      </span>
    </label>
  );
}

/** Lists the distinct group names across every machine, in first-seen order. */
function groupList(): string[] {
  return [...new Set(store.get('data')!.machines.map((m) => m.group))];
}

/** Refreshes `#groupBtn`'s label from the current group selection, plus the toolbar's own
 *  quick-clear "×" (`#groupClearBtn`, next to `#groupBtn` inside their shared `#groupWrap` box
 *  — user request: clear an active filter instantly from the main view, without opening the
 *  dropdown at all). Both are static markup, not React-rendered, so mutated directly rather
 *  than through JSX. The `filtered` class on the wrap merges the "×" visually into the same
 *  box as the button once it's shown (see `updateMachBtn`'s own comment / app.css). */
function updateGroupBtn(): void {
  const button = document.getElementById('groupBtn');
  if (button) {
    const count = store.get('groupsSel').size;
    button.textContent =
      count === 0 ? 'Alle Bereiche ▾' : `${count} Bereich${count > 1 ? 'e' : ''} ▾`;
  }
  const clearButton = document.getElementById('groupClearBtn');
  const isFiltered = store.get('groupsSel').size > 0;
  if (clearButton) clearButton.style.display = isFiltered ? '' : 'none';
  document.getElementById('groupWrap')?.classList.toggle('filtered', isFiltered);
}

/** Clears the group filter selection — the toolbar quick-clear's own action, reachable
 *  without opening the dropdown. `handleAllChange` below (the popover's own "Alle Bereiche"
 *  row) calls this too (plus its local `bumpTick`, needed only while the dropdown is actually
 *  mounted/open), so both routes stay in lockstep. */
export function clearGroupFilter(): void {
  store.get('groupsSel').clear();
  saveFilters();
  store.notify();
  updateGroupBtn();
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
    clearGroupFilter();
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
    <div className="ui-scope w-[16rem] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
      <SectionHeading label="Bereiche" className="px-1.5 pb-2 pt-1" />
      <GroupRow
        label="Alle Bereiche"
        strong
        checked={store.get('groupsSel').size === 0}
        onToggle={handleAllChange}
      />
      <Separator className="my-1.5" />
      <ScrollArea className="-mr-2 max-h-72 pr-2">
        <div className="flex flex-col gap-0.5">
          {groups.map((group) => (
            <GroupRow
              key={group}
              label={group}
              checked={store.get('groupsSel').has(group)}
              onToggle={(checked) => handleGroupChange(group, checked)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
