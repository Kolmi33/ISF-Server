// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Machine } from '../../../../shared/types.ts';
import {
  addDays,
  formatDateAsIsoString,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../../shared/dates.ts';
import { store } from '../../store-instance.ts';

vi.mock('./MachineFilterDropdown.tsx', () => ({ saveFilters: vi.fn(), updateMachBtn: vi.fn() }));
vi.mock('./AssistantModal.tsx', () => ({
  AssistantModal: ({
    preset,
  }: {
    preset?: { machineIds: readonly string[]; workdays: number };
  }) => (
    <div
      data-testid="assistant"
      data-machines={preset?.machineIds.join(',')}
      data-workdays={preset?.workdays}
    >
      Assistent geöffnet
    </div>
  ),
}));
vi.mock('../grid-interaction.ts', () => ({ clearSelection: vi.fn() }));
vi.mock('../grid-scroll.ts', () => ({
  gotoDate: vi.fn(),
  prependWeek: vi.fn(),
  resetView: vi.fn(),
}));

import { MyBookingsModal, openMyBookings } from './MyBookingsModal.tsx';
import { saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';
import { closeReactModal } from '../modal.tsx';

const TODAY = todayAsIsoDateString();
const day = (offset: number) => formatDateAsIsoString(addDays(parseIsoDateString(TODAY), offset));
const machine = (overrides: Partial<Machine> = {}): Machine => ({
  id: 'm1',
  name: 'Fräse',
  group: 'Halle 1',
  ...overrides,
});

beforeEach(() => {
  document.body.innerHTML =
    '<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div><div id="gridWrap"></div>';
  store.set({
    user: 'anna',
    readOnly: false,
    data: { machines: [machine()], bookings: {} },
    favs: new Set(),
    cats: new Set(),
    collapsed: new Set(),
    machSel: new Set(),
    startMonday: new Date(`${TODAY}T00:00:00Z`),
    extraWeeks: 0,
  } as unknown as Partial<AppState>);
  window.S = store.state;
  window.mutate = vi.fn();
  window.askConfirm = vi.fn().mockResolvedValue(true);
  window.notify = () => store.notify();
  vi.mocked(saveFilters).mockClear();
  vi.mocked(updateMachBtn).mockClear();
});

afterEach(() => {
  act(() => closeReactModal());
  cleanup();
  vi.restoreAllMocks();
});

async function openActions(title: string) {
  fireEvent.click(screen.getByRole('button', { name: `Aktionen für ${title}` }));
  return screen.findByRole('menuitem', { name: 'Bearbeiten' });
}

describe('MyBookingsModal', () => {
  it('shows the supplied campaign shell and a useful empty state', () => {
    render(<MyBookingsModal />);
    expect(screen.getByRole('heading', { name: 'Meine Buchungen' })).toBeInTheDocument();
    expect(screen.getByText(/noch keine Buchungen/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle 0' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows only the current user and renders active, planned, and completed statuses', () => {
    window.S.data!.bookings = {
      m1: {
        [day(-5)]: { name: 'ANNA', note: 'Alt' },
        [TODAY]: { name: 'anna', note: 'Heute' },
        [day(2)]: { name: 'anna', note: 'Später' },
        [day(3)]: { name: 'bob', note: 'Fremd' },
      },
    };
    render(<MyBookingsModal />);
    expect(screen.getByRole('tab', { name: 'Alle 3' })).toBeInTheDocument();
    expect(screen.getByText('Alt')).toBeInTheDocument();
    expect(screen.getByText('Heute')).toBeInTheDocument();
    expect(screen.getByText('Später')).toBeInTheDocument();
    expect(screen.queryByText('Fremd')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Aktiv|Geplant|Abgeschlossen/)).toHaveLength(6);
  });

  it('combines a real booking group into one expandable campaign card', () => {
    window.S.data!.machines = [
      machine(),
      machine({ id: 's1', name: 'Kistler', cat: 'messtechnik' }),
    ];
    window.S.data!.bookings = {
      m1: { [day(1)]: { name: 'anna', gid: 'g1', gtitle: 'Projekt X' } },
      s1: { [day(1)]: { name: 'anna', gid: 'g1', gtitle: 'Projekt X' } },
    };
    render(<MyBookingsModal />);
    expect(screen.getAllByText('Projekt X')).toHaveLength(1);
    const headingButton = screen
      .getAllByRole('button', { name: /Projekt X/ })
      .find((button) => button.hasAttribute('aria-controls'))!;
    fireEvent.click(headingButton);
    expect(screen.getByText('Maschinen')).toBeInTheDocument();
    expect(screen.getByText('Messtechnik')).toBeInTheDocument();
    expect(screen.getByText('Kistler')).toBeInTheDocument();
    expect(screen.getAllByText('Projekt X')).toHaveLength(1);
    expect(screen.queryByText('g1')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Buchungsgruppe oder Gerät');
  });

  it('opens the action menu without dismissing the bookings dialog', async () => {
    window.S.data!.bookings = { m1: { [day(1)]: { name: 'anna' } } };
    act(() => openMyBookings());
    await openActions('Fräse');
    expect(document.getElementById('overlay')).toHaveClass('open');
    expect(screen.getByRole('menu')).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Buchung wiederholen' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Stornieren' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.getElementById('overlay')).toHaveClass('open');
  });

  it('filters by status and searches title, group, and device with reset', () => {
    window.S.data!.bookings = {
      m1: {
        [day(-5)]: { name: 'anna', note: 'Vergangen' },
        [day(2)]: { name: 'anna', note: 'Zukunft' },
      },
    };
    render(<MyBookingsModal />);
    fireEvent.click(screen.getByRole('tab', { name: 'Abgeschlossen 1' }));
    expect(screen.getByText('Vergangen')).toBeInTheDocument();
    expect(screen.queryByText('Zukunft')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Halle 1' } });
    expect(screen.getByText(/1 von 2 Buchungen/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'nichts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(screen.getByText('Zukunft')).toBeInTheDocument();
  });

  it('keeps maintenance information on the campaign without a top-level warning', () => {
    window.S.data!.machines = [
      machine({ maint: [{ type: 'wartung', from: day(2), until: day(2) }] }),
    ];
    window.S.data!.bookings = { m1: { [day(2)]: { name: 'anna' } } };
    render(<MyBookingsModal />);
    expect(screen.queryByText(/Wartung überschneidet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Wartung/)).not.toBeInTheDocument();
  });

  it('consolidates all bookings, supports owner filtering, and restricts foreign actions', async () => {
    window.S.data!.bookings = {
      m1: {
        [day(1)]: { name: 'anna', gid: 'own', gtitle: 'Eigenes Projekt' },
        [day(3)]: { name: 'bob', gid: 'foreign', gtitle: 'Fremdes Projekt' },
      },
    };
    render(<MyBookingsModal />);
    fireEvent.click(screen.getByRole('button', { name: /^Alle$/ }));
    expect(screen.getByRole('heading', { name: 'Alle Buchungen' })).toBeInTheDocument();
    expect(screen.getByText('Fremdes Projekt')).toBeInTheDocument();
    expect(screen.getAllByText('bob').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('combobox', { name: /Person/ }), {
      target: { value: 'bob' },
    });
    expect(screen.queryByText('Eigenes Projekt')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Fremdes Projekt' }));
    expect(await screen.findByRole('menuitem', { name: 'Ansehen' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Als Vorlage verwenden' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Stornieren' })).not.toBeInTheDocument();
  });

  it('opens the existing Assistant from the new-booking action', () => {
    act(() => openMyBookings());
    fireEvent.click(screen.getAllByRole('button', { name: 'Neue Buchung' })[0]!);
    expect(screen.getByText('Assistent geöffnet')).toBeInTheDocument();
  });

  it('navigates a campaign to the real plan and applies its machine filter', async () => {
    window.S.data!.bookings = { m1: { [day(2)]: { name: 'anna' } } };
    act(() => openMyBookings());
    await openActions('Fräse');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Bearbeiten' }));
    expect(window.S.machSel).toEqual(new Set(['m1']));
    expect(window.S.cats.has('maschine')).toBe(true);
    expect(vi.mocked(saveFilters)).toHaveBeenCalledOnce();
    expect(vi.mocked(updateMachBtn)).toHaveBeenCalledOnce();
    expect(document.getElementById('overlay')).not.toHaveClass('open');
  });

  it('opens the Assistant with the campaign devices and duration when repeating', async () => {
    window.S.data!.machines = [machine(), machine({ id: 's1', name: 'Sensor' })];
    window.S.data!.bookings = {
      m1: { [day(2)]: { name: 'anna', gid: 'g1', gtitle: 'Projekt X' } },
      s1: { [day(2)]: { name: 'anna', gid: 'g1', gtitle: 'Projekt X' } },
    };
    act(() => openMyBookings());
    await openActions('Projekt X');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Buchung wiederholen' }));
    expect(screen.getByTestId('assistant')).toHaveAttribute('data-machines', 'm1,s1');
    expect(screen.getByTestId('assistant')).toHaveAttribute('data-workdays', '1');
  });

  it('confirms cancellation, deletes future own cells, preserves history, and offers undo', async () => {
    window.S.data!.bookings = {
      m1: {
        [day(-5)]: { name: 'anna', gid: 'g1', gtitle: 'Projekt X' },
        [day(1)]: { name: 'anna', gid: 'g1', gtitle: 'Projekt X' },
      },
    };
    window.mutate = vi.fn(async (reducer) => reducer(window.S.data!)) as typeof window.mutate;
    render(<MyBookingsModal />);
    await openActions('Projekt X');
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Stornieren' })));
    expect(window.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Buchung stornieren?' }),
    );
    expect(window.S.data!.bookings.m1![day(-5)]).toBeDefined();
    expect(window.S.data!.bookings.m1![day(1)]).toBeUndefined();
    expect(document.getElementById('toast')).toHaveTextContent('storniert');
  });

  it('does not mutate when cancellation is declined', async () => {
    window.S.data!.bookings = { m1: { [day(1)]: { name: 'anna' } } };
    window.askConfirm = vi.fn().mockResolvedValue(false);
    render(<MyBookingsModal />);
    await openActions('Fräse');
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Stornieren' })));
    expect(window.mutate).not.toHaveBeenCalled();
  });

  it('prevents duplicate cancellation while pending and reports mutation failures', async () => {
    window.S.data!.bookings = { m1: { [day(1)]: { name: 'anna' } } };
    let rejectMutation!: (error: Error) => void;
    window.mutate = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectMutation = reject;
        }),
    ) as typeof window.mutate;
    render(<MyBookingsModal />);
    await openActions('Fräse');
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Stornieren' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Aktionen für Fräse' })).toBeDisabled();
    await act(async () => rejectMutation(new Error('offline')));
    expect(document.getElementById('toast')).toHaveTextContent(
      'Stornieren fehlgeschlagen: offline',
    );
  });

  it('hides destructive actions and disables creation in read-only mode', async () => {
    store.set({ readOnly: true });
    window.S.data!.bookings = { m1: { [day(1)]: { name: 'anna' } } };
    render(<MyBookingsModal />);
    expect(screen.getByRole('button', { name: 'Neue Buchung' })).toBeDisabled();
    await openActions('Fräse');
    expect(screen.getByRole('menuitem', { name: 'Buchung wiederholen' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Stornieren' })).toBeDisabled();
  });

  it('refreshes from the shared store after an SSE-style update', () => {
    render(<MyBookingsModal />);
    act(() => {
      window.S.data!.bookings = { m1: { [day(1)]: { name: 'anna', note: 'Live' } } };
      store.notify();
    });
    expect(screen.getByText('Live')).toBeInTheDocument();
  });
});

describe('openMyBookings', () => {
  it('prompts for identity when no current user is set', () => {
    window.S.user = '';
    act(() => openMyBookings());
    expect(screen.getByText('Wie heißt du?')).toBeInTheDocument();
  });
});
