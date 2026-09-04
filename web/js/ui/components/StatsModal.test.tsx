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
  // What: the default view is the "Maschinen" tab, listing only that category's machines with
  // a utilisation metric — Messtechnik's own machine doesn't show until its tab is picked.
  // How: opens stats and checks the Maschinen machine, the "Werktage" label, and that the
  // Messtechnik machine is absent.
  it("defaults to the Maschinen tab, listing only that category's machines", () => {
    act(() => openStats());
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByText(/Werktage/)).toBeInTheDocument();
    expect(screen.queryByText('Messgerät')).not.toBeInTheDocument();
  });

  // What: the category tabs are single-select, top-level tabs (user request), not a
  // multi-select pill row — exactly one is marked selected at a time, and clicking the other
  // one swaps which category's machines show entirely.
  // How: checks the Maschinen tab starts selected, clicks Messtechnik, and checks both the
  // aria-selected state and the visible machine list swapped.
  it("switching tabs shows the other category's machines, single-select", () => {
    act(() => openStats());
    const maschinenTab = screen.getByRole('tab', { name: /Maschinen/ });
    const messtechnikTab = screen.getByRole('tab', { name: /Messtechnik/ });
    expect(maschinenTab.getAttribute('aria-selected')).toBe('true');
    expect(messtechnikTab.getAttribute('aria-selected')).toBe('false');
    act(() => {
      messtechnikTab.click();
    });
    expect(messtechnikTab.getAttribute('aria-selected')).toBe('true');
    expect(maschinenTab.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('Messgerät')).toBeInTheDocument();
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument();
  });

  // What: the overview is wrapped in a category-specific theme class (user request: distinct
  // color themes per category), switching along with the active tab.
  // How: checks the theme class for Maschinen at first, then for Messtechnik after switching.
  it("wraps the overview in the active category's own theme class", () => {
    act(() => openStats());
    expect(document.querySelector('#stOut > .stat-theme-maschine')).toBeInTheDocument();
    act(() => {
      screen.getByRole('tab', { name: /Messtechnik/ }).click();
    });
    expect(document.querySelector('#stOut > .stat-theme-messtechnik')).toBeInTheDocument();
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
  // How: types a partial machine name and checks the matching machine stays.
  it('filters the list by machine name', () => {
    act(() => openStats());
    fireEvent.change(screen.getByPlaceholderText('filtern…'), { target: { value: 'Frä' } });
    expect(screen.getByText('Fräse')).toBeInTheDocument();
  });

  // What: each machine's own utilisation bar is a three-segment stacked bar — booked
  // ("used"), blocked by maintenance, and idle (user request: "a stacked bar chart, e.g. 60%
  // Used, 10% Maintenance, 30% Idle"), not a single traffic-light-colored bar.
  // How: books Fräse 3 of 5 workdays and gives it a 1-day maintenance slot on one of the
  // remaining days, then reads the three segments' own widths.
  it("shows each machine's utilisation as a stacked used/maintenance/idle bar", () => {
    window.S.data!.bookings.m1 = {
      '2021-01-04': { name: 'anna' },
      '2021-01-05': { name: 'anna' },
      '2021-01-06': { name: 'anna' },
    };
    window.S.data!.machines[0]!.maint = [
      { type: 'wartung', from: '2021-01-07', until: '2021-01-07' },
    ]; // exactly 1 workday
    act(() => openStats());
    const fromInput = document.querySelectorAll<HTMLInputElement>('#modal input[type="date"]')[0]!;
    const toInput = document.querySelectorAll<HTMLInputElement>('#modal input[type="date"]')[1]!;
    fireEvent.change(fromInput, { target: { value: '2021-01-04' } });
    fireEvent.change(toInput, { target: { value: '2021-01-08' } }); // Mon-Fri, 5 workdays
    const bar = screen.getByText('Fräse').closest('.statrow')!.querySelector('.statbar')!;
    expect((bar.querySelector('.seg-used') as HTMLElement).style.width).toBe('60%'); // 3/5
    expect((bar.querySelector('.seg-maint') as HTMLElement).style.width).toBe('20%'); // 1/5
    expect((bar.querySelector('.seg-idle') as HTMLElement).style.width).toBe('20%'); // remainder
  });
});

