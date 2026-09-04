// =======================================================================================
// STATS CONTROLS COMPONENT (web/js/ui/components/StatsControls.tsx)
// =======================================================================================
//
// The Statistik modal's top controls: date range, the Ressourcen-mode category tabs, a
// breadcrumb trail while drilled in, and the filter input + drilldown back button. Split out
// of `StatsModal.tsx` purely to stay under the file-length/function-length budgets —
// conceptually this is one modal.
//
// =======================================================================================

import type { ChangeEvent } from 'react';
import type { MachineCategory } from '../../../../shared/types.ts';
import { CATEGORIES } from '../../core/machines.ts';
import { Icon } from './Icon.tsx';

/** The modal's overall mode — 'm' (Ressourcen, the only one reachable from the UI itself) or
 *  'p' (Personen). Personen has no visible entry point of its own (user request, 2026-09): it's
 *  only reached via a booking's "Statistik" button (`BookingDetailModal.tsx`), which opens
 *  `openStats(presetPerson)` straight into that person's drilldown; from there, the drilldown's
 *  own "← Übersicht" back button lands on the Personen overview list. Since the mode has no
 *  visible switcher any more, it's fixed for the lifetime of one modal instance — set once at
 *  open, never changed afterward. */
export type StatsMode = 'm' | 'p';

interface StatsRangeRowProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

/** The "Von"/"Bis" date-range inputs. */
export function StatsRangeRow({ from, to, onFromChange, onToChange }: StatsRangeRowProps) {
  return (
    <div className="formrow">
      <label>Von</label>
      <input
        type="date"
        value={from}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onFromChange(event.target.value)}
      />
      <label style={{ minWidth: 'auto' }}>Bis</label>
      <input
        type="date"
        value={to}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onToChange(event.target.value)}
      />
    </div>
  );
}

interface CategoryTabsProps {
  activeCategory: MachineCategory;
  onCategoryChange: (category: MachineCategory) => void;
}

/** The Ressourcen-mode category tabs — Maschinen / Messtechnik as top-level, single-select
 *  tabs (user request), replacing both the old Ressourcen/Personen/Wartung primary tab switch
 *  (Wartung is gone, folded into each row's own stacked bar; Personen has no visible switcher)
 *  and the old multi-select "show both at once" pill row. Exactly one category is ever active. */
export function CategoryTabs({ activeCategory, onCategoryChange }: CategoryTabsProps) {
  return (
    <div className="seg fill" role="tablist" aria-label="Kategorie wählen">
      {CATEGORIES.map(({ id, label, icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={activeCategory === id}
          className={activeCategory === id ? 'on' : ''}
          onClick={() => onCategoryChange(id)}
        >
          <Icon name={icon} /> {label}
        </button>
      ))}
    </div>
  );
}

/** A breadcrumb trail while drilled into a machine or person (user request: "users should
 *  always know their depth within the data") — shown only once there's actual depth to show;
 *  the top-level overview has nothing to trail. Sits above the existing "← Übersicht" back
 *  button rather than replacing it, so that button's own tested behavior stays exactly as is. */
export function StatsBreadcrumb({ segments }: { segments: readonly string[] }) {
  // "Statistik" + the category/Personen level alone isn't real depth yet — that's just the
  // top-level overview, which has nothing worth trailing. Only a genuine drilldown (a third
  // segment: the machine or person name) earns the breadcrumb.
  if (segments.length < 3) return null;
  return (
    <div className="hint breadcrumb" style={{ margin: '0 0 6px' }}>
      {segments.join(' / ')}
    </div>
  );
}

interface StatsFilterRowProps {
  filterQuery: string;
  onFilterChange: (value: string) => void;
  showBack: boolean;
  onBack: () => void;
}

/** The name filter input, plus the "← Übersicht" back button while a drilldown is open. */
export function StatsFilterRow({
  filterQuery,
  onFilterChange,
  showBack,
  onBack,
}: StatsFilterRowProps) {
  return (
    <div className="formrow">
      <input
        type="text"
        placeholder="filtern…"
        style={{ flex: 1, minWidth: 120 }}
        autoComplete="off"
        value={filterQuery}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onFilterChange(event.target.value)}
      />
      {showBack && (
        <button className="btn small" onClick={onBack}>
          ← Übersicht
        </button>
      )}
    </div>
  );
}
