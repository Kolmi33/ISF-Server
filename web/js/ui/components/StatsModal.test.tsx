// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';
import { openStats } from './StatsModal.tsx';

const TODAY = '2021-06-15'; // mid-year, so the default "Jan 1..today" range covers early January

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'M1', group: 'Halle 1', ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  document.body.innerHTML =
    '<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div>';
  store.set({
    user: 'anna',
    data: {
      machines: [
        machine({ id: 'm1', name: 'Fräse', group: 'Halle 1' }),
        machine({ id: 'm2', name: 'Messgerät', group: 'Labor', cat: 'messtechnik' }),
      ],
      bookings: {
        m1: { '2021-01-04': { name: 'anna' }, '2021-01-05': { name: 'anna' } },
        m2: { '2021-01-04': { name: 'bob' } },
      },
    },
    favs: new Set(),
  } as unknown as Partial<AppState>);
  window.S = store.state;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StatsModal — Ressourcen overview (default)', () => {
  it('shows a category header per category, groups, and each machine with its utilisation', () => {
    act(() => openStats());
    expect(document.querySelectorAll('#stOut .cathead')).toHaveLength(2);
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByText('Messgerät')).toBeInTheDocument();
    expect(screen.getByText(/Werktage/)).toBeInTheDocument();
  });

  it('hiding a category via the toggle button removes its machines from the list', () => {
    act(() => openStats());
    act(() => {
      screen.getByRole('button', { name: /Messtechnik/ }).click();
    });
    expect(screen.queryByText('Messgerät')).not.toBeInTheDocument();
    expect(screen.getByText('Fräse')).toBeInTheDocument();
  });

  it('folding a group hides its machine rows but keeps the group header', () => {
    act(() => openStats());
    act(() => {
      screen.getByText(/Halle 1/).click();
    });
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument();
    expect(screen.getByText(/Halle 1/)).toBeInTheDocument(); // header stays
  });

  it('filters the list by machine name', () => {
    act(() => openStats());
    fireEvent.change(screen.getByPlaceholderText('filtern…'), { target: { value: 'Frä' } });
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.queryByText('Messgerät')).not.toBeInTheDocument();
  });
});

describe('StatsModal — Ressourcen drilldown', () => {
  it('clicking a machine row shows who booked it, and the back button returns to the overview', () => {
    act(() => openStats());
    act(() => {
      screen.getByText('Fräse').click();
    });
    expect(screen.getByText('Am meisten belegt von', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('anna')).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: '← Übersicht' }).click();
    });
    expect(screen.queryByText('Am meisten belegt von', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText('Fräse')).toBeInTheDocument();
  });
});

describe('StatsModal — Personen mode', () => {
  it('lists everyone with a booking in range; clicking a row drills into their machines', () => {
    act(() => openStats());
    act(() => {
      screen.getByRole('button', { name: /Personen/ }).click();
    });
    expect(screen.getByText('anna')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    act(() => {
      screen.getByText('anna').click();
    });
    expect(screen.getByText('Meistgenutzte Maschinen', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Fräse')).toBeInTheDocument();
  });

  it('switching modes resets the filter and any drilldown', () => {
    act(() => openStats());
    act(() => {
      screen.getByText('Fräse').click(); // drill into the machine
    });
    act(() => {
      screen.getByRole('button', { name: /Personen/ }).click();
    });
    expect(screen.queryByText('Am meisten belegt von', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText('anna')).toBeInTheDocument();
  });
});

describe('StatsModal — Wartung mode', () => {
  it('shows a message when nothing is blocked in range', () => {
    act(() => openStats());
    act(() => {
      screen.getByRole('button', { name: /Wartung/ }).click();
    });
    expect(screen.getByText(/Keine Wartungs-\/Ausfallzeiten/)).toBeInTheDocument();
  });

  it('shows maintenance instance and blocked-day counts per machine', () => {
    window.S.data!.machines[0]!.maint = [
      { type: 'wartung', from: '2021-01-05', until: '2021-01-06' },
    ];
    act(() => openStats());
    act(() => {
      screen.getByRole('button', { name: /Wartung/ }).click();
    });
    // The count and the label sit in separate text nodes (a <b> plus plain text) — read the
    // paragraph's full textContent rather than matching a single node.
    const hint = document.querySelector('#stOut p.hint')!.textContent;
    expect(hint).toContain('1');
    expect(hint).toMatch(/Wartungs-\/Ausfall-Instanz/);
    expect(hint).toMatch(/2.*gesperrte Tage/);
    expect(screen.getByText('Fräse')).toBeInTheDocument();
  });
});

describe('StatsModal — date range', () => {
  it('toasts and keeps the previous result when "Bis" is set before "Von"', () => {
    act(() => openStats());
    const toInput = document.querySelectorAll('#modal input[type="date"]')[1] as HTMLInputElement;
    fireEvent.change(toInput, { target: { value: '2020-01-01' } });
    expect(document.getElementById('toast')!.textContent).toMatch(/gültigen Zeitraum/);
    expect(screen.getByText('Fräse')).toBeInTheDocument(); // still showing the last valid result
  });
});

describe('openStats', () => {
  it("opens directly into a person's drilldown when given a preset person key", () => {
    act(() => openStats('anna'));
    expect(screen.getByText('Meistgenutzte Maschinen', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Fräse')).toBeInTheDocument();
  });

  it('closes on "Schließen"', () => {
    act(() => openStats());
    act(() => {
      screen.getByRole('button', { name: 'Schließen' }).click();
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });

  it('toasts instead of opening when data has not loaded yet', () => {
    store.set({ data: null } as unknown as Partial<AppState>);
    act(() => openStats());
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toContain('Noch keine Daten geladen');
  });
});
