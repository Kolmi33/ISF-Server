import type { ReactNode } from 'react';
import { cn } from 'cn';

/** One headline number with its caption — the KPI strip shared by "Meine Buchungen" and
 *  Statistik. The value borrows the dialog title's size so a number reads as the loudest
 *  thing on the surface, and the caption is metadata (docs/UI_STYLE_GUIDE.md §3).
 *
 *  `data-slot` attributes, not class names, are the query hooks: the tile is shared, so it
 *  must not carry any one screen's vocabulary. */
export function StatTile({
  value,
  label,
  icon,
  className,
}: {
  value: ReactNode;
  label: ReactNode;
  /** A Lucide icon at `size-4`, shown left of the caption. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="stat-tile"
      className={cn(
        'flex min-w-[7.5rem] flex-1 flex-col gap-0.5 rounded-xl border border-border bg-muted/40 px-4 py-3',
        className,
      )}
    >
      <span
        data-slot="stat-value"
        className="text-[22px] font-semibold leading-tight tabular-nums text-foreground"
      >
        {value}
      </span>
      <span
        data-slot="stat-label"
        className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground"
      >
        {icon}
        {label}
      </span>
    </div>
  );
}
