// =======================================================================================
// CLASS-NAME MERGE HELPER (web/js/lib/utils.ts)
// =======================================================================================
//
// The standard shadcn/ui `cn()` helper: composes conditional class names (clsx) and then
// resolves conflicting Tailwind utilities so the last one wins (tailwind-merge) — needed
// because a shadcn-pattern component's own default classes and a caller-supplied
// `className` prop both land in the same string, and without tailwind-merge a caller
// override like `className="bg-danger"` could lose to (or fight with) the component's own
// `bg-panel` depending on CSS source order rather than intent.
//
// =======================================================================================

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges any number of class-name values (strings, conditionals, arrays — see clsx's
 * `ClassValue`) into one deduplicated, conflict-resolved class string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
