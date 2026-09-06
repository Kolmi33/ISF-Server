import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from 'cn';

/* Keyboard focus opens the tooltip and `aria-describedby` points at it, so the hint is
   reachable without a pointer — hence the shared id/open state rather than the bare
   Base UI parts. */
const HelpContext = createContext<{ id: string; open: boolean; setOpen: (open: boolean) => void }>(
  null!,
);

export function TooltipProvider({
  delayDuration,
  children,
}: {
  delayDuration: number;
  children: ReactNode;
}) {
  return <TooltipPrimitive.Provider delay={delayDuration}>{children}</TooltipPrimitive.Provider>;
}

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
  side: 'right' | 'top' | 'bottom' | 'left';
}) {
  const { id } = useContext(HelpContext);
  return (
    <TooltipPrimitive.Portal container={document.getElementById('modal')}>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={8}
        collisionPadding={12}
        className="ui-scope z-[170]"
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
