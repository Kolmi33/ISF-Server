// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { AppState, Booking, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';

// BookingDetailModal.tsx imports `openStats` directly from `./StatsModal.tsx` (F8 cleanup,
// ARCHITECTURE_AUDIT.md) rather than reaching through `window.openStats` — mocked here so
// this test keeps observing it as before. `machById` (../machine-lookup.ts) is also a direct
// import now, but needs no mock — the real one reads the store data set up below.
vi.mock('./StatsModal.tsx', () => ({ openStats: vi.fn() }));

import { BookingDetailModal, openBookingDetail, openCellAction } from './BookingDetailModal.tsx';
import { openStats } from './StatsModal.tsx';

const TODAY = '2021-01-06'; // a Wednesday

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return { name: 'anna', ...overrides };
}

beforeEach(() => {
  document.body.innerHTML = `<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div>`;
  store.set({ data: { machines: [machine()], bookings: {} } } as unknown as Partial<AppState>);
  window.S = store.state;
  window.mutate = vi.fn().mockResolvedValue({ deletedCount: 1, undo: [] });
  window.askConfirm = vi.fn().mockResolvedValue(true);
  vi.mocked(openStats).mockClear();
});

describe('BookingDetailModal', () => {
  // What: the modal shows which machine, date, and person the booking belongs to.
  // How: renders a plain booking and checks the machine name and booker name both appear.
  it('shows the machine, date, and booker', () => {
    render(<BookingDetailModal machine={machine()} date={TODAY} booking={booking()} />);
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByText('anna')).toBeInTheDocument();
  });

  // What: the optional "Notiz" (note) and "Eingetragen" (entered-at) rows only render when
  // the booking actually has those fields — they're not shown as empty placeholders.
  // How: renders a bare booking (checks neither row shows), then re-renders with a note and
  // timestamp set (checks both now appear).
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

  // What: the "Statistik" button opens the stats modal pre-filtered to this booking's
  // person, with the name lowercased (matching the stats filter's own case-insensitive convention).
  // How: renders a booking with a mixed-case name, clicks Statistik, and checks openStats was
  // called with the lowercased name.
  it('the Statistik button opens stats pre-filtered to the lowercased booker name', () => {
    render(
      <BookingDetailModal machine={machine()} date={TODAY} booking={booking({ name: 'Anna' })} />,
    );
    screen.getByRole('button', { name: /Statistik/ }).click();
    expect(openStats).toHaveBeenCalledWith('anna');
  });

  // What: a booking with no run of adjacent same-name days around it, and no group id, shows
  // neither the "part of a series" hint nor a whole-series delete button.
  // How: renders an isolated booking (no adjacent days in the store) and checks both are absent.
  it('shows neither a series hint nor a run-delete button for a standalone booking', () => {
    render(<BookingDetailModal machine={machine()} date={TODAY} booking={booking()} />);
    expect(screen.queryByText(/Teil einer Serie/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ganze Serie löschen' })).not.toBeInTheDocument();
  });

  // What: when the surrounding days form a same-name contiguous run, the modal detects it,
  // shows a "part of a series" hint, and offers a whole-run delete that (after confirming,
  // naming the exact day count) deletes every day in the run at once.
  // How: seeds three consecutive booked days under the same name, checks the hint appears,
  // clicks the whole-series delete, checks the confirm dialog names 3 days, and checks the
  // reducer passed to mutate actually deletes all 3 when applied.
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
    expect(result.deletedCount).toBe(3);
  });

  // What: declining the whole-run delete confirmation aborts it — no write happens.
  // How: stubs askConfirm to resolve false, clicks the whole-series delete, and checks mutate
  // was never called.
  it('does not delete the run when the confirm is declined', async () => {
    window.askConfirm = vi.fn().mockResolvedValue(false);
    window.S.data!.bookings = { m1: { '2021-01-05': booking(), [TODAY]: booking() } };
    render(<BookingDetailModal machine={machine()} date={TODAY} booking={booking()} />);
    await act(async () => {
      screen.getByRole('button', { name: 'Ganze Serie löschen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
  });

  // What: a booking that carries a group id (a multi-machine/multi-day booking group, not
  // just a same-name run) shows the group hint and title instead of the run hint, offers a
  // whole-group delete instead of a whole-run one, and that delete confirms first.
  // How: seeds two cells on different machines sharing one gid/gtitle, renders one of them,
  // checks the group hint and title appear and the run-delete button is absent, then clicks
  // the group-delete button and checks the confirm dialog and the mutate call.
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

  // What: a grouped booking with no gtitle set still shows the group hint and delete button
  // — the title is optional, but the grouping itself isn't.
  // How: seeds one cell with a gid but no gtitle and checks the group hint and button both appear.
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

  // What: declining the whole-group delete confirmation aborts it — no write happens.
  // How: stubs askConfirm to resolve false, clicks the group-delete button, and checks mutate
  // was never called.
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

  // What: "Diesen Tag löschen" (delete this day) needs no confirmation — it closes the modal
  // immediately and deletes only the one specific day it was invoked on, leaving any
  // surrounding run/group days untouched.
  // How: clicks the single-day delete, checks the modal closed right away and mutate ran, and
  // checks the reducer passed to mutate only deletes the one seeded day.
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
    expect(result.deletedCount).toBe(1);
  });
});

describe('openBookingDetail', () => {
  // What: unlike the booking form, the detail modal is NOT sticky — Escape dismisses it normally.
  // How: opens the modal, fires Escape, and checks the overlay closed.
  it('is not sticky — Escape dismisses it', () => {
    act(() => openBookingDetail(machine(), TODAY, booking()));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});

describe('openCellAction', () => {
  // What: clicking a blocked, unbooked cell doesn't open any modal — it just toasts an
  // explanation naming the machine, since there's nothing bookable or bookable-detail-worthy there.
  // How: blocks the machine with a maintenance slot covering today, calls openCellAction, and
  // checks no modal opened while the toast names the machine.
  it('toasts and does nothing when the machine is blocked with no booking', () => {
    window.S.data!.machines = [machine({ maint: [{ type: 'defekt', from: TODAY, until: TODAY }] })];
    openCellAction('m1', TODAY);
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toContain('Fräse');
  });

  // What: the same "toast, don't open" behavior applies when the machine simply isn't
  // scheduled to work that weekday (per its days mask), with no booking there either.
  // How: gives the machine a mask with today's weekday off, calls openCellAction, and checks
  // no modal opened while the toast explains unavailability.
  it('toasts and does nothing when the machine is unavailable that weekday, with no booking', () => {
    window.S.data!.machines = [machine({ days: '1101111' })]; // Mo,Di,Do..So on; Mi (TODAY) off
    openCellAction('m1', TODAY);
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toContain('nicht verfügbar');
  });

  // What: clicking an occupied cell opens the booking DETAIL modal (view/delete an existing booking).
  // How: books the cell, calls openCellAction, and checks the detail modal's heading appears.
  it('opens the booking detail when the cell is occupied', () => {
    window.S.data!.bookings = { m1: { [TODAY]: booking() } };
    act(() => openCellAction('m1', TODAY));
    expect(screen.getByText('Buchung')).toBeInTheDocument();
  });

  // What: clicking a free, bookable cell opens the booking FORM instead (create a new booking).
  // How: calls openCellAction on a free cell and checks the booking form's heading appears.
  it('opens the booking form when the cell is free', () => {
    act(() => openCellAction('m1', TODAY));
    expect(screen.getByRole('heading', { name: 'Buchen' })).toBeInTheDocument();
  });

  // What: calling openCellAction with a machine id that doesn't exist is a safe no-op.
  // How: calls openCellAction with an unknown id and checks it doesn't throw.
  it('is a no-op for an unknown machine id', () => {
    expect(() => openCellAction('nope', TODAY)).not.toThrow();
  });
});
