import type { ComponentProps } from 'react';
import { cn } from 'cn';

/** A small count or status pill. `secondary` is the neutral counter used beside a section
 *  heading; `brand` marks the "alternative / OR" concept (docs/UI_STYLE_GUIDE.md §4). */
export function Badge({
  className,
  variant = 'secondary',
  ...props
}: ComponentProps<'span'> & { variant?: 'secondary' | 'brand' | 'outline' | 'destructive' }) {
  return (
    <span
      data-slot="badge"
      {...props}
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        variant === 'secondary' && 'bg-secondary text-secondary-foreground',
        variant === 'brand' && 'bg-brand-soft text-brand-foreground',
        variant === 'outline' && 'border border-border text-muted-foreground',
        variant === 'destructive' && 'bg-destructive/10 text-destructive',
        className,
      )}
    />
  );
}
