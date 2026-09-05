// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';
import { BookingForm, openBookingForm } from './BookingForm.tsx';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

beforeEach(() => {
  document.body.innerHTML = `<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div>`;
  store.set({
    user: 'anna',
    data: { machines: [machine()], bookings: {} },
  } as unknown as Partial<AppState>);
  window.S = store.state;
  // machById (../machine-lookup.ts) is a direct import now (F8 cleanup,
  // ARCHITECTURE_AUDIT.md) — needs no mock, the real one reads the store data set up above.
  window.mutate = vi.fn();
});

describe('BookingForm', () => {
  // What: the form lists which machine(s) it's booking and defaults its name/date fields
  // from the current user and the given props.
  // How: renders with one machine and a date range and checks the machine name, the
  // logged-in user's name, and both dates all appear as field values.
  it('lists the machine(s) and defaults name/dates from props and the current user', () => {
    render(<BookingForm machineIds={['m1']} from="2021-01-04" to="2021-01-05" />);
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByDisplayValue('anna')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2021-01-04')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2021-01-05')).toBeInTheDocument();
  });

  // What: submitting with an empty name is rejected client-side — no write is attempted, and
  // the user is toasted about the missing name.
  // How: clears the name field, clicks Buchen, and checks mutate was never called and the
  // toast names the problem.
  it('rejects an empty name without calling mutate', async () => {
    render(<BookingForm machineIds={['m1']} from="2021-01-04" to="2021-01-04" />);
    fireEvent.change(screen.getByDisplayValue('anna'), { target: { value: '' } });
    await act(async () => {
      screen.getByRole('button', { name: 'Buchen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toContain('Namen eingeben');
  });

  // What: submitting with `from` after `to` (an inverted range) is rejected client-side.
  // How: opens the form with from/to swapped, clicks Buchen, and checks the rejection.
  it('rejects an inverted date range', async () => {
    render(<BookingForm machineIds={['m1']} from="2021-01-05" to="2021-01-04" />);
    await act(async () => {
      screen.getByRole('button', { name: 'Buchen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toContain('gültigen Zeitraum');
  });

  // What: a range so large it would create an excessive number of cells is rejected
  // client-side before ever attempting the write.
  // How: opens the form with a 2-year range, clicks Buchen, and checks the rejection.
  it('rejects a range that would create too many cells', async () => {
    render(<BookingForm machineIds={['m1']} from="2021-01-01" to="2023-01-01" />);
    await act(async () => {
      screen.getByRole('button', { name: 'Buchen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toContain('zu groß');
  });

  // What: a successful book covers every day in the range, weekends included (the form
  // itself doesn't skip them — that's the weekend-bridge sweep's job elsewhere), logs a
  // message naming the date range, and closes the modal on success.
  // How: opens the form over a Sat+Sun range, submits, and checks the reducer passed to
  // mutate actually books both days when applied, the log message names the range, and the
  // overlay closed.
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

  // What: when the write reports conflicts, the form stays open and shows the conflict list
  // plus a "book only the free ones" fallback button, instead of closing as if it succeeded.
  // Clicking that fallback button retries with a normal book call.
  // How: stubs mutate to return one conflict, submits, checks the conflict text/name appear
  // and the modal stayed open, then clicks the fallback button and checks mutate was called
  // again for the retry.
  it('shows the conflict list and a force-book button instead of closing, on conflict', async () => {
    window.mutate = vi
      .fn()
      .mockResolvedValueOnce({ conflicts: [{ machineId: 'm1', date: '2021-01-04', by: 'bob' }] });
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

  // What: the conflict list itself is capped at 15 shown entries even when there are more,
  // with an ellipsis marking the truncation, while the header count still shows the real total.
  // How: stubs mutate to return 20 conflicts, submits, and checks both the "20" total in the
  // header and the presence of the truncation ellipsis.
  it('caps the shown conflict list at 15, with an ellipsis for the rest', async () => {
    const manyConflicts = Array.from({ length: 20 }, (_, i) => ({
      machineId: 'm1',
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

  // What: "Abbrechen" (cancel) closes the form without attempting any write.
  // How: opens the form, clicks Abbrechen, and checks mutate was never called and the overlay closed.
  it('Abbrechen closes without booking', () => {
    act(() => openBookingForm(['m1'], '2021-01-04', '2021-01-04'));
    act(() => {
      screen.getByRole('button', { name: 'Abbrechen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});

describe('BookingForm — fixed dates (opened from the Assistant)', () => {
  // What: when opened with an explicit `dates` list (a custom, possibly gapped "Buchbare
  // Wochentage" selection resolved by the Assistant's own search), the form shows those exact
  // dates read-only instead of editable Von/Bis fields, and books exactly that list — not
  // every calendar day between its first and last entry.
  // How: opens with a gapped Mon/Wed/Fri list, checks the read-only dates line replaces the
  // date inputs, submits, and checks the reducer passed to mutate books exactly 3 cells (not
  // the 5 calendar days a Von/Bis range over the same span would expand to).
  it('books exactly the given dates, not the full calendar span between them', async () => {
    window.mutate = vi.fn().mockResolvedValue({ count: 3, undo: [] });
    const dates = ['2021-01-04', '2021-01-06', '2021-01-08']; // Mon, Wed, Fri — gapped
    act(() => openBookingForm(['m1'], dates[0]!, dates[dates.length - 1]!, dates));
    expect(document.querySelectorAll('#modal input[type="date"]')).toHaveLength(0);
    expect(screen.getByText(/Mo\.?,? 04\.01\.2021/)).toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: 'Buchen' }).click();
    });
    const [reducer] = (window.mutate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const fresh = { machines: [machine()], bookings: {} };
    const result = reducer(fresh);
    expect(result.count).toBe(3); // exactly the 3 given dates, Tue/Thu excluded
  });
});

describe('openBookingForm', () => {
  // What: the booking form is a "sticky" modal — Escape doesn't dismiss it, unlike most
  // other modals, since accidentally losing an in-progress booking would be disruptive.
  // How: opens the form, fires Escape, and checks the overlay is still open.
  it('opens the form as a sticky modal (Escape does not dismiss it)', () => {
    act(() => openBookingForm(['m1'], '2021-01-04', '2021-01-04'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
  });
});
