// =======================================================================================
// MY BOOKINGS FILTER ROW + "ONLY MY MACHINES" SHORTCUT (web/js/ui/components/MyBookingsFilters.tsx)
// =======================================================================================
//
// Split out of MyBookingsModal.tsx purely to stay under the file-length budget: the filter
// row (Maschine/Bereich/Sortieren/date window) and the "only my machines" shortcut button,
// both otherwise self-contained pieces of that modal's toolbar.
//
// =======================================================================================

import type { ChangeEvent } from 'react';
import { CATEGORIES, CATEGORY_FILTER_PREFIX, type CategoryGroups } from '../../core/machines.ts';
import type { MyBookingsFilter } from '../views/my-bookings.ts';
import { closeReactModal } from '../modal.tsx';
import { toast } from '../toast.ts';
import { GroupOptions } from './GroupOptions.tsx';
import { store } from '../../store-instance.ts';
import { saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'termin', label: 'Termin der Buchung' },
  { value: 'erstellt', label: 'Zuletzt gebucht' },
  { value: 'bereich', label: 'Bereich' },
  { value: 'maschine', label: 'Maschine' },
];

interface MyBookingsFiltersProps {
  filter: MyBookingsFilter;
  groupOptions: readonly CategoryGroups[];
  onChange: (patch: Partial<MyBookingsFilter>) => void;
}

/** The filter row: the same shape as `AllBookingsModal.tsx`'s own `AllBookingsFilters` — a
 *  Maschine text filter, a Bereich select (grouped by category, plus whole-category options),
 *  a sort key, and a date-overlap window — minus the Person field that one also has, since
 *  every run here is already known to be the current user's own (user request). */
export function MyBookingsFilters({ filter, groupOptions, onChange }: MyBookingsFiltersProps) {
  const onInput =
    (key: keyof MyBookingsFilter) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ [key]: event.target.value });
  return (
    <div className="abfilters">
      <div className="fld">
        <label>Maschine</label>
        <input type="text" placeholder="Berger" value={filter.mach} onChange={onInput('mach')} />
      </div>
      <div className="fld">
        <label>Bereich</label>
        <select value={filter.group} onChange={onInput('group')}>
          <option value="">Alle</option>
          {groupOptions.map(({ category }) => (
            <option key={`cat:${category}`} value={`${CATEGORY_FILTER_PREFIX}${category}`}>
              {CATEGORIES.find((c) => c.id === category)?.label ?? category} (alle Bereiche)
            </option>
          ))}
          <GroupOptions groupOptions={groupOptions} />
        </select>
      </div>
      <div className="fld">
        <label>Sortieren</label>
        <select value={filter.sort} onChange={onInput('sort')}>
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="fld">
        <label>Von</label>
        <input type="date" value={filter.from} onChange={onInput('from')} />
      </div>
      <div className="fld">
        <label>Bis</label>
        <input type="date" value={filter.to} onChange={onInput('to')} />
      </div>
    </div>
  );
}

export function MachineFilterButton({ machineIds }: { machineIds: readonly string[] }) {
  if (!machineIds.length) return null;
  function apply(): void {
    // Silent — saveFilters()/updateMachBtn() run before the one notify, matching the
    // original's single window.notify() after this write and both those calls.
    store.state.machSel = new Set(machineIds);
    saveFilters();
    updateMachBtn();
    store.notify();
    closeReactModal();
    toast(
      `Plan gefiltert: nur deine ${machineIds.length} Maschine${machineIds.length === 1 ? '' : 'n'}. Aufheben über „Filtern → Filter löschen".`,
      undefined,
      6000,
    );
  }
  // Styled to read as a toggle switch (user request), even though the underlying action stays
  // a one-shot "apply and close" click, not a persisted on/off state — clicking it always
  // narrows the grid's filter and immediately leaves this modal, same as before.
  return (
    <div style={{ marginBottom: 8 }}>
      <button className="btn small switchbtn" onClick={apply}>
        <span className="switchtrack" aria-hidden="true">
          <span className="switchthumb" />
        </span>
        Nur meine Maschinen im Plan zeigen ({machineIds.length})
      </button>
    </div>
  );
}
