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

import { useId, type ChangeEvent } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from 'cn';
import type { MachineCategory } from '../../../../shared/types.ts';
import { CATEGORIES } from '../../core/machines.ts';
import { Icon } from './Icon.tsx';
import { Button } from '../../components/ui/app-button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { FormField } from './app/FormField.tsx';
import { SearchField } from './app/SearchField.tsx';

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
  const fromId = useId();
  const toId = useId();
  return (
    <div className="grid shrink-0 grid-cols-2 gap-3">
      <FormField label="Von" htmlFor={fromId}>
        <Input
          id={fromId}
          type="date"
          className="h-10 rounded-lg"
          value={from}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onFromChange(event.target.value)}
        />
      </FormField>
      <FormField label="Bis" htmlFor={toId}>
        <Input
          id={toId}
          type="date"
          className="h-10 rounded-lg"
          value={to}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onToChange(event.target.value)}
        />
      </FormField>
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
 *  and the old multi-select "show both at once" pill row. Exactly one category is ever active.
 *
 *  A segmented control rather than shadcn `Tabs`: these two buttons switch the whole body's
 *  data source, not sibling panels inside one region, so there is no tab panel to associate —
 *  the `tablist`/`tab` roles are kept for the same reason they were there before. */
export function CategoryTabs({ activeCategory, onCategoryChange }: CategoryTabsProps) {
  return (
    <div
      className="seg flex shrink-0 gap-1 rounded-lg border border-border bg-muted/50 p-1"
      role="tablist"
      aria-label="Kategorie wählen"
    >
      {CATEGORIES.map(({ id, label, icon }) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={activeCategory === id}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            activeCategory === id
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onCategoryChange(id)}
        >
          <span className="inline-flex [&_svg]:size-4">
            <Icon name={icon} />
          </span>
          {label}
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
    <div className="breadcrumb shrink-0 text-[11px] font-medium text-muted-foreground">
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

/** The name filter, plus the "back to the overview" button while drilled in. */
export function StatsFilterRow({
  filterQuery,
  onFilterChange,
  showBack,
  onBack,
}: StatsFilterRowProps) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <SearchField
        wrapperClassName="min-w-0 flex-1"
        placeholder="filtern…"
        aria-label="Liste filtern"
        value={filterQuery}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onFilterChange(event.target.value)}
      />
      {showBack && (
        <Button variant="outline" size="lg" className="shrink-0" onClick={onBack}>
          <ChevronLeft className="size-4" /> Übersicht
        </Button>
      )}
    </div>
  );
}
