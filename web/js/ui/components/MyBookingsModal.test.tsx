// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';

// MyBookingsModal.tsx imports `saveFilters`/`updateMachBtn` directly from
// `./MachineFilterDropdown.tsx` (F8 cleanup, ARCHITECTURE_AUDIT.md) rather than reaching
// through `window.saveFilters`/`window.updateMachBtn` — mocked here so this test keeps
// controlling/observing them as before.
vi.mock('./MachineFilterDropdown.tsx', () => ({ saveFilters: vi.fn(), updateMachBtn: vi.fn() }));

import { MyBookingsModal, openMyBookings } from './MyBookingsModal.tsx';
import { saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';

const TODAY = '2021-01-04'; // a Monday

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

// This component calls both its own (still window-bridged) window.notify() AND
// ui/grid-scroll.ts's prependWeek() (migrated — calls store.notify() directly). Wiring
// window.notify to forward to store.notify(), exactly as app.ts does in production, means
// notifySpy sees every repaint trigger regardless of which path fired it.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div><div id="gridWrap"></div>`;
  store.set({
    user: 'anna',
    data: { machines: [machine()], bookings: {} },
    favs: new Set(),
    cats: new Set(),
    collapsed: new Set(),
    machSel: new Set(),
    startMonday: new Date(`${TODAY}T00:00:00Z`),
    extraWeeks: 0,
  } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
  window.mutate = vi.fn();
  window.askConfirm = vi.fn().mockResolvedValue(true);
  window.notify = () => store.notify();
  vi.mocked(saveFilters).mockClear();
  vi.mocked(updateMachBtn).mockClear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MyBookingsModal', () => {
  it('shows a message when there are no future bookings', () => {
    render(<MyBookingsModal />);
    expect(screen.getByText(/Keine zukünftigen Buchungen/)).toBeInTheDocument();
  });

  it('shows a single-day booking with its note, no expand chip', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna', note: 'wichtig' } } };
    render(<MyBookingsModal />);
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByText('(wichtig)')).toBeInTheDocument();
    expect(screen.queryByText('▸')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('shows a multi-day series collapsed by default, expandable via the chip', () => {
    window.S.data!.bookings = {
      m1: { '2021-01-04': { name: 'anna' }, '2021-01-05': { name: 'anna' } },
    };
    render(<MyBookingsModal />);
    expect(screen.getByText('2 Tage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Serie löschen' })).toBeInTheDocument();
    expect(screen.queryByText('04.01.2021')).not.toBeInTheDocument(); // collapsed

    act(() => {
      screen.getByText('▸').click();
    });
    expect(screen.getAllByRole('button', { name: 'Löschen' })).toHaveLength(2); // one per day
  });

  it('shows no "only my machines" button when there are no runs', () => {
    render(<MyBookingsModal />);
    expect(screen.queryByText(/Nur meine Maschinen/)).not.toBeInTheDocument();
  });

  it('shows the "only my machines" button, with the right count, once a run exists', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    render(<MyBookingsModal />);
    expect(
      screen.getByRole('button', { name: /Nur meine Maschinen im Plan zeigen \(1\)/ }),
    ).toBeInTheDocument();
  });

  it('the "only my machines" button filters, persists, notifies, closes, and toasts', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    act(() => openMyBookings());
    act(() => {
      screen.getByRole('button', { name: /Nur meine Maschinen/ }).click();
    });
    expect(window.S.machSel).toEqual(new Set(['m1']));
    expect(saveFilters).toHaveBeenCalledOnce();
    expect(updateMachBtn).toHaveBeenCalledOnce();
    expect(notifySpy).toHaveBeenCalledOnce();
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toContain('nur deine 1 Maschine');
  });

  it('"goto" expands the category/group, scrolls to the first live date, and closes', () => {
    window.S.collapsed = new Set(['Halle 1']);
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    act(() => openMyBookings());
    act(() => {
      screen.getByRole('button', { name: 'Im Plan anzeigen' }).click();
    });
    expect(window.S.cats.has('maschine')).toBe(true);
    expect(window.S.collapsed.has('Halle 1')).toBe(false);
    // Once from gotoRun itself, once more from inside prependWeek() (also called here, as
    // legacy's own resetView(); notify(); prependWeek(); gotoDate(iso); sequence does).
    expect(notifySpy).toHaveBeenCalledTimes(2);
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });

  it('deleting a single day mutates, then re-filters the run live and offers undo', async () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    // A faithful-enough mutate stub: apply the reducer to the real window.S.data, exactly as
    // the real (still-legacy) mutate() does, so the live re-filter has something to see.
    window.mutate = vi.fn((fn) => Promise.resolve(fn(window.S.data)));
    render(<MyBookingsModal />);
    await act(async () => {
      screen.getByRole('button', { name: 'Löschen' }).click();
    });
    expect(window.mutate).toHaveBeenCalledOnce();
    expect(screen.getByText(/Keine zukünftigen Buchungen/)).toBeInTheDocument(); // re-filtered live
    expect(document.getElementById('toast')!.textContent).toContain('gelöscht');
  });

  it('deleting a series with more than one day asks to confirm first', async () => {
    window.S.data!.bookings = {
      m1: { '2021-01-04': { name: 'anna' }, '2021-01-05': { name: 'anna' } },
    };
    render(<MyBookingsModal />);
    await act(async () => {
      screen.getByRole('button', { name: 'Serie löschen' }).click();
    });
    expect(window.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ganze Serie löschen?', yes: '2 Tage löschen' }),
    );
    expect(window.mutate).toHaveBeenCalledOnce();
  });

  it('does not delete the series when the confirm is declined', async () => {
    window.askConfirm = vi.fn().mockResolvedValue(false);
    window.S.data!.bookings = {
      m1: { '2021-01-04': { name: 'anna' }, '2021-01-05': { name: 'anna' } },
    };
    render(<MyBookingsModal />);
    await act(async () => {
      screen.getByRole('button', { name: 'Serie löschen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
  });

  it('Schließen closes without deleting', () => {
    act(() => openMyBookings());
    act(() => {
      screen.getByRole('button', { name: 'Schließen' }).click();
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});

describe('openMyBookings', () => {
  it('prompts for a name first when none is set, instead of opening', () => {
    window.S.user = '';
    act(() => openMyBookings());
    expect(screen.getByText('Wie heißt du?')).toBeInTheDocument();
    expect(screen.queryByText('Meine Buchungen (ab heute)')).not.toBeInTheDocument();
  });

  it('opens the modal when a name is already set', () => {
    act(() => openMyBookings());
    expect(screen.getByText('Meine Buchungen (ab heute)')).toBeInTheDocument();
  });
});
