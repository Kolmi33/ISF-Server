// =======================================================================================
// BUTTON PRIMITIVE (web/js/ui/components/ui/button.tsx)
// =======================================================================================
//
// A shadcn/ui-pattern Button — owned source, not a vendored dependency (Phase 14,
// ARCHITECTURE §19) — trimmed to only the variant/size combinations the Booking Assistant
// pilot actually uses (`default`/`primary`/`ghost` × `default`/`small`; no `asChild`/Radix
// Slot, nothing here needs to render a button as a different element). Styled with Tailwind
// utilities that resolve to the SAME CSS custom properties app.css already defines
// (`web/css/tailwind.css`'s `@theme` block), so this renders visually identical to the
// `.btn`/`.btn.primary`/`.btn.small` classes it replaces — no disabled-state styling is
// added here because app.css never defined any (conserving behavior, not "fixing" it).
// `ghost` conserves a scoped app.css override (`.assist-actions .btn:not(.primary)` made the
// secondary action transparent/borderless there) that would otherwise silently disappear
// once the button no longer carries the literal `.btn` class that override was keyed on.
//
// Key Principles:
// - TRIMMED VARIANT SURFACE: a bigger variant matrix than what's actually used would leave
//   untested branches against the `web/js/ui/**` 90%/85% coverage floor.
//
// =======================================================================================

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../lib/utils.ts';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md border cursor-pointer whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-border bg-panel text-text hover:bg-hover',
        primary: 'border-accent bg-accent text-white hover:bg-accent-hover',
        ghost: 'border-transparent bg-transparent text-text hover:bg-hover',
      },
      size: {
        default: 'px-3 py-1.5 text-[13px]',
        small: 'px-2 py-[3px] text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

/** Forwards its ref (needed for any future caller that wants to focus/measure the button
 *  imperatively) and merges a caller-supplied `className` on top of the variant classes via
 *  `cn()`, so a call site can still override/extend the visual result when needed. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, ...props },
  ref,
) {
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
});
