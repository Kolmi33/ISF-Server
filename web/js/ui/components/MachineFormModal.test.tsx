// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';

// MachineFormModal.tsx imports `fillGroupSel` directly from `./GroupFilterDropdown.tsx` and
// `openAdmin` directly from `./AdminModal.tsx` (part of a real 3-way import cycle with
// LogModal.tsx too — F8 cleanup, ARCHITECTURE_AUDIT.md) rather than reaching through
// `window.fillGroupSel`/`window.openAdmin` — mocked here so this test keeps
// controlling/observing them as before. `machById` (../machine-lookup.ts) is also a direct
// import now, but needs no mock — the real one reads the store data set up below.
vi.mock('./GroupFilterDropdown.tsx', () => ({ fillGroupSel: vi.fn() }));
vi.mock('./AdminModal.tsx', () => ({ openAdmin: vi.fn() }));

import { openMachineForm } from './MachineFormModal.tsx';
import { fillGroupSel } from './GroupFilterDropdown.tsx';
import { openAdmin } from './AdminModal.tsx';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

beforeEach(() => {
  document.body.innerHTML =
    '<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div>';
  store.set({
    data: {
      machines: [
        machine({ id: 'm1', name: 'Fräse', group: 'Halle 1' }),
        machine({
          id: 'm2',
          name: 'Presse',
          group: 'Labor',
          cat: 'messtechnik',
          redu: 'Rauheitsmessgerät',
        }),
      ],
      bookings: {},
    },
  } as unknown as Partial<AppState>);
  window.S = store.state;
  window.mutate = vi.fn((fn) => Promise.resolve(fn(window.S.data!)));
  window.askConfirm = vi.fn().mockResolvedValue(true);
  vi.mocked(fillGroupSel).mockClear();
  vi.mocked(openAdmin).mockClear();
});

describe('MachineFormModal — new machine', () => {
  it('shows "Neue Ressource", no delete button, and defaults the group to the first machine\'s', () => {
    act(() => openMachineForm(null));
    expect(screen.getByText('Neue Ressource')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
    expect((document.querySelectorAll('#modal select')[1] as HTMLSelectElement).value).toBe(
      'Halle 1',
    );
  });

  it('rejects an empty name/group and does not mutate', async () => {
    act(() => openMachineForm(null));
    await act(async () => {
      screen.getByRole('button', { name: 'Speichern' }).click();
      await Promise.resolve();
    });
    expect(document.getElementById('toast')!.textContent).toBe('Name und Bereich sind Pflicht.');
    expect(window.mutate).not.toHaveBeenCalled();
  });

  it('creates a machine on valid input, then returns to Admin and toasts', async () => {
    act(() => openMachineForm(null));
    fireEvent.change(document.querySelectorAll('#modal input[type="text"]')[0]!, {
      target: { value: 'Neue Maschine' },
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Speichern' }).click();
      await Promise.resolve();
    });
    expect(window.mutate).toHaveBeenCalledWith(
      expect.any(Function),
      'Maschine angelegt: Neue Maschine',
    );
    expect(window.S.data!.machines.some((m) => m.name === 'Neue Maschine')).toBe(true);
    expect(fillGroupSel).toHaveBeenCalled();
    expect(openAdmin).toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toBe('Gespeichert ✓');
  });

  it('a free-text new group is used over the selected one', async () => {
    act(() => openMachineForm(null));
    fireEvent.change(document.querySelectorAll('#modal input[type="text"]')[0]!, {
      target: { value: 'X' },
    });
    fireEvent.change(screen.getByPlaceholderText('…oder neuen Bereich eingeben'), {
      target: { value: 'Ganz neuer Bereich' },
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Speichern' }).click();
      await Promise.resolve();
    });
    const created = window.S.data!.machines.find((m) => m.name === 'X');
    expect(created?.group).toBe('Ganz neuer Bereich');
  });

  it('unchecking every weekday blocks save with the right toast', async () => {
    act(() => openMachineForm(null));
    fireEvent.change(document.querySelectorAll('#modal input[type="text"]')[0]!, {
      target: { value: 'X' },
    });
    document.querySelectorAll('#modal input[type="checkbox"]').forEach((cb) => fireEvent.click(cb));
    await act(async () => {
      screen.getByRole('button', { name: 'Speichern' }).click();
      await Promise.resolve();
    });
    expect(document.getElementById('toast')!.textContent).toBe(
      'Mindestens einen verfügbaren Wochentag wählen.',
    );
    expect(window.mutate).not.toHaveBeenCalled();
  });

  it('adds and removes a maintenance slot; an invalid range blocks save', async () => {
    act(() => openMachineForm(null));
    fireEvent.change(document.querySelectorAll('#modal input[type="text"]')[0]!, {
      target: { value: 'X' },
    });
    act(() => {
      screen.getByRole('button', { name: '＋ Wartung/Defekt hinzufügen' }).click();
    });
    const dateInputs = document.querySelectorAll('#modal input[type="date"]');
    fireEvent.change(dateInputs[0]!, { target: { value: '2021-02-01' } });
    fireEvent.change(dateInputs[1]!, { target: { value: '2021-01-01' } }); // until before from
    await act(async () => {
      screen.getByRole('button', { name: 'Speichern' }).click();
      await Promise.resolve();
    });
    expect(document.getElementById('toast')!.textContent).toBe(
      'Wartungs-Zeitraum ungültig (von liegt nach bis).',
    );

    act(() => {
      screen.getByRole('button', { name: 'Slot löschen' }).click();
    });
    expect(screen.getByText(/Keine Wartungs-\/Ausfallzeiten/)).toBeInTheDocument();
  });
});

describe('MachineFormModal — edit', () => {
  it('pre-fills every field from the existing machine', () => {
    act(() => openMachineForm('m2'));
    expect(screen.getByText('Ressource bearbeiten')).toBeInTheDocument();
    expect(
      (document.querySelectorAll('#modal input[type="text"]')[0] as HTMLInputElement).value,
    ).toBe('Presse');
    expect((document.querySelectorAll('#modal select')[0] as HTMLSelectElement).value).toBe(
      'messtechnik',
    );
  });

  it('deleting confirms, then mutates, returns to Admin, and toasts', async () => {
    act(() => openMachineForm('m1'));
    await act(async () => {
      screen.getByRole('button', { name: 'Löschen' }).click();
      await Promise.resolve();
    });
    expect(window.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Maschine löschen?' }),
    );
    expect(window.mutate).toHaveBeenCalledWith(expect.any(Function), 'Maschine gelöscht: Fräse');
    expect(window.S.data!.machines.some((m) => m.id === 'm1')).toBe(false);
    expect(openAdmin).toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toBe('Maschine gelöscht.');
  });

  it('declining the delete confirm does not mutate', async () => {
    window.askConfirm = vi.fn().mockResolvedValue(false);
    act(() => openMachineForm('m1'));
    await act(async () => {
      screen.getByRole('button', { name: 'Löschen' }).click();
      await Promise.resolve();
    });
    expect(window.mutate).not.toHaveBeenCalled();
    expect(window.S.data!.machines.some((m) => m.id === 'm1')).toBe(true);
  });

  it('"Zurück" returns to Admin without mutating', () => {
    act(() => openMachineForm('m1'));
    act(() => {
      screen.getByRole('button', { name: 'Zurück' }).click();
    });
    expect(openAdmin).toHaveBeenCalled();
    expect(window.mutate).not.toHaveBeenCalled();
  });
});
