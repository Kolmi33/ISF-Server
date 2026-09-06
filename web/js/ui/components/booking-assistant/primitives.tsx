import {
  createContext,
  useContext,
  useId,
  useState,
  forwardRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { ScrollArea as ScrollPrimitive } from '@base-ui/react/scroll-area';
import { cn } from 'cn';
import { Button as AppButton } from '../../../components/ui/button.tsx';
export { Input } from '../../../components/ui/input.tsx';
export { Checkbox } from '../../../components/ui/checkbox.tsx';
export { Separator } from '../../../components/ui/separator.tsx';
export { Calendar } from './SuppliedCalendar.tsx';

/** Preserve the supplied shadcn sizing/API using the installed Base UI variant. */
export const Button = forwardRef<HTMLButtonElement, ComponentProps<typeof AppButton>>(
  function Button({ className, variant = 'default', size = 'default', ...props }, ref) {
    return (
      <AppButton
        ref={ref}
        variant={variant}
        size={size}
        {...props}
        className={cn(
          'gap-2',
          size === 'default' && 'h-9 px-4',
          size === 'lg' && 'h-10 px-4',
          size === 'sm' && 'h-8 px-3',
          size === 'icon' && 'size-9',
          variant === 'default' && 'bg-primary-deep hover:bg-primary-deep/90',
          className,
        )}
      />
    );
  },
);

export function Label(props: ComponentProps<'label'>) {
  return <label {...props} />;
}
export function Badge({
  className,
  variant = 'secondary',
  ...props
}: ComponentProps<'span'> & { variant?: 'secondary' }) {
  return (
    <span
      {...props}
      className={cn(
        variant === 'secondary' &&
          'inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground',
        className,
      )}
    />
  );
}

export const Popover = PopoverPrimitive.Root;
export function PopoverTrigger({ children }: { asChild: true; children: ReactElement }) {
  return <PopoverPrimitive.Trigger render={children} />;
}
export function PopoverContent({
  children,
  className,
  side,
  align,
}: {
  children: ReactNode;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <PopoverPrimitive.Portal container={document.getElementById('modal')}>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={12}
        className="booking-assistant z-[160]"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'max-h-[var(--available-height)] max-w-[calc(100vw-24px)] overflow-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none',
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

const HelpContext = createContext<{ id: string; open: boolean; setOpen: (open: boolean) => void }>(
  null!,
);
export function Tooltip({ children }: { children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <HelpContext.Provider value={{ id, open, setOpen }}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        {children}
      </TooltipPrimitive.Root>
    </HelpContext.Provider>
  );
}
export function TooltipProvider({
  delayDuration,
  children,
}: {
  delayDuration: number;
  children: ReactNode;
}) {
  return <TooltipPrimitive.Provider delay={delayDuration}>{children}</TooltipPrimitive.Provider>;
}
export function TooltipTrigger({ children }: { asChild: true; children: ReactElement }) {
  const { id, open, setOpen } = useContext(HelpContext);
  return (
    <TooltipPrimitive.Trigger
      render={children}
      aria-describedby={open ? id : undefined}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    />
  );
}
export function TooltipContent({
  children,
  className,
  side,
}: {
  children: ReactNode;
  className?: string;
  side: 'right';
}) {
  const { id } = useContext(HelpContext);
  return (
    <TooltipPrimitive.Portal container={document.getElementById('modal')}>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={8}
        collisionPadding={12}
        className="booking-assistant z-[170]"
      >
        <TooltipPrimitive.Popup
          id={id}
          role="tooltip"
          className={cn(
            'rounded-md bg-foreground px-3 py-2 text-xs text-background shadow-md',
            className,
          )}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export function ScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ScrollPrimitive.Root className={cn('relative overflow-hidden', className)}>
      <ScrollPrimitive.Viewport className="h-full w-full rounded-[inherit] [scrollbar-gutter:stable] outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {children}
      </ScrollPrimitive.Viewport>
      <ScrollPrimitive.Scrollbar className="flex w-2 p-0.5">
        <ScrollPrimitive.Thumb className="flex-1 rounded-full bg-border" />
      </ScrollPrimitive.Scrollbar>
    </ScrollPrimitive.Root>
  );
}
