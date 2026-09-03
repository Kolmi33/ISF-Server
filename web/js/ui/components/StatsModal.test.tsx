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
  // What: the default view shows one category header per category, each category's machines,
  // and a utilisation (workday) metric per machine.
  // How: opens stats and checks two category headers, both known machine names, and the
  // "Werktage" (workdays) label all appear.
  it('shows a category header per category, groups, and each machine with its utilisation', () => {
    act(() => openStats());
    expect(document.querySelectorAll('#stOut .cathead')).toHaveLength(2);
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByText('Messgerät')).toBeInTheDocument();
    expect(screen.getByText(/Werktage/)).toBeInTheDocument();
  });

  // What: toggling a category's visibility off removes its machines from the list entirely,
  // leaving the other category's machines untouched.
  // How: clicks the Messtechnik toggle and checks its machine disappears while Maschinen's stays.
  it('hiding a category via the toggle button removes its machines from the list', () => {
    act(() => openStats());
    act(() => {
      screen.getByRole('button', { name: /Messtechnik/ }).click();
    });
    expect(screen.queryByText('Messgerät')).not.toBeInTheDocument();
    expect(screen.getByText('Fräse')).toBeInTheDocument();
  });

  // What: folding a group hides its machine rows but keeps the group's own header visible
  // (so it can be unfolded again).
  // How: clicks a group header and checks its machine disappears while the header itself stays.
  it('folding a group hides its machine rows but keeps the group header', () => {
    act(() => openStats());
    act(() => {
      screen.getByText(/Halle 1/).click();
    });
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument();
    expect(screen.getByText(/Halle 1/)).toBeInTheDocument(); // header stays
  });

  // What: the filter box narrows the resource list to machines whose name matches the query.
  // How: types a partial machine name and checks the matching machine stays while the other disappears.
  it('filters the list by machine name', () => {
    act(() => openStats());
    fireEvent.change(screen.getByPlaceholderText('filtern…'), { target: { value: 'Frä' } });
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.queryByText('Messgerät')).not.toBeInTheDocument();
  });
});

describe('StatsModal — Ressourcen drilldown', () => {
  // What: clicking a machine row drills into who booked it, and a back button returns to the
  // overview list.
  // How: clicks a machine row, checks the drilldown heading and a booker's name appear, then
  // clicks back and checks the drilldown is gone while the overview list is back.
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

// Personen's own mode-switch button is hidden now (StatsControls.tsx — user request, kept not
// deleted), so these tests reach it the same two ways production code still can: `openStats`
// with a preset person (a booking's "Statistik" button), then that drilldown's own "←
// Übersicht" back button to reach the bare overview list.
describe('StatsModal — Personen mode', () => {
  // What: Personen mode lists every person with at least one booking in range, and clicking
  // a person drills into which machines they used.
  // How: opens directly into anna's drilldown (the preset-person entry point), backs out to
  // the overview, checks both bookers appear, clicks one, and checks the drilldown heading and
  // that machine's name appear.
  it('lists everyone with a booking in range; clicking a row drills into their machines', () => {
    act(() => openStats('anna'));
    act(() => {
      screen.getByRole('button', { name: '← Übersicht' }).click();
    });
    expect(screen.getByText('anna')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    act(() => {
      screen.getByText('anna').click();
    });
    expect(screen.getByText('Meistgenutzte Maschinen', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Fräse')).toBeInTheDocument();
  });

  // What: switching modes (e.g. Ressourcen → Wartung) clears any active drilldown and filter
  // — modes don't share drilldown state. (Originally written against Ressourcen → Personen;
  // adapted to Wartung since Personen's own tab button is now hidden — `onModeChange` resets
  // the same way regardless of which mode it switches to, so this still pins the invariant.)
  it('switching modes resets the filter and any drilldown', () => {
    act(() => openStats());
    act(() => {
      screen.getByText('Fräse').click(); // drill into the machine
    });
    act(() => {
      screen.getByRole('button', { name: /Wartung/ }).click();
    });
    expect(screen.queryByText('Am meisten belegt von', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText(/Keine Wartungs-\/Ausfallzeiten/)).toBeInTheDocument();
  });
});

describe('StatsModal — Wartung mode', () => {
  // What: with nothing blocked in the current date range, Wartung (maintenance) mode shows an
  // explanatory empty-state message.
  // How: switches to Wartung mode (no maintenance seeded) and checks the message appears.
  it('shows a message when nothing is blocked in range', () => {
    act(() => openStats());
    act(() => {
      screen.getByRole('button', { name: /Wartung/ }).click();
    });
    expect(screen.getByText(/Keine Wartungs-\/Ausfallzeiten/)).toBeInTheDocument();
  });

  // What: Wartung mode shows, per machine, both the count of maintenance instances and the
  // total blocked-day count in range.
  // How: gives one machine a 2-day maintenance slot within range, switches to Wartung mode,
  // and checks the summary paragraph mentions 1 instance and 2 blocked days, with the machine
  // name shown too.
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
  // What: setting "Bis" (to) before "Von" (from) is rejected — the modal toasts about the
  // invalid range and keeps showing whatever result was last valid, rather than clearing to
  // an empty/broken state.
  // How: sets the "to" date field to a date before the current "from", and checks the toast
  // plus that the previously-shown machine is still visible.
  it('toasts and keeps the previous result when "Bis" is set before "Von"', () => {
    act(() => openStats());
    const toInput = document.querySelectorAll('#modal input[type="date"]')[1] as HTMLInputElement;
    fireEvent.change(toInput, { target: { value: '2020-01-01' } });
    expect(document.getElementById('toast')!.textContent).toMatch(/gültigen Zeitraum/);
    expect(screen.getByText('Fräse')).toBeInTheDocument(); // still showing the last valid result
  });
});

describe('openStats', () => {
  // What: passing a preset person key opens stats directly into that person's drilldown
  // (e.g. from a booking detail's "Statistik" button) rather than the default overview.
  // How: calls openStats('anna') and checks the drilldown heading and a machine that person
  // used both appear immediately.
  it("opens directly into a person's drilldown when given a preset person key", () => {
    act(() => openStats('anna'));
    expect(screen.getByText('Meistgenutzte Maschinen', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Fräse')).toBeInTheDocument();
  });

  // What: the "Schließen" (close) button closes the shared overlay.
  // How: opens the modal, clicks close, and checks the overlay's open class is gone.
  it('closes on "Schließen"', () => {
    act(() => openStats());
    act(() => {
      screen.getByRole('button', { name: 'Schließen' }).click();
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });

  // What: opening stats before any server data has loaded doesn't open a broken/empty modal
  // — it toasts an explanatory message instead.
  // How: sets S.data to null and checks the overlay stays closed while a toast explains why.
  it('toasts instead of opening when data has not loaded yet', () => {
    store.set({ data: null } as unknown as Partial<AppState>);
    act(() => openStats());
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toContain('Noch keine Daten geladen');
  });
});
