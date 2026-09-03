// =======================================================================================
// TOAST NOTIFICATION MODULE (web/js/ui/toast.ts)
// =======================================================================================
//
// The toast notification and its "undo" affordance.
//
// Key Principles:
// - PLAIN MODULE, NOT REACT: `#toast` is one static element already in `index.html`,
//   shown/hidden by toggling a class — the same pattern the context menu and confirm dialog
//   use. `ui/live-connection.ts`'s own remote-change toast queue calls `toast()` too, so
//   this stays a simple function rather than something that owns its own React-rendered queue.
//
// =======================================================================================

import type { CellUndo } from '../core/bookings.ts';

let toastHideTimer: ReturnType<typeof setTimeout> | null = null;

const DEFAULT_MS = 3500;
const UNDO_MS = 9000;

/**
 * Shows a toast for `ms` (default 3.5s, or 9s when `undoFn` is given — an undo affordance
 * needs longer to actually notice and click). A second call while one is already showing
 * replaces it outright, clearing the previous hide timer, so toasts never stack or overlap.
 */
export function toast(message: string, undoFn?: () => void, ms?: number): void {
  const toastElement = document.getElementById('toast')!;
  if (undoFn) {
    toastElement.textContent = '';
    toastElement.append(message + ' ');
    const undoButton = document.createElement('button');
    undoButton.id = 'undoBtn';
    undoButton.textContent = '↩ Rückgängig';
    undoButton.onclick = () => {
      toastElement.classList.remove('show', 'action');
      undoFn();
    };
    toastElement.append(undoButton);
    toastElement.classList.add('action');
  } else {
    toastElement.textContent = message;
    toastElement.classList.remove('action');
  }
  toastElement.classList.add('show');
  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(
    () => toastElement.classList.remove('show', 'action'),
    ms ?? (undoFn ? UNDO_MS : DEFAULT_MS),
  );
}

/**
 * Offers to undo a write for 9s: restores each entry's previous value (or deletes the cell,
 * for an entry that created one) via `window.mutate`, going through the same patch path as
 * the original write.
 */
export function offerUndo(
  message: string,
  entries: readonly CellUndo[] | undefined,
  label: string,
): void {
  if (!entries || !entries.length) {
    toast(message);
    return;
  }
  toast(message, async () => {
    const result = await window.mutate((fresh) => {
      const undoOfUndo: CellUndo[] = [];
      for (const entry of entries) {
        fresh.bookings[entry.machineId] = fresh.bookings[entry.machineId] || {};
        // The CAS check for THIS write must be what's actually on the cell right now (about
        // to be overwritten/removed), not `entry.prev` — that describes the state before the
        // ORIGINAL action, which only coincides with "now" when undoing a deletion. Undoing a
        // creation has `entry.prev === null`; sending that as-is would tell the server "no
        // CAS check requested", so it deletes unconditionally — including a booking someone
        // else made on that cell after the original write, with no conflict detected.
        const current = fresh.bookings[entry.machineId]![entry.date] ?? null;
        undoOfUndo.push({ machineId: entry.machineId, date: entry.date, prev: current });
        if (entry.prev) fresh.bookings[entry.machineId]![entry.date] = entry.prev;
        else delete fresh.bookings[entry.machineId]![entry.date];
      }
      return { undo: undoOfUndo }; // same cells → mutate()'s patch path, not a full re-render
    }, 'Rückgängig: ' + label);
    if (result && !result.abort) toast('Rückgängig gemacht ✓');
  });
}
