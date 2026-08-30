// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { BookingForm, openBookingForm } from './BookingForm.tsx';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

beforeEach(() => {
  document.body.innerHTML = `<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div>`;
  window.S = { user: 'anna', data: { machines: [machine()], bookings: {} } } as unknown as AppState;
  window.machById = vi.fn((id: string) => window.S.data!.machines.find((m) => m.id === id));
  window.mutate = vi.fn();
});

describe('BookingForm', () => {
  it('lists the machine(s) and defaults name/dates from props and the current user', () => {
    render(<BookingForm machineIds={['m1']} from="2021-01-04" to="2021-01-05" />);
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByDisplayValue('anna')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2021-01-04')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2021-01-05')).toBeInTheDocument();
  });

  it('rejects an empty name without calling mutate', async () => {
    render(<BookingForm machineIds={['m1']} from="2021-01-04" to="2021-01-04" />);
    fireEvent.change(screen.getByDisplayValue('anna'), { target: { value: '' } });
    await act(async () => {
      screen.getByRole('button', { name: 'Buchen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toContain('Namen eingeben');
  });

  it('rejects an inverted date range', async () => {
    render(<BookingForm machineIds={['m1']} from="2021-01-05" to="2021-01-04" />);
    await act(async () => {
      screen.getByRole('button', { name: 'Buchen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toContain('gültigen Zeitraum');
  });

  it('rejects a range that would create too many cells', async () => {
    render(<BookingForm machineIds={['m1']} from="2021-01-01" to="2023-01-01" />);
    await act(async () => {
      screen.getByRole('button', { name: 'Buchen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toContain('zu groß');
  });

  it('books every day in range including weekends, and closes on success', async () => {
    window.mutate = vi.fn().mockResolvedValue({ count: 2, undo: [] });
    act(() => openBookingForm(['m1'], '2021-01-09', '2021-01-10')); // Sat, Sun
    await act(async () => {
      screen.getByRole('button', { name: 'Buchen' }).click();
    });
    expect(window.mutate).toHaveBeenCalledOnce();
    const [reducer, logAction] = (window.mutate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(logAction).toContain('2021-01-09 bis 2021-01-10');
    const fresh = { machines: [machine()], bookings: {} };
    const result = reducer(fresh);
    expect(result.count).toBe(2); // Sat + Sun both booked
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false); // closed
  });

  it('shows the conflict list and a force-book button instead of closing, on conflict', async () => {
    window.mutate = vi
      .fn()
      .mockResolvedValueOnce({ conflicts: [{ mid: 'm1', date: '2021-01-04', by: 'bob' }] });
    act(() => openBookingForm(['m1'], '2021-01-04', '2021-01-04'));
    await act(async () => {
      screen.getByRole('button', { name: 'Buchen' }).click();
    });
    expect(screen.getByText(/Termin\(e\) bereits belegt/)).toBeInTheDocument();
    expect(screen.getByText(/bob/)).toBeInTheDocument();
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true); // still open

    window.mutate = vi.fn().mockResolvedValue({ count: 1, undo: [] });
    await act(async () => {
      screen.getByRole('button', { name: 'Nur freie Termine buchen' }).click();
    });
    expect(window.mutate).toHaveBeenCalledOnce();
  });

  it('caps the shown conflict list at 15, with an ellipsis for the rest', async () => {
    const manyConflicts = Array.from({ length: 20 }, (_, i) => ({
      mid: 'm1',
      date: `2021-01-${String(i + 1).padStart(2, '0')}`,
      by: 'bob',
    }));
    window.mutate = vi.fn().mockResolvedValue({ conflicts: manyConflicts });
    render(<BookingForm machineIds={['m1']} from="2021-01-01" to="2021-01-20" />);
    await act(async () => {
      screen.getByRole('button', { name: 'Buchen' }).click();
    });
    expect(screen.getByText('20 Termin(e) bereits belegt / gesperrt:')).toBeInTheDocument();
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('Abbrechen closes without booking', () => {
    act(() => openBookingForm(['m1'], '2021-01-04', '2021-01-04'));
    act(() => {
      screen.getByRole('button', { name: 'Abbrechen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});

describe('openBookingForm', () => {
  it('opens the form as a sticky modal (Escape does not dismiss it)', () => {
    act(() => openBookingForm(['m1'], '2021-01-04', '2021-01-04'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
  });
});
