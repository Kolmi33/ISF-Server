// The React-modal system: every modal shares a single `#modal`/`#overlay` pair, replacing
// `#modal`'s content per open. Each React-rendered modal creates a fresh root on open and
// unmounts it on close, exactly bracketing its own lifetime.
//
// Originally built alongside legacy.js's own `openModal(html)`/`closeModal()` (which used the
// same shared node via `innerHTML` — a React root can't safely share a node with code that
// mutates it directly, so the two systems needed independent open/close ownership). Every
// modal is React-owned as of Phase 7 slice B10d, when legacy's `openModal`/`closeModal`/
// `modalSticky`/`lastFocusEl`/`expandModal` were retired (`openActiveUsers` was their only
// remaining caller) and `expandModal`'s `#modalReopen` click wiring moved here.

import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

let currentRoot: Root | null = null;
let isCurrentModalSticky = false;
let lastFocusedElement: HTMLElement | null = null;
let isCollapsed = false;

export interface OpenReactModalOptions {
  /** When true, Escape and clicking the overlay backdrop do not close the modal. */
  sticky?: boolean;
}

/** Open a React-rendered modal, mirroring legacy `openModal`'s DOM chrome (focus, overlay). One
 *  React modal opening another directly — e.g. Admin routing straight to the machine form,
 *  matching legacy's own chained `openModal()` calls — must unmount the outgoing root first:
 *  calling `createRoot` again on the same node without unmounting leaves the old root's effects
 *  dangling and React logs "createRoot() on a container that has already been passed to
 *  createRoot()". */
export function openReactModal(node: ReactNode, options: OpenReactModalOptions = {}): void {
  isCurrentModalSticky = !!options.sticky;
  isCollapsed = false;
  lastFocusedElement = document.activeElement as HTMLElement | null;
  document.getElementById('modalReopen')?.classList.remove('show');
  currentRoot?.unmount();
  const modalElement = document.getElementById('modal')!;
  currentRoot = createRoot(modalElement);
  currentRoot.render(node);
  document.getElementById('overlay')!.classList.add('open');
  modalElement.focus();
}

/** Close the currently-open React modal: unmount it, then restore the pre-open focus. */
export function closeReactModal(): void {
  isCurrentModalSticky = false;
  isCollapsed = false;
  document.getElementById('overlay')!.classList.remove('open');
  document.getElementById('modalReopen')?.classList.remove('show');
  if (currentRoot) {
    currentRoot.unmount();
    currentRoot = null;
  }
  if (lastFocusedElement) {
    try {
      lastFocusedElement.focus();
    } catch {
      /* the element may no longer be focusable (e.g. removed from the DOM) */
    }
  }
}

/** Collapse the current modal WITHOUT unmounting it: hide the overlay and show the floating
 *  reopen tab — content and state stay alive underneath. Re-expanding is `expandReactModal`
 *  below, wired to `#modalReopen`'s click. Used by the Assistant's "pin" button so a run's
 *  selection survives a peek at the grid. */
export function collapseReactModal(): void {
  isCollapsed = true;
  document.getElementById('overlay')!.classList.remove('open');
  document.getElementById('modalReopen')?.classList.add('show');
}

/** Re-show a collapsed modal's overlay (the React tree was never torn down, so there's
 *  nothing to remount) and refocus it. Faithful port of legacy `expandModal`, plus a fix: the
 *  original bare port left `isCollapsed` stuck `true` after re-expanding via the tab, so a
 *  subsequent Escape/outside-click would only dismiss the (already-hidden) tab instead of
 *  actually closing the now-visible modal — found while moving this in for B10d, not by a
 *  failing test. Wired to `#modalReopen`'s click below. */
function expandReactModal(): void {
  isCollapsed = false;
  document.getElementById('modalReopen')?.classList.remove('show');
  document.getElementById('overlay')!.classList.add('open');
  document.getElementById('modal')!.focus();
}

/** What Escape/backdrop-dismissal does while collapsed: only the floating reopen tab goes
 *  away — the collapsed root must survive, same as clicking "Schließen" never applies while
 *  collapsed either (there's no close button visible). */
function dismissCollapsedTab(): void {
  isCollapsed = false;
  document.getElementById('modalReopen')?.classList.remove('show');
}

// Delegated on `document` (not bound to specific elements) so these keep working even if
// `#modalReopen`/`#overlay`/`#modal` are ever replaced.
document.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('#modalReopen')) expandReactModal();
});

document.addEventListener(
  'keydown',
  (event) => {
    if (!currentRoot || event.key !== 'Escape') return;
    event.stopPropagation();
    if (isCurrentModalSticky) return;
    if (isCollapsed) dismissCollapsedTab();
    else closeReactModal();
  },
  { capture: true },
);

document.addEventListener(
  'click',
  (event) => {
    if (!currentRoot || (event.target as HTMLElement).id !== 'overlay') return;
    event.stopPropagation();
    if (isCurrentModalSticky) return;
    if (isCollapsed) dismissCollapsedTab();
    else closeReactModal();
  },
  { capture: true },
);
