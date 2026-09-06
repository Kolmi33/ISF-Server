import type { ReactNode } from 'react';
import { cn } from 'cn';
import { LABEL_CLASS } from './typography.ts';

/** A field label. Labels sit above their control, never beside it — the legacy `.formrow`
 *  layout is retired inside `ui-scope` (docs/UI_STYLE_GUIDE.md §9). */
export function FieldLabel({
  htmlFor,
  className,
  children,
}: {
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className={cn(LABEL_CLASS, className)}>
      {children}
    </label>
  );
}

export function FormField({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  /** One line of secondary explanation under the control. */
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
