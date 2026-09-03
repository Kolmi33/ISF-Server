// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppState, BookingData } from '../../../shared/types.ts';
import type { CellUndo } from '../core/bookings.ts';
import { toast, offerUndo } from './toast.ts';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="toast" role="status" aria-live="polite"></div>';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toast', () => {
  // What: a plain toast shows the given text and auto-hides after the default 3.5s, with no
  // undo-specific styling.
  // How: shows a toast with no undo callback, checks it's visible and not in "action" (undo)
  // mode, then advances fake timers past 3.5s and checks it's hidden.
  it('shows plain text and hides itself after the default 3.5s', () => {
    toast('Gespeichert.');
    const el = document.getElementById('toast')!;
    expect(el.textContent).toBe('Gespeichert.');
    expect(el.classList.contains('show')).toBe(true);
    expect(el.classList.contains('action')).toBe(false);
    vi.advanceTimersByTime(3500);
    expect(el.classList.contains('show')).toBe(false);
  });

  // What: passing an undo callback switches the toast into "action" mode (shows an undo
  // button) and extends its auto-hide timeout from 3.5s to 9s, giving the user more time to
  // notice and click undo.
  // How: shows an undo toast, checks the action class and button text, advances past the
  // plain-toast's 3.5s deadline (still showing), then past the full 9s (now hidden).
  it('with an undo function, shows an undo button and stays up for 9s', () => {
    const undoFn = vi.fn();
    toast('Gelöscht.', undoFn);
    const el = document.getElementById('toast')!;
    expect(el.classList.contains('action')).toBe(true);
    const button = document.getElementById('undoBtn')!;
    expect(button.textContent).toBe('↩ Rückgängig');
    vi.advanceTimersByTime(3500); // the plain default would have hidden it by now
    expect(el.classList.contains('show')).toBe(true);
    vi.advanceTimersByTime(5500); // now past the full 9s
    expect(el.classList.contains('show')).toBe(false);
  });

  // What: clicking the undo button immediately hides the toast and invokes the caller's
  // undo callback.
  // How: shows an undo toast, clicks the undo button, and checks both the toast hid and the
  // callback fired exactly once.
  it('clicking the undo button hides the toast and runs the callback', () => {
    const undoFn = vi.fn();
    toast('Gelöscht.', undoFn);
    document.getElementById('undoBtn')!.click();
    const el = document.getElementById('toast')!;
    expect(el.classList.contains('show')).toBe(false);
    expect(undoFn).toHaveBeenCalledOnce();
  });

  // What: an explicit duration argument overrides whichever default (3.5s or 9s) would
  // otherwise apply.
  // How: shows a toast with an explicit 100ms duration, advances exactly 100ms, and checks
  // it's already hidden (far sooner than either default).
  it('an explicit ms overrides the default duration', () => {
    toast('Kurz.', undefined, 100);
    vi.advanceTimersByTime(100);
    expect(document.getElementById('toast')!.classList.contains('show')).toBe(false);
  });

  // What: showing a second toast while the first is still up replaces its text and starts a
  // fresh timer for the new toast — the first toast's now-abandoned deadline has no effect.
  // How: shows a 1000ms toast, advances 900ms (not yet expired), shows a second (default-
  // duration) toast, checks the text updated, advances past the first toast's original 1000ms
  // deadline (still showing — that timer was superseded), then past the second toast's own
  // full 3500ms (now hidden).
  it('a second toast while one is showing replaces it and resets its own timer', () => {
    toast('Erste.', undefined, 1000);
    vi.advanceTimersByTime(900);
    toast('Zweite.');
    expect(document.getElementById('toast')!.textContent).toBe('Zweite.');
    vi.advanceTimersByTime(100); // the first toast's original 1000ms deadline
    expect(document.getElementById('toast')!.classList.contains('show')).toBe(true); // not hidden yet
    vi.advanceTimersByTime(3400); // the second toast's own full 3500ms
    expect(document.getElementById('toast')!.classList.contains('show')).toBe(false);
  });
});

