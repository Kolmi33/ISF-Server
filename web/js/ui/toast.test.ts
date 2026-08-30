// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppState, BookingData } from '../../../shared/types.ts';
import { toast, offerUndo } from './toast.ts';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="toast" role="status" aria-live="polite"></div>';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toast', () => {
  it('shows plain text and hides itself after the default 3.5s', () => {
    toast('Gespeichert.');
    const el = document.getElementById('toast')!;
    expect(el.textContent).toBe('Gespeichert.');
    expect(el.classList.contains('show')).toBe(true);
    expect(el.classList.contains('action')).toBe(false);
    vi.advanceTimersByTime(3500);
    expect(el.classList.contains('show')).toBe(false);
  });

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

  it('clicking the undo button hides the toast and runs the callback', () => {
    const undoFn = vi.fn();
    toast('Gelöscht.', undoFn);
    document.getElementById('undoBtn')!.click();
    const el = document.getElementById('toast')!;
    expect(el.classList.contains('show')).toBe(false);
    expect(undoFn).toHaveBeenCalledOnce();
  });

  it('an explicit ms overrides the default duration', () => {
    toast('Kurz.', undefined, 100);
    vi.advanceTimersByTime(100);
    expect(document.getElementById('toast')!.classList.contains('show')).toBe(false);
  });

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

  it('shows a plain toast (no undo) when there is nothing to undo', () => {
    offerUndo('Nichts zu tun.', [], 'Buchung');
    const el = document.getElementById('toast')!;
    expect(el.textContent).toBe('Nichts zu tun.');
    expect(el.classList.contains('action')).toBe(false);
  });

  it('undoing restores a deleted cell and clears a created one, via window.mutate', async () => {
    const bookings: Record<string, Record<string, unknown>> = { m1: {} };
    window.mutate = vi.fn(async (fn: (fresh: BookingData) => unknown) =>
      fn({ machines: [], bookings } as unknown as BookingData),
    ) as unknown as typeof window.mutate;

    offerUndo(
      'Gebucht.',
      [
        { mid: 'm1', date: '2021-01-04', prev: null }, // undo: clear it (it was newly created)
        { mid: 'm1', date: '2021-01-05', prev: { name: 'bob' } }, // undo: restore the old value
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

  it('shows a confirmation toast once the undo mutate call succeeds', async () => {
    window.mutate = vi.fn().mockResolvedValue({ undo: [] });
    offerUndo('Gebucht.', [{ mid: 'm1', date: '2021-01-04', prev: null }], 'Buchung');
    document.getElementById('undoBtn')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('toast')!.textContent).toBe('Rückgängig gemacht ✓');
  });

  it('shows no confirmation when the undo mutate call aborts', async () => {
    window.mutate = vi.fn().mockResolvedValue({ abort: true });
    offerUndo('Gebucht.', [{ mid: 'm1', date: '2021-01-04', prev: null }], 'Buchung');
    document.getElementById('undoBtn')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('toast')!.textContent).not.toBe('Rückgängig gemacht ✓');
  });
});