// The dashboard-style KPI/chart card above the resource list (user request: revamp the whole
// tab as a card-based dashboard). Both set the same explicit 5-weekday range (2021-01-04 to
// -08) for precise, hand-checkable numbers, matching the pattern the stacked-bar test above
// already uses.
describe('StatsModal — dashboard summary', () => {
  function setFiveWeekdayRange(): void {
    const [fromInput, toInput] = document.querySelectorAll<HTMLInputElement>(
      '#modal input[type="date"]',
    );
    fireEvent.change(fromInput!, { target: { value: '2021-01-04' } });
    fireEvent.change(toInput!, { target: { value: '2021-01-08' } });
  }

  // Reads one tile's own value by its label — scoped per-tile rather than a bare `getByText`
  // on the value, since two tiles can coincidentally show the same number (e.g. a single-
  // machine category where "Ø Auslastung" and "Meistgenutzt" are numerically identical).
  function tileValue(label: string): string | null {
    return screen
      .getByText(label, { selector: '.stat-kpi-label' })
      .closest('.stat-kpi')!
      .querySelector('.stat-kpi-value')!.textContent;
  }

  // What: the KPI tile row shows the range's weekday count, the category's aggregate
  // utilisation, how many distinct people booked it, and its single most-used machine — for
  // the active (default: Maschinen) category.
  // How: sets the 5-weekday range and checks all four tile values (Fräse: booked 2 of 5 days).
  it('shows Werktage/Ø Auslastung/Aktive Personen/Meistgenutzt tiles for the active category', () => {
    act(() => openStats());
    setFiveWeekdayRange();
    expect(tileValue('Werktage')).toBe('5');
    expect(tileValue('Ø Auslastung')).toBe('40%');
    expect(tileValue('Aktive Personen')).toBe('1'); // just anna
    expect(screen.getByText('Meistgenutzt: Fräse')).toBeInTheDocument();
  });

  // What: switching category tabs recomputes the dashboard for the newly-active category, not
  // just the machine list below it.
  // How: switches to Messtechnik and checks its own tile values (Messgerät: booked 1 of 5 days).
  it('recomputes the dashboard tiles when the category tab switches', () => {
    act(() => openStats());
    setFiveWeekdayRange();
    act(() => {
      screen.getByRole('tab', { name: /Messtechnik/ }).click();
    });
    expect(tileValue('Ø Auslastung')).toBe('20%');
    expect(screen.getByText('Meistgenutzt: Messgerät')).toBeInTheDocument();
  });

  // What: the dashboard card's legend names each segment with its own aggregate percentage,
  // matching the tiles' own "Ø Auslastung" figure for the "used" share.
  // How: checks the three legend labels for the default Maschinen category.
  it('shows the aggregate utilisation legend with matching percentages', () => {
    act(() => openStats());
    setFiveWeekdayRange();
    expect(screen.getByText(/Verwendet 40%/)).toBeInTheDocument();
    expect(screen.getByText(/Wartung 0%/)).toBeInTheDocument();
    expect(screen.getByText(/Frei 60%/)).toBeInTheDocument();
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

  // What: a breadcrumb trail shows the current depth while drilled into a machine (user
  // request: "users should always know their depth within the data") — absent at the
  // top-level overview, where there's no depth to show.
  // How: checks no breadcrumb at the overview, then drills into a machine and checks the trail
  // names the category and the machine.
  it('shows a breadcrumb trail naming the category and machine while drilled in', () => {
    act(() => openStats());
    expect(document.querySelector('.breadcrumb')).not.toBeInTheDocument();
    act(() => {
      screen.getByText('Fräse').click();
    });
    expect(document.querySelector('.breadcrumb')!.textContent).toBe(
      'Statistik / Maschinen / Fräse',
    );
  });
});

// Personen's own mode-switch button is hidden now (StatsControls.tsx — user request, kept not
// deleted), so these tests reach it the same way production code still can: `openStats` with a
// preset person (a booking's "Statistik" button), then that drilldown's own "← Übersicht" back
// button to reach the bare overview list. There's no user-facing way to switch modes any more
// (Wartung is gone, folded into the stacked bar; Personen has no visible tab), so mode is fixed
// for the modal's lifetime — there's nothing left to test there beyond what's covered below.
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

  // What: a breadcrumb trail shows "Personen" plus the drilled-into person's name.
  // How: opens directly into anna's drilldown and checks the trail's text.
  it('shows a breadcrumb trail naming Personen and the person while drilled in', () => {
    act(() => openStats('anna'));
    expect(document.querySelector('.breadcrumb')!.textContent).toBe('Statistik / Personen / anna');
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
