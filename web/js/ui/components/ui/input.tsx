// =======================================================================================
// INPUT PRIMITIVE (web/js/ui/components/ui/input.tsx)
// =======================================================================================
//
// A shadcn/ui-pattern Input — owned source, not a vendored dependency (Phase 14, ARCHITECTURE
// §19) — a thin wrapper around a native `<input>`, no Radix dependency at all. Styled with
// Tailwind utilities that resolve to the SAME CSS custom properties app.css's untargeted
// `input,select,textarea{…}` rule already uses, so it renders visually identical to a plain
// `<input>` today while no longer depending on that rule once app.css is eventually retired
// (Phase 14's incremental CSS burn-down). No `w-full`: the original rule never forced a
// width either, so every call site keeps its native/content-driven or explicitly-set width.
//
// OWN RESETS, NOT PREFLIGHT: `web/css/tailwind.css` deliberately skips Tailwind's global
// Preflight reset (see that file's own comment for why), so `box-border`/`appearance-none`
// are supplied directly here rather than assumed from a document-wide reset.
//
// =======================================================================================

import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '../../../lib/utils.ts';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Forwards its ref and merges a caller-supplied `className` via `cn()` — every native prop
 *  (`type`, `value`, `onChange`, `style`, …) passes through unchanged; this replaces styling
 *  only, never input behavior. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'box-border appearance-none rounded-md border border-border bg-panel px-2 py-1.5 text-[13px] font-[inherit] text-text focus:border-accent focus:outline-2 focus:outline-accent-light',
        className,
      )}
      {...props}
    />
  );
});
