import { useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode, RefObject } from 'react';
import { Popover } from '@base-ui/react/popover';
import { IconArrowRight, IconCalendar } from '@tabler/icons-react';
import { Button } from './button.tsx';
import { Input } from './input.tsx';
import { DateRangeCalendar } from './date-range-calendar.tsx';

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Shown beneath the field and wired to both endpoints via `aria-describedby`/`aria-invalid`. */
  error?: string | null;
}

function DateEndpoint({
  id,
  label,
  value,
  onChange,
  trigger,
  errorId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  trigger: ReactNode;
  errorId?: string;
}) {
  return (
    <div className="date-range-endpoint">
      <label htmlFor={id}>{label}</label>
      <div className="date-range-control">
        <Input
          id={id}
          type="date"
          value={value}
          onChange={onChange}
          aria-invalid={!!errorId}
          aria-describedby={errorId}
        />
        {trigger}
      </div>
    </div>
  );
}

function CalendarTrigger({ label }: { label: string }) {
  return (
    <Popover.Trigger
      render={<Button variant="outline" size="icon-lg" className="date-endpoint-trigger" />}
      aria-label={label}
    >
      <IconCalendar size={16} aria-hidden="true" />
    </Popover.Trigger>
  );
}

/** Both endpoints on one row. Each `onChange` also nudges the OTHER endpoint when the entry
 *  would invert the range, so an inverted state is never representable in the first place. */
function EndpointRow({
  id,
  from,
  to,
  onChange,
  errorId,
  fieldRef,
}: {
  id: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  errorId?: string;
  fieldRef: RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={fieldRef} className="date-range-field" role="group" aria-labelledby={`${id}-heading`}>
      <DateEndpoint
        id={`${id}-from`}
        label="Von"
        value={from}
        trigger={<CalendarTrigger label="Startdatum im Kalender wählen" />}
        errorId={errorId}
        onChange={(event) => {
          const value = event.target.value;
          onChange(value, value && to && value > to ? value : to);
        }}
      />
      <IconArrowRight size={18} aria-hidden="true" className="range-arrow" />
      <DateEndpoint
        id={`${id}-to`}
        label="Bis"
        value={to}
        trigger={<CalendarTrigger label="Enddatum im Kalender wählen" />}
        errorId={errorId}
        onChange={(event) => {
          const value = event.target.value;
          onChange(value && from && value < from ? value : from, value);
        }}
      />
    </div>
  );
}

/** One compound range field: synchronized editable endpoints plus a shared range calendar.
 *  The visible "Suchzeitraum" heading doubles as the group's accessible name, so the field
 *  carries the same label → control → error rhythm as the plain fields beside it. */
export function DateRangePicker({ from, to, onChange, error }: DateRangePickerProps) {
  const id = useId();
  const fieldRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const errorId = error ? `${id}-error` : undefined;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="date-range-group">
        <span className="date-range-heading" id={`${id}-heading`}>
          Suchzeitraum
        </span>
        <EndpointRow
          id={id}
          from={from}
          to={to}
          onChange={onChange}
          errorId={errorId}
          fieldRef={fieldRef}
        />
        {error && (
          <span id={errorId} className="assist-field-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <Popover.Portal container={fieldRef}>
        <Popover.Positioner sideOffset={8} align="end" className="range-positioner">
          <Popover.Popup
            className="range-popup"
            data-slot="popover-content"
            aria-label="Suchzeitraum wählen"
          >
            {open && (
              <DateRangeCalendar
                from={from}
                to={to}
                onChange={onChange}
                onClose={() => setOpen(false)}
              />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
