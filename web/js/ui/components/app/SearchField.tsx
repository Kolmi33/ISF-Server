import { forwardRef, type ComponentProps } from 'react';
import { Search } from 'lucide-react';
import { cn } from 'cn';
import { Input } from '../../../components/ui/input.tsx';

/** The Assistant's search box, as a component: a leading magnifier inside a 40px input
 *  (docs/UI_STYLE_GUIDE.md §9). Everything else is a plain `Input` prop. */
export const SearchField = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<'input'>, 'type'> & { wrapperClassName?: string }
>(function SearchField({ className, wrapperClassName, ...props }, ref) {
  return (
    <div className={cn('relative', wrapperClassName)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={ref}
        type="text"
        autoComplete="off"
        className={cn('h-10 rounded-lg pl-9', className)}
        {...props}
      />
    </div>
  );
});
