import type { ReactElement, ReactNode } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from 'cn';

export const Popover = PopoverPrimitive.Root;

export function PopoverTrigger({ children }: { asChild: true; children: ReactElement }) {
  return <PopoverPrimitive.Trigger render={children} />;
}

/** Portals into `#modal` and re-applies `ui-scope`, because a portalled popup leaves the
 *  dialog's subtree and would otherwise lose the palette (docs/UI_STYLE_GUIDE.md §2). */
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
        className="ui-scope z-[160]"
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
