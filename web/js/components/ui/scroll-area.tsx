import type { ReactNode } from 'react';
import { cn } from 'cn';

/** The app's one native, keyboard-focusable scrolling region. The stable gutter prevents
 *  content from shifting when its visible vertical scrollbar appears. */
export function ScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="scroll-area"
      tabIndex={0}
      className={cn(
        'relative overflow-auto [scrollbar-gutter:stable] outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {children}
    </div>
  );
}
