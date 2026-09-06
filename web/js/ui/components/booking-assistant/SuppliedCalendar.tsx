import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from 'cn';

/** Local-calendar Dates match the supplied UI; conversion to ISO happens only at the adapter. */
export function Calendar(props: DayPickerProps) {
  return (
    <DayPicker
      {...props}
      weekStartsOn={1}
      showOutsideDays
      className="p-1"
      classNames={{
        months: 'relative flex flex-wrap gap-4',
        month: 'space-y-3',
        month_caption: 'flex h-8 items-center justify-center',
        caption_label: 'text-sm font-medium',
        nav: 'absolute inset-x-0 top-0 flex justify-between',
        button_previous:
          'inline-flex size-8 items-center justify-center rounded-md border border-input hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        button_next:
          'inline-flex size-8 items-center justify-center rounded-md border border-input hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        month_grid: 'w-auto border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-xs font-normal text-muted-foreground',
        week: 'mt-1 flex',
        day: 'relative size-9 text-center text-sm',
        day_button:
          'size-9 rounded-md font-normal hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:relative focus-visible:z-10',
        selected:
          '[&:not(.assistant-range-middle)>button]:bg-primary-deep [&:not(.assistant-range-middle)>button]:text-primary-foreground',
        range_start: 'rounded-l-md bg-accent',
        range_end: 'rounded-r-md bg-accent',
        range_middle:
          'assistant-range-middle [&>button]:rounded-none [&>button]:bg-accent [&>button]:text-accent-foreground',
        today: '[&>button]:ring-1 [&>button]:ring-primary',
        outside: 'opacity-40',
        disabled: 'opacity-30',
        hidden: 'invisible',
      }}
      components={{
        Chevron: ({ orientation, className }) =>
          orientation === 'left' ? (
            <ChevronLeft className={cn('size-4', className)} />
          ) : (
            <ChevronRight className={cn('size-4', className)} />
          ),
      }}
    />
  );
}
