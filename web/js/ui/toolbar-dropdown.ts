// Shared open/close mechanics for the toolbar's two filter dropdowns (Phase 7 slice B10e):
// "Filtern ▾" (`MachineFilterDropdown.tsx`) and "Alle Bereiche ▾" (`GroupFilterDropdown.tsx`).
// Each dropdown is a fixed empty `<div>` already in `index.html` (`#machDrop`/`#groupDrop`,
// CSS-driven `display:none`/`.open{display:block}`) — this hook toggles that class on the
// panel, same trick `ui/components/ContextMenu.tsx` (B10b) uses for `#ctxMenu`'s `display`.
//
// Faithful port of legacy's per-dropdown `<button>.onclick` (toggle) + document-level
// outside-click-closes pattern, with one deliberate simplification (E2): legacy's two
// dropdowns could both end up open at once — each button's `ev.stopPropagation()` meant
// clicking one button's toggle never reached the OTHER dropdown's own outside-click listener.
// Almost certainly an unintended quirk of two independently-added, identically-shaped
// features, not a deliberate design choice, and worse UX either way — this hook instead
// closes any other open toolbar dropdown whenever one opens. Every other behavior (toggle on
// the button, close on any other outside click) is unchanged.

import { useEffect, useRef, useState } from 'react';

const closeOthers = new Set<() => void>();

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
