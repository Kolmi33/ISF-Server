// =======================================================================================
// MY BOOKINGS FILTER ROW + "ONLY MY MACHINES" SHORTCUT (web/js/ui/components/MyBookingsFilters.tsx)
// =======================================================================================
//
// Split out of MyBookingsModal.tsx purely to stay under the file-length budget: the filter
// row (Maschine/Bereich/Sortieren/date window) and the "only my machines" shortcut button,
// both otherwise self-contained pieces of that modal's toolbar.
//
// =======================================================================================

import { useId, type ChangeEvent } from 'react';
import { CATEGORIES, CATEGORY_FILTER_PREFIX, type CategoryGroups } from '../../core/machines.ts';
import type { MyBookingsFilter } from '../views/my-bookings.ts';
import { closeReactModal } from '../modal.tsx';
import { toast } from '../toast.ts';
import { GroupOptions } from './GroupOptions.tsx';
import { store } from '../../store-instance.ts';
import { saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';
import { Input } from '../../components/ui/input.tsx';
import { NativeSelect } from '../../components/ui/native-select.tsx';
import { FormField } from './app/FormField.tsx';

// 'maschine' removed from the sort options (user request) — the machine name is already the
// row's own headline, so sorting by it added no real value.
const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'termin', label: 'Termin der Buchung' },
  { value: 'erstellt', label: 'Zuletzt gebucht' },
  { value: 'bereich', label: 'Bereich' },
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
  const ids = { mach: useId(), group: useId(), sort: useId(), from: useId(), to: useId() };
  const onInput =
    (key: keyof MyBookingsFilter) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ [key]: event.target.value });
  return (
    <div className="abfilters grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3">
      <FormField label="Maschine" htmlFor={ids.mach}>
        <Input
          id={ids.mach}
          type="text"
          className="h-10 rounded-lg"
          placeholder="Berger"
          value={filter.mach}
          onChange={onInput('mach')}
        />
      </FormField>
      <FormField label="Bereich" htmlFor={ids.group}>
        <NativeSelect id={ids.group} value={filter.group} onChange={onInput('group')}>
          <option value="">Alle</option>
          {groupOptions.map(({ category }) => (
            <option key={`cat:${category}`} value={`${CATEGORY_FILTER_PREFIX}${category}`}>
              {CATEGORIES.find((c) => c.id === category)?.label ?? category} (alle Bereiche)
            </option>
          ))}
          <GroupOptions groupOptions={groupOptions} />
        </NativeSelect>
      </FormField>
      <FormField label="Sortieren" htmlFor={ids.sort}>
        <NativeSelect id={ids.sort} value={filter.sort} onChange={onInput('sort')}>
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Von" htmlFor={ids.from}>
        <Input
          id={ids.from}
          type="date"
          className="h-10 rounded-lg"
          value={filter.from}
          onChange={onInput('from')}
        />
      </FormField>
      <FormField label="Bis" htmlFor={ids.to}>
        <Input
          id={ids.to}
          type="date"
          className="h-10 rounded-lg"
          value={filter.to}
          onChange={onInput('to')}
        />
      </FormField>
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
    <button
      type="button"
      onClick={apply}
      className="group/switch flex shrink-0 items-center gap-2.5 self-start rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/45 hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden="true"
        className="switchtrack relative inline-block h-[18px] w-8 shrink-0 rounded-full bg-border transition-colors group-hover/switch:bg-primary/40"
      >
        <span className="switchthumb absolute left-0.5 top-0.5 size-3.5 rounded-full bg-card shadow-sm transition-transform group-hover/switch:translate-x-3.5" />
      </span>
      Nur meine Maschinen im Plan zeigen ({machineIds.length})
    </button>
  );
}
