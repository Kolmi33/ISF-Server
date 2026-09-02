// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';

// AdminModal.tsx imports `openMachineForm` directly from `./MachineFormModal.tsx` (part of a
// real 3-way import cycle with LogModal.tsx too — F8 cleanup, ARCHITECTURE_AUDIT.md) rather
// than reaching through `window.openMachineForm` — mocked here so this test keeps
// controlling/observing it as before.
vi.mock('./MachineFormModal.tsx', () => ({ openMachineForm: vi.fn() }));

import { openAdmin } from './AdminModal.tsx';
import { openMachineForm } from './MachineFormModal.tsx';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML =
    '<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div>';
  store.set({
    data: {
      machines: [
        machine({ id: 'm1', name: 'Fräse', group: 'Halle 1' }),
        machine({ id: 'm2', name: 'Presse', group: 'Halle 1' }),
        machine({
          id: 'm3',
          name: 'Kaputte Presse',
          group: 'Halle 2',
          maint: [{ type: 'defekt', from: '2000-01-01' }],
        }),
      ],
      log: [],
    },
  } as unknown as Partial<AppState>);
  window.S = store.state;
  window.mutate = vi.fn();
  vi.mocked(openMachineForm).mockClear();
});

describe('AdminModal', () => {
  it('lists every machine manually-sorted by default, with reorder arrows', () => {
    act(() => openAdmin());
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByText('Presse')).toBeInTheDocument();
    expect(screen.getAllByTitle('nach oben')).toHaveLength(3);
  });

  it('shows a defekt badge for a machine with an active maintenance slot', () => {
    act(() => openAdmin());
    expect(screen.getByText('defekt')).toBeInTheDocument();
  });

  it('hides the reorder arrows outside manual sort', () => {
    act(() => openAdmin());
    fireEvent.change(document.querySelector('#modal select')!, { target: { value: 'name' } });
    expect(screen.queryByTitle('nach oben')).not.toBeInTheDocument();
    // Alphabetical: Fräse, Kaputte Presse, Presse (German collation). The `.nm` span's `title`
    // is exactly the machine name, so it's an unambiguous order check even though the span's
    // own text content also includes the group/badge/days-mask children.
    const names = [...document.querySelectorAll('#modal .admrow .nm')].map((el) =>
      el.getAttribute('title'),
    );
    expect(names).toEqual(['Fräse', 'Kaputte Presse', 'Presse']);
  });

  it('persists the sort key to localStorage and restores it on next open', () => {
    act(() => openAdmin());
    fireEvent.change(document.querySelector('#modal select')!, { target: { value: 'group' } });
    expect(localStorage.getItem('mb_admsort')).toBe('group');
    act(() => {
      screen.getByRole('button', { name: 'Schließen' }).click();
    });
    act(() => openAdmin());
    expect((document.querySelector('#modal select') as HTMLSelectElement).value).toBe('group');
  });

  it('filters the list by a name/group substring', () => {
    act(() => openAdmin());
    fireEvent.change(screen.getByPlaceholderText('Maschine suchen…'), {
      target: { value: 'presse' },
    });
    expect(screen.getByText('Presse')).toBeInTheDocument();
    expect(screen.getByText('Kaputte Presse')).toBeInTheDocument();
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument();
  });

  it('shows a message when no machine matches the search', () => {
    act(() => openAdmin());
    fireEvent.change(screen.getByPlaceholderText('Maschine suchen…'), { target: { value: 'zzz' } });
    expect(screen.getByText('Keine Maschine gefunden.')).toBeInTheDocument();
  });

  it('"＋ Maschine hinzufügen" and "Bearbeiten" route to the (still-legacy) machine form', () => {
    act(() => openAdmin());
    act(() => {
      screen.getByRole('button', { name: '＋ Maschine hinzufügen' }).click();
    });
    expect(openMachineForm).toHaveBeenCalledWith(null);
    act(() => {
      screen.getAllByRole('button', { name: 'Bearbeiten' })[0]!.click();
    });
    expect(openMachineForm).toHaveBeenCalledWith('m1');
  });

  const rowNames = () =>
    [...document.querySelectorAll('#modal .admrow .nm')].map((el) => el.getAttribute('title'));

  it('moving a machine re-renders with the new order — moveMachine returns void on success, not a truthy result', async () => {
    // A faithful-enough mutate stub: apply the reducer to the real window.S.data, exactly as
    // the real (still-legacy) mutate() does, so a successful move is actually visible on the
    // next render.
    window.mutate = vi.fn((fn) => Promise.resolve(fn(window.S.data!)));
    act(() => openAdmin());
    expect(rowNames()).toEqual(['Fräse', 'Presse', 'Kaputte Presse']);

    await act(async () => {
      screen.getAllByTitle('nach unten')[0]!.click();
      await Promise.resolve();
    });
    expect(window.mutate).toHaveBeenCalledWith(expect.any(Function), 'Reihenfolge geändert');
    expect(rowNames()).toEqual(['Presse', 'Fräse', 'Kaputte Presse']);
  });

  it('a reorder that aborts leaves the list unchanged', async () => {
    window.mutate = vi.fn().mockResolvedValue({ abort: true });
    act(() => openAdmin());
    await act(async () => {
      screen.getAllByTitle('nach oben')[0]!.click();
      await Promise.resolve();
    });
    expect(rowNames()).toEqual(['Fräse', 'Presse', 'Kaputte Presse']);
  });

  it('closes on "Schließen"', () => {
    act(() => openAdmin());
    act(() => {
      screen.getByRole('button', { name: 'Schließen' }).click();
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });

  it('toasts instead of opening when data has not loaded yet', () => {
    store.set({ data: null } as unknown as Partial<AppState>);
    act(() => openAdmin());
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toContain('Noch keine Daten geladen');
  });
});
