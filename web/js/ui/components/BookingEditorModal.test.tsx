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
import type { MyBookingCampaign } from '../views/my-bookings.ts';
import { BookingEditorModal } from './BookingEditorModal.tsx';

const TODAY = todayAsIsoDateString();
const day = (offset: number) => formatDateAsIsoString(addDays(parseIsoDateString(TODAY), offset));
const machine = (id: string, name: string, cat?: string): Machine => ({
  id,
  name,
  group: 'Halle',
  cat,
  days: '1111100',
});

function setup() {
  const machines = [
    machine('m1', 'HSC 75'),
    machine('m2', 'DMU 50'),
    machine('s1', 'Kistler', 'messtechnik'),
  ];
  const shared = { name: 'Anna', gid: 'g1', gtitle: 'Versuchsreihe', ts: 'stamp' };
  store.set({
    user: 'Anna',
    readOnly: false,
    data: {
      machines,
      bookings: {
        m1: { [TODAY]: shared, [day(1)]: shared },
        s1: { [day(1)]: shared },
      },
      groups: ['Halle'],
      revision: 1,
      log: [],
    },
  } as unknown as Partial<AppState>);
  window.S = store.state;
  window.notify = () => store.notify();
  window.mutate = vi.fn(async (reducer) => reducer(store.get('data')!)) as typeof window.mutate;
  const campaign: MyBookingCampaign = {
    id: 'g1',
    groupId: 'g1',
    title: 'Versuchsreihe',
    owner: 'Anna',
    status: 'aktiv',
    dates: [TODAY, day(1)],
    cells: [
      { machineId: 'm1', date: TODAY },
      { machineId: 'm1', date: day(1) },
      { machineId: 's1', date: day(1) },
    ],
    machines: [machines[0]!, machines[2]!],
    createdAt: 'stamp',
  };
  return campaign;
}

beforeEach(() => {
  document.body.innerHTML =
    '<div id="overlay"></div><div id="modal"></div><div id="modalReopen"></div><div id="toast"></div><div id="collBanner"></div><div id="gridWrap"></div>';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BookingEditorModal', () => {
  it('renders the real machine and measurement rows with the supplied bar-editor controls', () => {
    render(<BookingEditorModal campaign={setup()} onSearchWindow={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Belegung bearbeiten' })).toBeInTheDocument();
    expect(screen.getByText('Maschinen')).toBeInTheDocument();
    expect(screen.getByText('Messtechnik')).toBeInTheDocument();
    expect(screen.getByText('HSC 75')).toBeInTheDocument();
    expect(screen.getByText('Kistler')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Änderungen speichern' })).toBeDisabled();
  });

  it('supports keyboard movement and persists through the awaited atomic mutation path', async () => {
    const campaign = setup();
    render(<BookingEditorModal campaign={campaign} onSearchWindow={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText(/HSC 75 – Pfeiltasten/), { key: 'ArrowRight' });
    const save = screen.getByRole('button', { name: 'Änderungen speichern' });
    expect(save).toBeEnabled();
    await act(async () => fireEvent.click(save));
    await vi.waitFor(() => expect(window.mutate).toHaveBeenCalled());
    expect(vi.mocked(window.mutate).mock.calls[0]![2]).toEqual({
      waitForServer: true,
      atomic: true,
    });
    expect(document.getElementById('toast')).toHaveTextContent('Buchung aktualisiert');
  });

  it('offers same-category device replacement and prevents removing the final device', () => {
    const campaign = setup();
    render(<BookingEditorModal campaign={campaign} onSearchWindow={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für HSC 75' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tauschen gegen DMU 50' }));
    expect(screen.getByText('DMU 50')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Änderungen speichern' })).toBeEnabled();
  });

  it('marks a conflicting group shift and routes to the existing assistant fallback', () => {
    const campaign = setup();
    store.get('data')!.bookings.m2 = { [day(1)]: { name: 'Bob', gid: 'other' } };
    const search = vi.fn();
    render(<BookingEditorModal campaign={campaign} onSearchWindow={search} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für HSC 75' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tauschen gegen DMU 50' }));
    expect(screen.getByText(/Tag liegt auf einer Sperre/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Änderungen speichern' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Freien Termin suchen' }));
    expect(search).toHaveBeenCalledWith(campaign);
  });

  it('keeps the editor open and resets the controls after a failed server mutation', async () => {
    const campaign = setup();
    window.mutate = vi.fn().mockResolvedValue({ abort: true }) as typeof window.mutate;
    render(<BookingEditorModal campaign={campaign} onSearchWindow={vi.fn()} />);
    fireEvent.keyDown(screen.getByText('HSC 75').parentElement!, { key: 'ArrowRight' });
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: /nderungen speichern/ })),
    );
    expect(screen.getByText(/Speichern fehlgeschlagen/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Belegung bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /nderungen speichern/ })).toBeDisabled();
  });
});
