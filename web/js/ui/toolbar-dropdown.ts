// =======================================================================================
// TOOLBAR DROPDOWN HOOK (web/js/ui/toolbar-dropdown.ts)
// =======================================================================================
//
// Shared open/close mechanics for the toolbar's two filter dropdowns: "Filtern ▾"
// (`MachineFilterDropdown.tsx`) and "Alle Bereiche ▾" (`GroupFilterDropdown.tsx`).
//
// Key Principles:
// - CSS-DRIVEN VISIBILITY: each dropdown is a fixed empty `<div>` already in `index.html`
//   (`#machDrop`/`#groupDrop`, CSS-driven `display:none`/`.open{display:block}`) — this
//   hook just toggles that class on the panel, the same trick `ContextMenu.tsx` uses for
//   `#ctxMenu`'s visibility.
// - ONLY ONE DROPDOWN OPEN AT A TIME: opening either dropdown closes the other one first,
//   via the shared `closeOthers` registry below — two toolbar dropdowns open
//   simultaneously would be confusing UI, not a useful state.
//
// =======================================================================================

import { useEffect, useRef, useState } from 'react';

const closeOthers = new Set<() => void>();

/**
 * A React hook that wires one toolbar dropdown's toggle button, its outside-click-to-close
 * behavior, and its CSS `.open` class.
 *
 * How it works: registers this dropdown's own close function in the shared `closeOthers`
 * set on mount; the toggle handler closes every OTHER registered dropdown before opening
 * this one. A `mousedown` anywhere outside both the panel and its button closes this
 * dropdown (while it's open); the panel's `.open` class is kept in sync with `isOpen` via
 * its own effect.
 */
export function useToolbarDropdown(panelId: string, buttonId: string): { isOpen: boolean } {
  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);
  isOpenRef.current = isOpen;

  function toggle(): void {
    if (isOpenRef.current) {
      setIsOpen(false);
      return;
    }
    for (const close of closeOthers) close();
    setIsOpen(true);
  }
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    const close = () => setIsOpen(false);
    closeOthers.add(close);
    return () => {
      closeOthers.delete(close);
    };
  }, []);

  useEffect(() => {
    const button = document.getElementById(buttonId);
    function onButtonClick(event: MouseEvent): void {
      event.stopPropagation();
      toggleRef.current();
    }
    button?.addEventListener('click', onButtonClick);

    function onDocumentMouseDown(event: MouseEvent): void {
      if (!isOpenRef.current) return;
      const target = event.target as Node;
      const panel = document.getElementById(panelId);
      if (panel?.contains(target) || button?.contains(target)) return;
      setIsOpen(false);
    }
    document.addEventListener('mousedown', onDocumentMouseDown);

    return () => {
      button?.removeEventListener('click', onButtonClick);
      document.removeEventListener('mousedown', onDocumentMouseDown);
    };
  }, [panelId, buttonId]);

  useEffect(() => {
    document.getElementById(panelId)?.classList.toggle('open', isOpen);
  }, [panelId, isOpen]);

  return { isOpen };
}
