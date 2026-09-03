// =======================================================================================
// USER CHIP MODULE (web/js/ui/user-chip.ts)
// =======================================================================================
//
// The user-name toolbar chip: the small presence-count badge plus the current user's name.
//
// Key Principles:
// - PLAIN MODULE, NOT REACT: `#userChip` is a single static button already defined in
//   `index.html`, rebuilt in place by a small, infrequent `innerHTML` write — there's no
//   real componentization benefit, the same judgment call `grid-interaction.ts`/
//   `grid-scroll.ts` made. `#userChip`'s click/dblclick wiring (name-prompt / active-users
//   popup) is `app.ts`'s `wireUserChip`.
// - CALLED DIRECTLY, NOT BRIDGED: `setPresence` is called directly by
//   `ui/live-connection.ts`'s `applyPresence`, no window bridge involved.
//
// =======================================================================================

import { escapeHtml } from './escape-html.ts';
import { store } from '../store-instance.ts';

let presenceLabel = { text: '–', title: 'Gerade aktive Nutzer' };

/** Updates the presence badge inside `#userChip`, if it's already rendered there — guards
 *  the case where `updateUserChip` hasn't run yet by remembering the label regardless, so
 *  the next `updateUserChip` call picks it up even if this one found no badge to update. */
export function setPresence(text: string, title: string): void {
  presenceLabel = { text, title };
  const badge = document.getElementById('presBadge');
  if (badge) {
    badge.textContent = text;
    badge.title = title;
  }
}

/** Rebuilds `#userChip`'s content: the presence badge, the user icon, and the current name
 *  (or a placeholder prompt when no name is set yet). */
export function updateUserChip(): void {
  const chip = document.getElementById('userChip');
  if (!chip) return;
  chip.innerHTML =
    `<span id="presBadge" title="${escapeHtml(presenceLabel.title)}">${escapeHtml(presenceLabel.text)}</span>` +
    `<svg class="ic" aria-hidden="true"><use href="#i-user"/></svg> ${escapeHtml(store.get('user') || 'Name?')}`;
}
