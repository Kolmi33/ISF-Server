import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { formatDateAsIsoString, parseIsoDateString } from '../../../../shared/dates.ts';
import { Button } from './button.tsx';
import { Calendar } from './calendar.tsx';

/** Editable calendar draft; only a complete applied range updates the owner. */
export function DateRangeCalendar({
  from,
  to,
  onChange,
  onClose,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DateRange | undefined>(() => ({
    from: from ? parseIsoDateString(from) : undefined,
    to: to ? parseIsoDateString(to) : undefined,
  }));
  const complete = !!draft?.from && !!draft.to;
  return (
    <>
      <p className="range-instruction" aria-live="polite">
        {draft?.from && !draft.to
          ? 'Enddatum wählen (derselbe Tag ist möglich).'
          : 'Start- und Enddatum wählen.'}
      </p>
      <Calendar
        mode="range"
        required
        resetOnSelect
        selected={draft}
        onSelect={setDraft}
        defaultMonth={draft?.from}
        numberOfMonths={2}
      />
      <div className="range-popup-actions">
        <Button variant="ghost" onClick={onClose}>
          Abbrechen
        </Button>
        <Button
          disabled={!complete}
          onClick={() => {
            if (!draft?.from || !draft.to) return;
            onChange(formatDateAsIsoString(draft.from), formatDateAsIsoString(draft.to));
            onClose();
          }}
        >
          Zeitraum übernehmen
        </Button>
      </div>
    </>
  );
}
