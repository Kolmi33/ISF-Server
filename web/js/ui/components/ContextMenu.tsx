// The grid's right-click / after-drag context menu (Phase 7 slice B10b). Faithful port of
// legacy `showCtx`/`hideCtx` + the document-level outside-click dismissal. Mounted once at
// boot onto the static `<div id="ctxMenu">` (same pattern as `Grid.tsx` onto `#grid`);
// `ui/grid-interaction.ts` (B2, already gated) calls it via the `window.showCtx`/
// `window.hideCtx` bridge, unchanged.
import { useEffect, useLayoutEffect, useState } from 'react';
import { formatDateLong } from '../../../../shared/dates.ts';
import { getBooking } from '../../core/booking-queries.ts';
import { selection, clearSelection } from '../grid-interaction.ts';
import { openBookingForm } from './BookingForm.tsx';
import { offerUndo } from '../toast.ts';
import { deleteSelectedCells } from '../../core/booking.ts';
import { escapeHtml } from '../escape-html.ts';
import type { Cell } from '../selection.ts';

interface MenuInfo {
  x: number;
  y: number;
  mids: string[];
  from: string;
  to: string;
  bookedCells: Cell[];
  names: string[];
}

let showHandler: ((x: number, y: number) => void) | null = null;
let hideHandler: (() => void) | null = null;

/** Show the menu at `(x, y)` for the current `selection`. Faithful port of legacy `showCtx`. */
export function showCtx(x: number, y: number): void {
  showHandler?.(x, y);
}

/** Hide the menu. Faithful port of legacy `hideCtx`. */
export function hideCtx(): void {
  hideHandler?.();
}

function buildMenuInfo(x: number, y: number): MenuInfo {
  const mids = [...new Set(selection.cells.map((c) => c.mid))];
  const dates = selection.cells.map((c) => c.date).sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const bookings = window.S.data!.bookings;
  const bookedCells = selection.cells.filter((c) => getBooking(bookings, c.mid, c.date));
  const names = [...new Set(bookedCells.map((c) => getBooking(bookings, c.mid, c.date)!.name))];
  return { x, y, mids, from, to, bookedCells, names };
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
    (fresh) => deleteSelectedCells(fresh, cells, info.mids),
    `Bereich gelöscht: ${info.mids.length} Maschine(n), ${info.from} bis ${info.to}`,
  );
  if (result && !result.abort) {
    offerUndo(`${result.n} Buchung(en) gelöscht.`, result.undo, 'Bereich löschen');
  }
}

/** Registers `showCtx`/`hideCtx` against local state, dismisses on an outside mousedown, and
 *  shows/positions `#ctxMenu` itself (clamped inside the viewport, measured after each render
 *  — same approach as legacy's own `getBoundingClientRect()` call). Split out from
 *  `ContextMenu` only to stay under the line budget. */
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

  // Dismiss on outside mousedown. Faithful port of legacy's document-level listener; registered
  // once for the component's lifetime (it is mounted exactly once, at boot).
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
      <div style={{ padding: '4px 10px', fontSize: '12px', color: 'var(--muted)' }}>
        {info.mids.length} Maschine(n) · {formatDateLong(info.from)}
        {info.from !== info.to ? ' – ' + formatDateLong(info.to) : ''}
      </div>
      <button
        onClick={() => {
          hideCtx();
          openBookingForm(info.mids, info.from, info.to);
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

/** Mounted once at boot onto `#ctxMenu`. `#ctxMenu` itself IS the menu box (CSS gives it
 *  `position:fixed; display:none`, matching legacy) — this component only fills its children
 *  and toggles its `display`/position, exactly as legacy's `showCtx`/`hideCtx` did via
 *  `innerHTML`/`style`. */
export function ContextMenu() {
  const info = useContextMenuInfo();
  return info ? <ContextMenuContent info={info} /> : null;
}
