// =======================================================================================
// CONTEXT MENU COMPONENT (web/js/ui/components/ContextMenu.tsx)
// =======================================================================================
//
// The grid's right-click / after-drag context menu: book the selection, delete any booked
// cells within it, or cancel.
//
// Key Principles:
// - MOUNTED ONCE, POSITIONED IMPERATIVELY: mounted once at boot onto the static
//   `<div id="ctxMenu">` (the same pattern `Grid.tsx` uses onto `#grid`) — positioning is
//   measured after each render (`getBoundingClientRect`, clamped inside the viewport) since
//   the menu's own size depends on its content.
// - HANDLERS ARE INJECTED, NOT IMPORTED: `ui/grid-interaction.ts` calls `showCtx`/`hideCtx`
//   via its injected `GridInteractionHandlers` struct rather than a direct import — this
//   module imports `selection`/`clearSelection` FROM `grid-interaction.ts`, so the reverse
//   would cycle.
//
// =======================================================================================
import { useEffect, useLayoutEffect, useState } from 'react';
import { formatDateLong } from '../../../../shared/dates.ts';
import { getBooking } from '../../core/bookings.ts';
import { selection, clearSelection } from '../grid-interaction.ts';
import { openBookingForm } from './BookingForm.tsx';
import { offerUndo } from '../toast.ts';
import { deleteSelectedCells } from '../../core/bookings.ts';
import { escapeHtml } from '../escape-html.ts';
import type { Cell } from '../selection.ts';
import { store } from '../../store-instance.ts';

interface MenuInfo {
  x: number;
  y: number;
  machineIds: string[];
  from: string;
  to: string;
  bookedCells: Cell[];
  names: string[];
}

let showHandler: ((x: number, y: number) => void) | null = null;
let hideHandler: (() => void) | null = null;

/** Shows the menu at `(x, y)` for the current `selection`. */
export function showCtx(x: number, y: number): void {
  showHandler?.(x, y);
}

/** Hides the menu. */
export function hideCtx(): void {
  hideHandler?.();
}

function buildMenuInfo(x: number, y: number): MenuInfo {
  const machineIds = [...new Set(selection.cells.map((c) => c.machineId))];
  const dates = selection.cells.map((c) => c.date).sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const bookings = store.get('data')!.bookings;
  const bookedCells = selection.cells.filter((c) => getBooking(bookings, c.machineId, c.date));
  const names = [
    ...new Set(bookedCells.map((c) => getBooking(bookings, c.machineId, c.date)!.name)),
  ];
  return { x, y, machineIds, from, to, bookedCells, names };
}

async function handleDelete(info: MenuInfo): Promise<void> {
  hideCtx();
  const confirmed = await window.askConfirm({
    title: 'Markierte Buchungen löschen?',
    body: `<b>${info.bookedCells.length}</b> Buchung(en) im Bereich ${escapeHtml(formatDateLong(info.from))}${
      info.from !== info.to ? ' – ' + escapeHtml(formatDateLong(info.to)) : ''
    }.<br>Betroffen: <b>${escapeHtml(info.names.join(', '))}</b>`,
    yes: `${info.bookedCells.length} Buchung(en) löschen`,
  });
  if (!confirmed) return;
  const cells = [...selection.cells];
  clearSelection();
  const result = await window.mutate(
    (fresh) => deleteSelectedCells(fresh, cells, info.machineIds),
    `Bereich gelöscht: ${info.machineIds.length} Maschine(n), ${info.from} bis ${info.to}`,
  );
  if (result && !result.abort) {
    offerUndo(`${result.deletedCount} Buchung(en) gelöscht.`, result.undo, 'Bereich löschen');
  }
}

/** Registers `showCtx`/`hideCtx` against local state, dismisses on an outside mousedown, and
 *  shows/positions `#ctxMenu` itself, clamped inside the viewport and measured after each
 *  render (the menu's own size depends on which buttons its content actually renders). */
function useContextMenuInfo(): MenuInfo | null {
  const [info, setInfo] = useState<MenuInfo | null>(null);

  useEffect(() => {
    showHandler = (x, y) => setInfo(buildMenuInfo(x, y));
    hideHandler = () => setInfo(null);
    return () => {
      showHandler = null;
      hideHandler = null;
    };
  }, []);

  // Dismiss on an outside mousedown. Registered once for the component's whole lifetime,
  // since ContextMenu is mounted exactly once, at boot.
  useEffect(() => {
    function onMouseDown(event: MouseEvent): void {
      const menu = document.getElementById('ctxMenu')!;
      if (menu.style.display !== 'none' && !menu.contains(event.target as Node)) hideCtx();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  useLayoutEffect(() => {
    const menu = document.getElementById('ctxMenu')!;
    if (!info) {
      menu.style.display = 'none';
      return;
    }
    menu.style.display = 'block';
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(info.x, innerWidth - rect.width - 10)) + 'px';
    menu.style.top = Math.max(4, Math.min(info.y, innerHeight - rect.height - 10)) + 'px';
  }, [info]);

  return info;
}

function ContextMenuContent({ info }: { info: MenuInfo }) {
  return (
    <>
      <div style={{ padding: '4px 10px', fontSize: '12px', color: 'var(--app-muted)' }}>
        {info.machineIds.length} Maschine(n) · {formatDateLong(info.from)}
        {info.from !== info.to ? ' – ' + formatDateLong(info.to) : ''}
      </div>
      <button
        onClick={() => {
          hideCtx();
          openBookingForm(info.machineIds, info.from, info.to);
        }}
      >
        <svg className="ic" aria-hidden="true">
          <use href="#i-cal" />
        </svg>{' '}
        Buchen…
      </button>
      {info.bookedCells.length > 0 && (
        <button
          title={`betroffen: ${info.names.join(', ')}`}
          onClick={() => void handleDelete(info)}
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-trash" />
          </svg>{' '}
          {info.bookedCells.length} Buchung(en) löschen
        </button>
      )}
      <button
        onClick={() => {
          hideCtx();
          clearSelection();
        }}
      >
        Abbrechen
      </button>
    </>
  );
}

/** Mounted once at boot onto `#ctxMenu`. `#ctxMenu` itself IS the menu box — CSS gives it
 *  `position:fixed; display:none` — this component only fills its children and toggles its
 *  `display`/position. */
export function ContextMenu() {
  const info = useContextMenuInfo();
  return info ? <ContextMenuContent info={info} /> : null;
}
