import { useId, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="date-range-endpoint">
      <label htmlFor={id}>{label}</label>
      <Input id={id} type="date" value={value} onChange={onChange} />
      <IconCalendar className="date-endpoint-icon" size={16} aria-hidden="true" />
    </div>
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
          onChange={(event) => {
            const value = event.target.value;
            onChange(value && from && value < from ? value : from, value);
          }}
        />
        <Popover.Trigger
          render={<Button variant="outline" size="icon-lg" />}
          aria-label="Zeitraum im Kalender wählen"
        >
          <IconCalendar size={18} aria-hidden="true" />
        </Popover.Trigger>
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
