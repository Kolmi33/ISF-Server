import { forwardRef, type ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from 'cn';

/** A real `<select>` wearing `Input`'s visual treatment.
 *
 *  Deliberately NOT a shadcn/Base UI listbox: the application's selects carry `<optgroup>`s
 *  built from live data and are driven by keyboard and (in tests) `selectOptions`. Swapping
 *  in a listbox would change interaction behaviour, which the visual-unification work is not
 *  allowed to do. Documented as the one deviation in docs/UI_STYLE_GUIDE.md §9. */
export const NativeSelect = forwardRef<HTMLSelectElement, ComponentProps<'select'>>(
  function NativeSelect({ className, children, ...props }, ref) {
    return (
      <div className="relative w-full min-w-0">
        <select
          ref={ref}
          data-slot="native-select"
          className={cn(
            'h-10 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pl-2.5 pr-8 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    );
  },
);
