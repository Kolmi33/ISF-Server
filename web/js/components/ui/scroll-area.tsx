import type { ReactNode } from 'react';
import { ScrollArea as ScrollPrimitive } from '@base-ui/react/scroll-area';
import { cn } from 'cn';

/** The app's one scrolling region. Pair it with the `-mr-3 … pr-3` gutter so the thumb sits
 *  outside the content (docs/UI_STYLE_GUIDE.md §12). */
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
