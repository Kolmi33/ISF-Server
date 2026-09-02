// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';
import { openAllBookings } from './AllBookingsModal.tsx';

const TODAY = '2021-01-04'; // a Monday

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

// This component's "goto" calls into ui/grid-scroll.ts's resetView()/prependWeek()
// (migrated — read/write state via the real `store` singleton). window.S is kept aliased
// to store.state so both sides agree; window.notify forwards to store.notify() exactly as
// app.ts does in production, so notifySpy sees every repaint trigger, not just this
// component's own explicit call.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  localStorage.clear();
  document.body.innerHTML =
    '<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div><div id="gridWrap"></div>';
  store.set({
    data: {
      machines: [
        machine({ id: 'm1', name: 'Fräse', group: 'Halle 1' }),
        machine({ id: 'm2', name: 'Presse', group: 'Halle 2' }),
        machine({ id: 'm3', name: 'Messgerät', group: 'Labor', cat: 'messtechnik' }),
      ],
      bookings: {
        m1: { '2021-01-04': { name: 'anna', ts: '2021-01-01T10:00' } },
        m2: { '2021-01-05': { name: 'bob' } },
      },
    },
    favs: new Set(),
    machSel: new Set(),
    startMonday: new Date(`${TODAY}T00:00:00Z`),
    extraWeeks: 0,
  } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
  window.notify = () => store.notify();
  window.saveFilters = vi.fn();
  window.updateMachBtn = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AllBookingsModal', () => {
  it('lists every future run, with a count and no truncation notice', () => {
    act(() => openAllBookings());
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByText('Presse')).toBeInTheDocument();
    expect(screen.getByText(/2 Einträge/)).toBeInTheDocument();
    expect(screen.queryByText(/gekürzt/)).not.toBeInTheDocument();
  });

  it('shows a message when no runs match the filters', () => {
    act(() => openAllBookings());
    fireEvent.change(screen.getByPlaceholderText('Kolmanovskyi'), { target: { value: 'zzz' } });
    expect(screen.getByText('Keine Buchungen für diese Filter gefunden.')).toBeInTheDocument();
  });

  it('filters by person and by machine name', () => {
    act(() => openAllBookings());
    fireEvent.change(screen.getByPlaceholderText('Kolmanovskyi'), { target: { value: 'anna' } });
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.queryByText('Presse')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Kolmanovskyi'), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('Berger'), { target: { value: 'Presse' } });
    expect(screen.getByText('Presse')).toBeInTheDocument();
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument();
  });

  // The "Bereich"/"Sortieren" <select>s sit next to a plain (non-`htmlFor`) <label>, matching
  // legacy's own markup exactly — queried by DOM order (Bereich, then Sortieren) rather than
  // by label association, which those `<label>`s don't provide.
  const groupSelect = () => document.querySelectorAll<HTMLSelectElement>('#modal select')[0]!;
  const sortSelect = () => document.querySelectorAll<HTMLSelectElement>('#modal select')[1]!;

  it('groups the "Bereich" select by category, one optgroup per category with matching groups', () => {
    act(() => openAllBookings());
    const optgroups = [...groupSelect().querySelectorAll('optgroup')];
    expect(optgroups.map((g) => g.label)).toEqual(['Maschinen', 'Messtechnik']);
    expect([...optgroups[0]!.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'Halle 1',
      'Halle 2',
    ]);
  });

  it('persists the sort key to localStorage and restores it on next open', () => {
    act(() => openAllBookings());
    fireEvent.change(sortSelect(), { target: { value: 'person' } });
    expect(localStorage.getItem('mb_absort')).toBe('person');
    act(() => {
      screen.getByRole('button', { name: 'Schließen' }).click();
    });
    act(() => openAllBookings());
    expect(sortSelect().value).toBe('person');
  });

  it('"goto" filters the plan to the run\'s machine, jumps to its first day, closes, and toasts', () => {
    act(() => openAllBookings());
    act(() => {
      screen.getAllByRole('button', { name: 'Im Plan anzeigen' })[0]!.click();
    });
    expect(window.S.machSel).toEqual(new Set(['m1']));
    expect(window.saveFilters).toHaveBeenCalled();
    expect(window.updateMachBtn).toHaveBeenCalled();
    expect(notifySpy).toHaveBeenCalled();
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toMatch(/Fräse/);
  });

  it('closes on "Schließen"', () => {
    act(() => openAllBookings());
    act(() => {
      screen.getByRole('button', { name: 'Schließen' }).click();
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});
