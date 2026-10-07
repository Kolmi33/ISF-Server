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

function selectAllStatus() {
  fireEvent.click(screen.getByRole('tab', { name: /^Alle / }));
}

describe('MyBookingsModal', () => {
  it('shows the supplied campaign shell and a useful empty state', () => {
    render(<MyBookingsModal />);
    expect(screen.getByRole('heading', { name: 'Meine Buchungen' })).toBeInTheDocument();
    expect(document.getElementById('modal')).toHaveAttribute('data-dialog-size', 'xl');
    expect(screen.getByText('In diesem Status liegt gerade nichts.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aktiv 0' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('0–0 von 0')).toBeInTheDocument();
    expect(screen.getByText('Seite 1 von 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
  });

  it.each(['mine', 'all'] as const)(
    'keeps the pagination footer on a single-page %s view',
    (initialMode) => {
      window.S.data!.bookings = { m1: { [day(1)]: { name: 'anna' } } };
      render(<MyBookingsModal initialMode={initialMode} />);
      selectAllStatus();

      expect(screen.getByText('1–1 von 1')).toBeInTheDocument();
      expect(screen.getByText('Seite 1 von 1')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Zurück' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
    },
  );

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
    selectAllStatus();
    expect(screen.getByRole('tab', { name: 'Alle 3' })).toBeInTheDocument();
    expect(screen.getByText('Alt')).toBeInTheDocument();
    expect(screen.getByText('Heute')).toBeInTheDocument();
    expect(screen.getByText('Später')).toBeInTheDocument();
    expect(screen.queryByText('Fremd')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Termin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getAllByText(/Aktiv|Geplant|Abgeschlossen/)).toHaveLength(6);
  });

  it('combines a real booking group into one expandable campaign card', () => {
    window.S.data!.machines = [
      machine(),
      machine({ id: 's1', name: 'Kistler', group: 'Kraft & Dynamik', cat: 'messtechnik' }),
    ];
    window.S.data!.bookings = {
      m1: {
        [day(1)]: {
          name: 'anna',
          gid: 'g1',
          gtitle: 'Projekt X',
          ts: '2026-09-09T10:30:00Z',
        },
      },
      s1: { [day(1)]: { name: 'anna', gid: 'g1', gtitle: 'Projekt X' } },
    };
    render(<MyBookingsModal />);
    selectAllStatus();
    expect(screen.getAllByText('Projekt X')).toHaveLength(1);
    expect(screen.getByTitle(/Gebucht am 09\.09\.2026/)).toBeInTheDocument();
    const headingButton = screen
      .getAllByRole('button', { name: /Projekt X/ })
      .find((button) => button.hasAttribute('aria-controls'))!;
    fireEvent.click(headingButton);
    expect(screen.getByText('Maschinen')).toBeInTheDocument();
    expect(screen.getByText('Messtechnik')).toBeInTheDocument();
    expect(screen.getByText('Kistler')).toBeInTheDocument();
    expect(screen.getByText('Halle 1')).toBeInTheDocument();
    expect(screen.getByText('Kraft & Dynamik')).toBeInTheDocument();
    expect(screen.getByText(/Gebucht von/)).toHaveTextContent('anna');
    expect(screen.getByText(/am 09\.09\.2026/)).toBeInTheDocument();
    expect(screen.getAllByText('Projekt X')).toHaveLength(1);
    expect(screen.queryByText('g1')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Buchungsgruppe oder Gerät');
  });

  it('opens the action menu without dismissing the bookings dialog', async () => {
    window.S.data!.bookings = { m1: { [day(1)]: { name: 'anna' } } };
    act(() => openMyBookings());
    selectAllStatus();
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
    expect(screen.queryByText(/1 von 2 Buchungen/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'nichts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(screen.getByRole('tab', { name: 'Aktiv 0' })).toHaveAttribute('aria-selected', 'true');
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

  it('consolidates all bookings, shows booking metadata, and restricts foreign actions', async () => {
    window.S.data!.bookings = {
      m1: {
        [day(1)]: { name: 'anna', gid: 'own', gtitle: 'Eigenes Projekt' },
        [day(5)]: {
          name: 'bob',
          gid: 'foreign',
          gtitle: 'Fremdes Projekt',
          ts: '2026-09-09T10:30:00Z',
        },
      },
    };
    render(<MyBookingsModal initialMode="all" />);
    selectAllStatus();
    expect(screen.getByRole('heading', { name: 'Alle Buchungen' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Aktiv0',
      'Geplant2',
      'Abgeschlossen0',
      'Alle2',
    ]);
    expect(screen.getByText('Fremdes Projekt')).toBeInTheDocument();
    expect(screen.getAllByText('bob').length).toBeGreaterThan(0);
    expect(screen.queryByRole('combobox', { name: /Person/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Termin' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle(/Gebucht von bob/)).toBeInTheDocument();
    expect(screen.getByTitle(/Gebucht am/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fremdes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Fremdes Projekt' }));
    expect(await screen.findByRole('menuitem', { name: 'Ansehen' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Als Vorlage verwenden' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Stornieren' })).not.toBeInTheDocument();
  });

  it('keeps all-booking card metadata in stable desktop columns', () => {
    window.S.data!.bookings = {
      m1: {
        [TODAY]: {
          name: 'anna',
          gid: 'project',
          gtitle: 'Projekt X',
          ts: '2026-09-09T10:30:00Z',
        },
      },
    };
    render(<MyBookingsModal initialMode="all" />);

    expect(screen.queryByText('Listenentwurf')).not.toBeInTheDocument();
    expect(screen.getByTitle('Gebucht von anna')).toBeInTheDocument();
    expect(screen.getByTitle(/Gebucht am/)).toBeInTheDocument();
    const cardHeader = screen.getByTitle('Gebucht von anna').closest('li')!.firstElementChild!;
    expect(cardHeader).toHaveClass('sm:grid-cols-[minmax(18rem,1fr)_11rem_16rem_8rem_2.5rem]');
    const ownerSort = screen.getByRole('button', { name: 'Gebucht von' });
    fireEvent.click(ownerSort);
    expect(ownerSort).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(ownerSort);
    expect(ownerSort.getAttribute('title')).toContain('aufsteigend');
    fireEvent.click(screen.getAllByRole('button', { name: /Projekt X/ })[0]!);
    expect(screen.getAllByText(/Gebucht von/)).toHaveLength(2);
  });

  it('paginates the all-bookings list and returns to the first page after filtering', () => {
    const machines = Array.from({ length: 30 }, (_, index) =>
      machine({ id: `m${index}`, name: `Maschine ${index + 1}` }),
    );
    window.S.data!.machines = machines;
    window.S.data!.bookings = Object.fromEntries(
      machines.map((item) => [item.id, { [day(1)]: { name: `person-${item.id}` } }]),
    );
    render(<MyBookingsModal initialMode="all" />);
    selectAllStatus();

    expect(screen.getAllByRole('button', { name: /Aktionen für/ })).toHaveLength(25);
    expect(screen.getByText('Seite 1 von 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen.getAllByRole('button', { name: /Aktionen für/ })).toHaveLength(5);
    expect(screen.getByText('Seite 2 von 2')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Maschine 1' } });
    expect(screen.queryByText(/Seite 2 von 2/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Aktionen für/ }).length).toBeGreaterThan(0);
  });

  it('opens the existing Assistant from the new-booking action', () => {
    act(() => openMyBookings());
    fireEvent.click(screen.getAllByRole('button', { name: 'Neue Buchung' })[0]!);
    expect(screen.getByText('Assistent geöffnet')).toBeInTheDocument();
  });

  it('opens the supplied bar editor for an owned campaign', async () => {
    window.S.data!.bookings = { m1: { [day(2)]: { name: 'anna' } } };
    act(() => openMyBookings());
    selectAllStatus();
    await openActions('Fräse');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Bearbeiten' }));
    expect(screen.getByRole('heading', { name: 'Belegung bearbeiten' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Balken ziehen = verschieben · Kante ziehen = dehnen · Klick = Tag umschalten',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Fräse')).toHaveLength(2);
    expect(document.getElementById('overlay')).toHaveClass('open');
  });

  it('opens the Assistant with the campaign devices and duration when repeating', async () => {
    window.S.data!.machines = [machine(), machine({ id: 's1', name: 'Sensor' })];
    window.S.data!.bookings = {
      m1: { [day(2)]: { name: 'anna', gid: 'g1', gtitle: 'Projekt X' } },
      s1: { [day(2)]: { name: 'anna', gid: 'g1', gtitle: 'Projekt X' } },
    };
    act(() => openMyBookings());
    selectAllStatus();
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
    selectAllStatus();
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
    selectAllStatus();
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
    selectAllStatus();
    expect(screen.getByRole('button', { name: 'Neue Buchung' })).toBeDisabled();
    await openActions('Fräse');
    expect(screen.getByRole('menuitem', { name: 'Buchung wiederholen' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Stornieren' })).toBeDisabled();
  });

  it('refreshes from the shared store after an SSE-style update', () => {
    render(<MyBookingsModal />);
    fireEvent.click(screen.getByRole('tab', { name: 'Geplant 0' }));
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
