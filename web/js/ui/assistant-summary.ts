// =======================================================================================
// ASSISTANT SELECTION SUMMARY (web/js/ui/assistant-summary.ts)
// =======================================================================================
//
// The one-line "N Einzelgeräte · N Bedarfsgruppen" summary shown beside the search action —
// a pure count over the tree's own top-level children, with correct German singular/plural.
//
// =======================================================================================

import type { AssistContainer } from '../core/assistant.ts';

/** Counts the tree's top-level loose devices and groups and phrases them as one summary
 *  line, e.g. "3 Einzelgeräte · 1 Bedarfsgruppe" — either clause is omitted when its count
 *  is zero, and an entirely empty tree reads as "Keine Auswahl" (deliberately distinct
 *  wording from the work-area's own "Keine Geräte ausgewählt." empty-state line, so the two
 *  don't read as an ambiguous duplicate when both are visible at once). */
export function describeSelectionSummary(tree: AssistContainer): string {
  const deviceCount = tree.children.filter((child) => child.type === 'dev').length;
  const groupCount = tree.children.filter((child) => child.type === 'grp').length;
  const parts: string[] = [];
  if (deviceCount > 0) {
    parts.push(`${deviceCount} ${deviceCount === 1 ? 'Einzelgerät' : 'Einzelgeräte'}`);
  }
  if (groupCount > 0) {
    parts.push(`${groupCount} ${groupCount === 1 ? 'Bedarfsgruppe' : 'Bedarfsgruppen'}`);
  }
  return parts.length ? parts.join(' · ') : 'Keine Auswahl';
}
