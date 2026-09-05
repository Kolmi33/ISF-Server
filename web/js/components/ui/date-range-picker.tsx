import { useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { IconArrowRight, IconCalendar } from '@tabler/icons-react';
import { Button } from './button.tsx';
import { Input } from './input.tsx';
import { DateRangeCalendar } from './date-range-calendar.tsx';

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

function DateEndpoint({
  id,
  label,
  value,
  onChange,
  trigger,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  trigger: ReactNode;
}) {
  return (
    <div className="date-range-endpoint">
      <label htmlFor={id}>{label}</label>
      <div className="date-range-control">
        <Input id={id} type="date" value={value} onChange={onChange} />
        {trigger}
      </div>
    </div>
  );
}

function CalendarTrigger({ label }: { label: string }) {
  return (
    <Popover.Trigger
      render={<Button variant="outline" size="icon" className="date-endpoint-trigger" />}
      aria-label={label}
    >
      <IconCalendar size={16} aria-hidden="true" />
    </Popover.Trigger>
  );
}

/** One compound range field: synchronized editable endpoints plus a shared range calendar. */
export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const id = useId();
  const fieldRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div ref={fieldRef} className="date-range-field" role="group" aria-label="Suchzeitraum">
        <DateEndpoint
          id={`${id}-from`}
          label="Suchen von"
          value={from}
          trigger={<CalendarTrigger label="Startdatum im Kalender wählen" />}
          onChange={(event) => {
            const value = event.target.value;
            onChange(value, value && to && value > to ? value : to);
          }}
        />
        <IconArrowRight size={18} aria-hidden="true" className="range-arrow" />
        <DateEndpoint
          id={`${id}-to`}
          label="bis"
          value={to}
          trigger={<CalendarTrigger label="Enddatum im Kalender wählen" />}
          onChange={(event) => {
            const value = event.target.value;
            onChange(value && from && value < from ? value : from, value);
          }}
        />
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
