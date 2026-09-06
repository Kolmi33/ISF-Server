import { Search } from 'lucide-react';
import { cn } from 'cn';
import { Button } from './primitives.tsx';
import { Separator } from './primitives.tsx';
import { NumberField } from './NumberField.tsx';
import { FOOTER_SHELL } from './styles.ts';
import { FOOTER_SHELL_IDLE } from './styles.ts';
import { DateRangeField } from './DateRangeField.tsx';
import { type AssistantState } from './useAssistantState.ts';

export function AssistantFooter({ state }: { state: AssistantState }) {
  const { range, applyRange, today, onCancel, selectedDeviceIds, runSearch, view } = state;

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-3 border-t border-border bg-muted/50 px-6 py-4 sm:flex-nowrap sm:px-7">
      <DateRangeField range={range} onApply={applyRange} today={today} />

      <Separator orientation="vertical" className="hidden h-[68px] sm:block" />

      <DurationFields state={state} />

      <Separator orientation="vertical" className="ml-auto hidden h-[68px] sm:block" />

      <div className={cn('flex items-center gap-2 px-3', FOOTER_SHELL, FOOTER_SHELL_IDLE)}>
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button size="lg" disabled={selectedDeviceIds.length === 0} onClick={runSearch}>
          <Search className="size-4" />
          {view === 'results' ? 'Neu suchen' : 'Freie Termine suchen'}
        </Button>
      </div>
    </footer>
  );
}
function DurationFields({ state }: { state: AssistantState }) {
  const { limitHint, minDays, maxDays, changeMinDays, changeMaxDays, rangeLength, flagLimit } =
    state;
  return (
    <div
      className={cn(
        'relative flex items-center gap-4 px-3',
        FOOTER_SHELL,
        limitHint ? 'border-destructive/50 bg-background' : FOOTER_SHELL_IDLE,
      )}
    >
      <NumberField
        label="Min. Tage"
        value={minDays}
        onChange={changeMinDays}
        max={rangeLength}
        onLimit={flagLimit}
      />
      <NumberField
        label="Max. Tage"
        value={maxDays}
        onChange={changeMaxDays}
        max={rangeLength}
        onLimit={flagLimit}
      />
      {limitHint && (
        <span
          key={limitHint.seq}
          role="alert"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-destructive/45 bg-card px-3 py-1.5 text-xs font-medium text-destructive shadow-lg animate-in fade-in slide-in-from-bottom-1"
        >
          {limitHint.message}
        </span>
      )}
    </div>
  );
}
