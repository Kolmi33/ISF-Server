// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { AppState, Booking, Machine } from '../../../../shared/types.ts';
import { BookingDetailModal, openBookingDetail, openCellAction } from './BookingDetailModal.tsx';

const TODAY = '2021-01-06'; // a Wednesday

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return { name: 'anna', ...overrides };
}

beforeEach(() => {
  document.body.innerHTML = `<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div>`;
  window.S = { data: { machines: [machine()], bookings: {} } } as unknown as AppState;
  window.machById = vi.fn((id: string) => window.S.data!.machines.find((m) => m.id === id));
  window.mutate = vi.fn().mockResolvedValue({ n: 1, undo: [] });
  window.askConfirm = vi.fn().mockResolvedValue(true);
  window.openStats = vi.fn();
});

describe('BookingDetailModal', () => {
  it('shows the machine, date, and booker', () => {
    render(<BookingDetailModal machine={machine()} date={TODAY} booking={booking()} />);
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByText('anna')).toBeInTheDocument();
  });

  it('shows the note and entered-at rows only when present', () => {
    const { rerender } = render(
      <BookingDetailModal machine={machine()} date={TODAY} booking={booking()} />,
    );
    expect(screen.queryByText('Notiz')).not.toBeInTheDocument();
    rerender(
      <BookingDetailModal
        machine={machine()}
        date={TODAY}
        booking={booking({ note: 'dringend', ts: '2021-01-01T10:00:00Z' })}
      />,
    );
    expect(screen.getByText('dringend')).toBeInTheDocument();
    expect(screen.getByText('Eingetragen')).toBeInTheDocument();
  });

  it('the Statistik button opens stats pre-filtered to the lowercased booker name', () => {
    render(
      <BookingDetailModal machine={machine()} date={TODAY} booking={booking({ name: 'Anna' })} />,
    );
    screen.getByRole('button', { name: /Statistik/ }).click();
    expect(window.openStats).toHaveBeenCalledWith('anna');
  });

  it('shows neither a series hint nor a run-delete button for a standalone booking', () => {
    render(<BookingDetailModal machine={machine()} date={TODAY} booking={booking()} />);
    expect(screen.queryByText(/Teil einer Serie/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ganze Serie löschen' })).not.toBeInTheDocument();
  });

  it('detects a same-name contiguous workday run and offers to delete it', async () => {
    window.S.data!.bookings = {
      m1: { '2021-01-05': booking(), [TODAY]: booking(), '2021-01-07': booking() },
    };
    render(<BookingDetailModal machine={machine()} date={TODAY} booking={booking()} />);
    expect(screen.getByText(/Teil einer Serie/)).toBeInTheDocument();

    await act(async () => {
      screen.getByRole('button', { name: 'Ganze Serie löschen' }).click();
    });
    expect(window.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ganze Serie löschen?', yes: '3 Tage löschen' }),
    );
    expect(window.mutate).toHaveBeenCalledOnce();
    const [reducer] = (window.mutate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const fresh = { machines: [machine()], bookings: { ...window.S.data!.bookings } };
    const result = reducer(fresh);
    expect(result.n).toBe(3);
  });

  it('does not delete the run when the confirm is declined', async () => {
    window.askConfirm = vi.fn().mockResolvedValue(false);
    window.S.data!.bookings = { m1: { '2021-01-05': booking(), [TODAY]: booking() } };
    render(<BookingDetailModal machine={machine()} date={TODAY} booking={booking()} />);
    await act(async () => {
      screen.getByRole('button', { name: 'Ganze Serie löschen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
  });

  it('a grouped booking shows the group hint and a group-delete button instead of a run one', async () => {
    window.S.data!.bookings = {
      m1: { [TODAY]: booking({ gid: 'g1', gtitle: 'Projekt X' }) },
      m2: { '2021-01-07': booking({ gid: 'g1' }) },
    };
    render(
      <BookingDetailModal
        machine={machine()}
        date={TODAY}
        booking={booking({ gid: 'g1', gtitle: 'Projekt X' })}
      />,
    );
    expect(screen.getByText(/Teil einer Buchungsgruppe/)).toBeInTheDocument();
    expect(screen.getByText('Projekt X')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ganze Serie löschen' })).not.toBeInTheDocument();

    await act(async () => {
      screen.getByRole('button', { name: 'Ganze Buchungsgruppe löschen' }).click();
    });
    expect(window.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ganze Buchungsgruppe löschen?' }),
    );
    expect(window.mutate).toHaveBeenCalledOnce();
  });

  it('a grouped booking with no title still shows the group hint', () => {
    window.S.data!.bookings = { m1: { [TODAY]: booking({ gid: 'g1' }) } };
    render(
      <BookingDetailModal machine={machine()} date={TODAY} booking={booking({ gid: 'g1' })} />,
    );
    expect(screen.getByText(/Teil einer Buchungsgruppe/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ganze Buchungsgruppe löschen' }),
    ).toBeInTheDocument();
  });

  it('does not delete the group when the confirm is declined', async () => {
    window.askConfirm = vi.fn().mockResolvedValue(false);
    window.S.data!.bookings = { m1: { [TODAY]: booking({ gid: 'g1' }) } };
    render(
      <BookingDetailModal machine={machine()} date={TODAY} booking={booking({ gid: 'g1' })} />,
    );
    await act(async () => {
      screen.getByRole('button', { name: 'Ganze Buchungsgruppe löschen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
  });

  it('"Diesen Tag löschen" closes immediately and deletes just that one day', async () => {
    render(<BookingDetailModal machine={machine()} date={TODAY} booking={booking()} />);
    await act(async () => {
      screen.getByRole('button', { name: 'Diesen Tag löschen' }).click();
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(window.mutate).toHaveBeenCalledOnce();
    const [reducer] = (window.mutate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const fresh = { machines: [machine()], bookings: { m1: { [TODAY]: booking() } } };
    const result = reducer(fresh);
    expect(result.n).toBe(1);
  });
});

describe('openBookingDetail', () => {
  it('is not sticky — Escape dismisses it', () => {
    act(() => openBookingDetail(machine(), TODAY, booking()));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});

describe('openCellAction', () => {
  it('toasts and does nothing when the machine is blocked with no booking', () => {
    window.S.data!.machines = [machine({ maint: [{ type: 'defekt', from: TODAY, until: TODAY }] })];
    openCellAction('m1', TODAY);
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toContain('Fräse');
  });

  it('toasts and does nothing when the machine is unavailable that weekday, with no booking', () => {
    window.S.data!.machines = [machine({ days: '1101111' })]; // Mo,Di,Do..So on; Mi (TODAY) off
    openCellAction('m1', TODAY);
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toContain('nicht verfügbar');
  });

  it('opens the booking detail when the cell is occupied', () => {
    window.S.data!.bookings = { m1: { [TODAY]: booking() } };
    act(() => openCellAction('m1', TODAY));
    expect(screen.getByText('Buchung')).toBeInTheDocument();
  });

  it('opens the booking form when the cell is free', () => {
    act(() => openCellAction('m1', TODAY));
    expect(screen.getByRole('heading', { name: 'Buchen' })).toBeInTheDocument();
  });

  it('is a no-op for an unknown machine id', () => {
    expect(() => openCellAction('nope', TODAY)).not.toThrow();
  });
});
