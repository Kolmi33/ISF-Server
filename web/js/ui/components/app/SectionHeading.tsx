import type { ReactNode } from 'react';
import { cn } from 'cn';
import { Badge } from '../../../components/ui/badge.tsx';
import { SECTION_LABEL_CLASS } from './typography.ts';

/** The one section header shape (docs/UI_STYLE_GUIDE.md §10): a tracked uppercase label, an
 *  optional count, then whatever the caller puts after it — a tooltip trigger, or an
 *  `ml-auto` action group. */
export function SectionHeading({
  label,
  badge,
  className,
  children,
}: {
  label: ReactNode;
  badge?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn('flex shrink-0 items-center gap-2', className)}>
      <h2 className={SECTION_LABEL_CLASS}>{label}</h2>
      {badge !== undefined && badge !== null && <Badge>{badge}</Badge>}
      {children}
    </div>
  );
}
