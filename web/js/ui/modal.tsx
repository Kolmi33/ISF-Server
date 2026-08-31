// The React-modal bridge (Phase 7). legacy.js's `openModal(html)`/`closeModal()` own a
// single shared `#modal`/`#overlay` pair, replacing `#modal`'s innerHTML per open. A React
// root can't safely share that node with code that mutates it directly — React loses track
// of externally-changed DOM and warns/misbehaves on the next render. So each React-rendered
// modal creates a fresh root on open and unmounts it on close, exactly bracketing its own
// lifetime; the node is only ever owned by one system at a time.
//
// legacy.js's own `modalSticky`/`lastFocusEl` closure variables aren't exported, so they
// can't be shared — this module keeps its own, entirely independent copies, and its
// capture-phase listeners below take full ownership of Escape/outside-click dismissal
// whenever a React modal is the one currently open, so the two systems never fight over the
// same keypress. Retire this whole file in Phase 7 slice B10, when legacy.js (and its modal
// chrome) is deleted and every modal is React-owned.

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
 *  reopen tab, exactly like legacy's own `collapseModal()`/`expandModal()` pair — content and
 *  state stay alive underneath. Re-expanding is handled entirely by legacy's own `#modalReopen`
 *  click listener (`expandModal()`, unchanged): it only re-shows the overlay, which is all
 *  that's needed since the React tree was never torn down. Used by the Assistant's "pin" button
 *  so a run's selection survives a peek at the grid. */
export function collapseReactModal(): void {
  isCollapsed = true;
  document.getElementById('overlay')!.classList.remove('open');
  document.getElementById('modalReopen')?.classList.add('show');
}

/** What Escape/backdrop-dismissal does while collapsed: legacy's own `closeModal()` doesn't
 *  unmount anything (it can't — its modals are plain HTML), it just clears the shared chrome.
 *  A React modal's collapsed root must survive the same dismissal for parity — only the
 *  floating reopen tab goes away. */
function dismissCollapsedTab(): void {
  isCollapsed = false;
  document.getElementById('modalReopen')?.classList.remove('show');
}

// Whenever a React modal is open, these run BEFORE legacy.js's own bubble-phase Escape/
// outside-click listeners (registered once, at legacy.js parse time) and take over
// dismissal entirely — stopping propagation so legacy's handlers never see the event, and
// calling closeReactModal (which legacy's closeModal doesn't know how to do) when the
// modal isn't sticky. When no React modal is open, both no-op immediately, so legacy's own
// modals keep working exactly as before.
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

// Delegated on `document` (not bound to the `#overlay` element directly) so it keeps
// working even if that element is ever replaced — the same reason the keydown listener
// above is document-level rather than bound to a specific node.
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
