import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from 'cn';

/** The dashed placeholder shown wherever a list has nothing in it (docs/UI_STYLE_GUIDE.md
 *  §11). "Nothing at all" and "filtered down to nothing" are different sentences — pass the
 *  right one; do not collapse them. */
export function EmptyState({
  icon,
  className,
  children,
}: {
  /** A Lucide icon at `size-7 text-muted-foreground/60`. Defaults to an inbox. */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-4 py-12 text-center',
        className,
      )}
    >
      {icon ?? <Inbox className="size-7 text-muted-foreground/60" />}
      <p className="max-w-[34ch] text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
