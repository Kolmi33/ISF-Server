import * as React from 'react';
import { addDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { cn } from 'cn';
import { Button } from './primitives.tsx';
import { Calendar } from './primitives.tsx';
import { Popover } from './primitives.tsx';
import { PopoverContent } from './primitives.tsx';
import { PopoverTrigger } from './primitives.tsx';
import { type DateRange } from '../../../core/booking-assistant-types.ts';
import { formatDate } from './model.ts';
import { countDays } from './model.ts';
import { LABEL_CLASS } from './styles.ts';
import { FOOTER_SHELL } from './styles.ts';
import { FOOTER_SHELL_IDLE } from './styles.ts';
import { FOOTER_SHELL_ACTIVE } from './styles.ts';

export function DateRangeField({
  range,
  onApply,
  today,
}: {
  range: DateRange;
  onApply: (range: DateRange) => void;
  /** frühester wählbarer Tag */
  today: Date;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DateRange>(range);

  React.useEffect(() => {
    if (open) setDraft(range);
  }, [open, range]);

  const draftLength = draft.from && draft.to ? countDays(draft.from, draft.to) : null;
  const appliedLength = range.from && range.to ? countDays(range.from, range.to) : null;

  const applyPreset = (days: number) => {
    const start = draft.from ?? today;
    setDraft({ from: start, to: addDays(start, days - 1) });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <RangeTrigger open={open} range={range} appliedLength={appliedLength} />

      <PopoverContent align="start" side="top" className="w-auto p-3">
        <div className="mb-2 flex items-center justify-center gap-1.5">
          {[7, 14, 30].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => applyPreset(days)}
              className={cn(
                'rounded-full border border-border px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                draftLength === days && 'border-primary/50 bg-primary/10 text-primary',
              )}
            >
              {days} Tage
            </button>
          ))}
        </div>

        <Calendar
          mode="range"
          locale={de}
          numberOfMonths={2}
          defaultMonth={range.from ?? today}
          selected={{ from: draft.from, to: draft.to }}
          onSelect={(next) => setDraft({ from: next?.from, to: next?.to })}
          disabled={{ before: today }}
        />

        <RangeActions
          draft={draft}
          draftLength={draftLength}
          setDraft={setDraft}
          onApply={onApply}
          setOpen={setOpen}
        />
      </PopoverContent>
    </Popover>
  );
}
function RangeTrigger({
  open,
  range,
  appliedLength,
}: {
  open: boolean;
  range: DateRange;
  appliedLength: number | null;
}) {
  return (
    <PopoverTrigger asChild>
      <button
        type="button"
        className={cn(
          'flex items-center gap-3 px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          FOOTER_SHELL,
          open ? FOOTER_SHELL_ACTIVE : FOOTER_SHELL_IDLE,
        )}
      >
        <CalendarIcon className="size-5 shrink-0 text-muted-foreground" />
        <span className="block">
          <span className={cn('block', LABEL_CLASS)}>
            Zeitraum
            {appliedLength !== null && (
              <span className="ml-1.5 font-mono normal-case tracking-normal">
                · {appliedLength} Tage
              </span>
            )}
          </span>
          <span className="mt-0.5 block font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatDate(range.from)} <span className="text-muted-foreground">→</span>{' '}
            {formatDate(range.to)}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
    </PopoverTrigger>
  );
}
function RangeActions({
  draft,
  draftLength,
  setDraft,
  onApply,
  setOpen,
}: {
  draft: DateRange;
  draftLength: number | null;
  setDraft: (r: DateRange) => void;
  onApply: (r: DateRange) => void;
  setOpen: (v: boolean) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {draft.from ? formatDate(draft.from) : 'Startdatum wählen'}
        {draft.from && ' → '}
        {draft.from && (draft.to ? formatDate(draft.to) : 'Enddatum wählen')}
        {draftLength !== null && `  ·  ${draftLength} Tage`}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDraft({ from: undefined, to: undefined })}
        >
          Zurücksetzen
        </Button>
        <Button
          size="sm"
          disabled={!draft.from || !draft.to}
          onClick={() => {
            onApply(draft);
            setOpen(false);
          }}
        >
          Übernehmen
        </Button>
      </div>
    </div>
  );
}