describe('offerUndo', () => {
  beforeEach(() => {
    window.S = { user: 'anna' } as unknown as AppState;
  });

  // What: with an empty undo list (nothing was actually changed), offerUndo shows a plain
  // toast with no undo button at all, rather than a no-op undo action.
  // How: calls offerUndo with an empty undo array and checks the toast text and that it's
  // not in "action" mode.
  it('shows a plain toast (no undo) when there is nothing to undo', () => {
    offerUndo('Nichts zu tun.', [], 'Buchung');
    const el = document.getElementById('toast')!;
    expect(el.textContent).toBe('Nichts zu tun.');
    expect(el.classList.contains('action')).toBe(false);
  });

  // What: clicking undo replays each undo record's `prev` value back onto the live data
  // through window.mutate — a null prev clears a newly-created cell, a real prev restores
  // what was overwritten.
  // How: stubs window.mutate to apply its reducer function directly against a fake fresh
  // dataset, offers undo for two records (one clear, one restore), simulates the original
  // write having landed, clicks undo, and checks both cells ended up in their pre-action state.
  it('undoing restores a deleted cell and clears a created one, via window.mutate', async () => {
    const bookings: Record<string, Record<string, unknown>> = { m1: {} };
    window.mutate = vi.fn(async (fn: (fresh: BookingData) => unknown) =>
      fn({ machines: [], bookings } as unknown as BookingData),
    ) as unknown as typeof window.mutate;

    offerUndo(
      'Gebucht.',
      [
        { machineId: 'm1', date: '2021-01-04', prev: null }, // undo: clear it (it was newly created)
        { machineId: 'm1', date: '2021-01-05', prev: { name: 'bob' } }, // undo: restore the old value
      ],
      'Buchung',
    );
    bookings['m1']!['2021-01-04'] = { name: 'anna' }; // simulate the original write having landed

    document.getElementById('undoBtn')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(window.mutate).toHaveBeenCalledWith(expect.any(Function), 'Rückgängig: Buchung');
    expect(bookings['m1']!['2021-01-04']).toBeUndefined();
    expect(bookings['m1']!['2021-01-05']).toEqual({ name: 'bob' });
  });

  // What: pins a real bug fix — undoing a just-created booking must send the CELL'S CURRENT
  // value as the compare-and-set check, not the pre-creation `prev` (null) verbatim. The
  // server treats a null prev as "no CAS check, delete unconditionally", which would silently
  // delete a takeover booking someone else made on that cell after the original write.
  // How: seeds a cell as already booked (simulating the original write landed), stubs
  // window.mutate to capture the reducer's actual result, offers undo with the ORIGINAL prev
  // (null, since nothing was there before the very first booking), clicks undo, and checks
  // the captured undo record's prev is the cell's CURRENT value (what's about to be deleted),
  // not the stale null.
  it('undoing a just-created booking sends the CURRENT cell value as the CAS check, not the pre-creation state', async () => {
    // Bug: entry.prev (null, since nothing was there before the ORIGINAL booking) used to be
    // forwarded as-is into the undo's own server request. The server treats a null `prev` as
    // "no CAS check requested" and deletes unconditionally — including a booking someone else
    // made on that cell after the original write. The fix must instead send what's actually
    // on the cell right now (about to be deleted), so the server can detect a takeover.
    const bookings: Record<string, Record<string, unknown>> = {
      m1: { '2021-01-04': { name: 'anna' } }, // the original write has already landed
    };
    let capturedResult: { undo: CellUndo[] } | undefined;
    window.mutate = vi.fn(async (fn: (fresh: BookingData) => unknown) => {
      capturedResult = fn({ machines: [], bookings } as unknown as BookingData) as {
        undo: CellUndo[];
      };
      return capturedResult;
    }) as unknown as typeof window.mutate;

    offerUndo(
      'Gebucht.',
      [{ machineId: 'm1', date: '2021-01-04', prev: null }], // undo: this cell was newly created
      'Buchung',
    );
    document.getElementById('undoBtn')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(capturedResult!.undo).toEqual([
      { machineId: 'm1', date: '2021-01-04', prev: { name: 'anna' } },
    ]);
  });

  // What: the same "send the current cell state as the CAS check" rule also applies to
  // undoing a DELETION (restoring a booking) — the current (empty) state is still sent, not
  // some stale value, so a concurrent write to that cell is still detected correctly.
  // How: seeds an already-empty cell (simulating the deletion having landed), offers undo to
  // restore a booking, clicks undo, and checks the captured undo record's prev reflects the
  // cell's current (empty/null) state.
  it('undoing a deletion still sends the (empty) current state as the CAS check', async () => {
    const bookings: Record<string, Record<string, unknown>> = { m1: {} }; // already deleted
    let capturedResult: { undo: CellUndo[] } | undefined;
    window.mutate = vi.fn(async (fn: (fresh: BookingData) => unknown) => {
      capturedResult = fn({ machines: [], bookings } as unknown as BookingData) as {
        undo: CellUndo[];
      };
      return capturedResult;
    }) as unknown as typeof window.mutate;

    offerUndo(
      'Gelöscht.',
      [{ machineId: 'm1', date: '2021-01-04', prev: { name: 'bob' } }], // undo: restore bob's booking
      'Löschen',
    );
    document.getElementById('undoBtn')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(capturedResult!.undo).toEqual([{ machineId: 'm1', date: '2021-01-04', prev: null }]);
  });

  // What: once the undo's own mutate call resolves successfully, a confirmation toast replaces
  // the undo toast.
  // How: stubs window.mutate to resolve successfully, clicks undo, and checks the toast text
  // updated to the confirmation message.
  it('shows a confirmation toast once the undo mutate call succeeds', async () => {
    window.mutate = vi.fn().mockResolvedValue({ undo: [] });
    offerUndo('Gebucht.', [{ machineId: 'm1', date: '2021-01-04', prev: null }], 'Buchung');
    document.getElementById('undoBtn')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('toast')!.textContent).toBe('Rückgängig gemacht ✓');
  });

  // What: if the undo's own mutate call aborts (e.g. a concurrent conflict), no confirmation
  // is shown — the user isn't told "undone" when it wasn't.
  // How: stubs window.mutate to resolve with {abort: true}, clicks undo, and checks the
  // toast text is NOT the confirmation message.
  it('shows no confirmation when the undo mutate call aborts', async () => {
    window.mutate = vi.fn().mockResolvedValue({ abort: true });
    offerUndo('Gebucht.', [{ machineId: 'm1', date: '2021-01-04', prev: null }], 'Buchung');
    document.getElementById('undoBtn')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('toast')!.textContent).not.toBe('Rückgängig gemacht ✓');
  });
});
