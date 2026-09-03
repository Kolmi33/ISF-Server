// =======================================================================================
// STATS CONTROLS COMPONENT (web/js/ui/components/StatsControls.tsx)
// =======================================================================================
//
// The Statistik modal's top controls: date range, mode segmented buttons, the category
// show/hide row (Ressourcen mode only), and the filter input + drilldown back button.
// Split out of `StatsModal.tsx` purely to stay under the file-length/function-length
// budgets — conceptually this is one modal.
//
// =======================================================================================

import type { ChangeEvent } from 'react';
import { CATEGORIES } from '../../core/machines.ts';
import { Icon } from './Icon.tsx';

export type StatsMode = 'm' | 'p' | 'w';

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

interface StatsModeRowProps {
  mode: StatsMode;
  onModeChange: (mode: StatsMode) => void;
  visibleCategories: ReadonlySet<string>;
  onToggleCategory: (id: string) => void;
}

/** The Ressourcen/Personen/Wartung segmented buttons, plus (Ressourcen mode only) the
 *  category show/hide row. */
export function StatsModeRow({
  mode,
  onModeChange,
  visibleCategories,
  onToggleCategory,
}: StatsModeRowProps) {
  return (
    <div className="formrow">
      <div className="seg">
        <button className={mode === 'm' ? 'on' : ''} onClick={() => onModeChange('m')}>
          <Icon name="factory" /> Ressourcen
        </button>
        <button className={mode === 'p' ? 'on' : ''} onClick={() => onModeChange('p')}>
          <Icon name="user" /> Personen
        </button>
        <button className={mode === 'w' ? 'on' : ''} onClick={() => onModeChange('w')}>
          <Icon name="bolt" /> Wartung
        </button>
      </div>
      {mode === 'm' && (
        <div className="seg" role="group" aria-label="Kategorie wählen">
          {CATEGORIES.map(({ id, label, icon }) => (
            <button
              key={id}
              className={visibleCategories.has(id) ? 'on' : ''}
              aria-pressed={visibleCategories.has(id)}
              onClick={() => onToggleCategory(id)}
            >
              <Icon name={icon} /> {label}
            </button>
          ))}
        </div>
      )}
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
