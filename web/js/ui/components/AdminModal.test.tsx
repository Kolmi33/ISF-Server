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
  // What: the modal lists every machine, defaulting to the manual (stored) sort order, and
  // each row gets a reorder-up arrow since manual sort is the only mode where reordering makes sense.
  // How: opens the modal and checks two known machine names are shown plus 3 "nach oben" arrows.
  it('lists every machine manually-sorted by default, with reorder arrows', () => {
    act(() => openAdmin());
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByText('Presse')).toBeInTheDocument();
    expect(screen.getAllByTitle('nach oben')).toHaveLength(3);
  });

  // What: a machine with an active 'defekt' maintenance slot shows a "defekt" badge in the list.
  // How: opens the modal (one seeded machine has a defekt slot) and checks the badge text appears.
  it('shows a defekt badge for a machine with an active maintenance slot', () => {
    act(() => openAdmin());
    expect(screen.getByText('defekt')).toBeInTheDocument();
  });

  // What: switching away from manual sort hides the reorder arrows (reordering only makes
  // sense in manual mode) and re-sorts the list, here alphabetically with German collation.
  // How: switches the sort dropdown to 'name' and checks both that the arrows disappeared and
  // the row order matches German alphabetical order.
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

  // What: the chosen sort key survives across closing and re-opening the modal — persisted,
  // not just held in transient component state.
  // How: changes the sort, checks the persisted value, closes and re-opens the modal, and
  // checks the dropdown still shows the persisted choice.
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

  // What: the search box filters the list by a case-insensitive substring of "name group",
  // matching both a machine's name and any name containing that substring.
  // How: searches for a substring that matches two machines' names and checks both appear
  // while a non-matching machine is excluded.
  it('filters the list by a name/group substring', () => {
    act(() => openAdmin());
    fireEvent.change(screen.getByPlaceholderText('Maschine suchen…'), {
      target: { value: 'presse' },
    });
    expect(screen.getByText('Presse')).toBeInTheDocument();
    expect(screen.getByText('Kaputte Presse')).toBeInTheDocument();
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument();
  });

  // What: a search with no matches shows a "no machine found" message instead of an empty list.
  // How: searches for a string that matches nothing and checks the message appears.
  it('shows a message when no machine matches the search', () => {
    act(() => openAdmin());
    fireEvent.change(screen.getByPlaceholderText('Maschine suchen…'), { target: { value: 'zzz' } });
    expect(screen.getByText('Keine Maschine gefunden.')).toBeInTheDocument();
  });

  // What: both the "add machine" and each row's "edit" button open the machine-edit form
  // component, with edit passing the specific machine's id and add passing null (new machine).
  // How: clicks "add" and checks openMachineForm(null), then clicks the first row's "edit"
  // and checks openMachineForm('m1').
  it('"Maschine hinzufügen" and "Bearbeiten" route to the machine form', () => {
    act(() => openAdmin());
    act(() => {
      screen.getByRole('button', { name: 'Maschine hinzufügen' }).click();
    });
    expect(openMachineForm).toHaveBeenCalledWith(null);
    act(() => {
      screen.getAllByRole('button', { name: 'Bearbeiten' })[0]!.click();
    });
    expect(openMachineForm).toHaveBeenCalledWith('m1');
  });

  const rowNames = () =>
    [...document.querySelectorAll('#modal .admrow .nm')].map((el) => el.getAttribute('title'));

  // What: clicking a reorder arrow re-renders the list with the new order — this specifically
  // pins that the success path is recognized correctly even though moveMachine's reducer
  // returns void (not a truthy value) on success, with only {abort:true} being truthy.
  // How: stubs window.mutate to apply the reducer to the real data (as the real mutate does),
  // checks the starting order, clicks "nach unten" on the first row, and checks the list
  // re-rendered with the swap applied.
  it('moving a machine re-renders with the new order — moveMachine returns void on success, not a truthy result', async () => {
    // A faithful-enough mutate stub: apply the reducer to the real window.S.data, exactly as
    // the real mutate() does, so a successful move is actually visible on the next render.
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

  // What: when the reorder mutate call aborts (e.g. the machine was deleted concurrently),
  // the list stays exactly as it was — no partial or incorrect reorder is shown.
  // How: stubs window.mutate to resolve with {abort:true}, clicks a reorder arrow, and checks
  // the row order is unchanged.
  it('a reorder that aborts leaves the list unchanged', async () => {
    window.mutate = vi.fn().mockResolvedValue({ abort: true });
    act(() => openAdmin());
    await act(async () => {
      screen.getAllByTitle('nach oben')[0]!.click();
      await Promise.resolve();
    });
    expect(rowNames()).toEqual(['Fräse', 'Presse', 'Kaputte Presse']);
  });

  // What: the "Schließen" (close) button closes the shared overlay.
  // How: opens the modal, clicks close, and checks the overlay's open class is gone.
  it('closes on "Schließen"', () => {
    act(() => openAdmin());
    act(() => {
      screen.getByRole('button', { name: 'Schließen' }).click();
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });

  // What: opening the admin modal before any server data has loaded doesn't open a modal
  // showing an empty/broken list — it toasts an explanatory message instead.
  // How: sets S.data to null (the pre-load state), opens the modal, and checks the overlay
  // never opened while a toast explains why.
  it('toasts instead of opening when data has not loaded yet', () => {
    store.set({ data: null } as unknown as Partial<AppState>);
    act(() => openAdmin());
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toContain('Noch keine Daten geladen');
  });
});
