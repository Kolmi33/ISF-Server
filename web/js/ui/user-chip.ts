// The user-name toolbar chip (Phase 7 slice B8): the small presence-count badge plus the
// current user's name. Faithful port of legacy `setPres`/`updateUserChip`. Kept a plain module
// rather than a React component — `#userChip` is a single static button already defined in
// index.html, rebuilt in place by a small, infrequent innerHTML write; there's no real
// componentization benefit, the same judgment call B2/B3 made for grid-interaction.ts/
// grid-scroll.ts. `#userChip`'s click/dblclick wiring (name-prompt / active-users popup) stays
// in legacy.js. `setPresence` is called directly (not via a bridge alias) by
// `ui/live-connection.ts`'s `applyPresence`, gated alongside it in Phase 7 slice B10d.

import { escapeHtml } from './escape-html.ts';
import { store } from '../store-instance.ts';

let presenceLabel = { text: '–', title: 'Gerade aktive Nutzer' };

/** Update the presence badge inside `#userChip`, if it's already rendered there (guards the
 *  case where `updateUserChip` hasn't run yet). Faithful port of legacy `setPres`. */
export function setPresence(text: string, title: string): void {
  presenceLabel = { text, title };
  const badge = document.getElementById('presBadge');
  if (badge) {
    badge.textContent = text;
    badge.title = title;
  }
}

/** Rebuild `#userChip`'s content: the presence badge, the user icon, and the current name (or
 *  a placeholder). Faithful port of legacy `updateUserChip`. */
export function updateUserChip(): void {
  const chip = document.getElementById('userChip');
  if (!chip) return;
  chip.innerHTML =
    `<span id="presBadge" title="${escapeHtml(presenceLabel.title)}">${escapeHtml(presenceLabel.text)}</span>` +
    `<svg class="ic" aria-hidden="true"><use href="#i-user"/></svg> ${escapeHtml(store.get('user') || 'Name?')}`;
}
