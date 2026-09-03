// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';
import { MachineFilterDropdown, saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

const m1 = machine();
const m2 = machine({ id: 'm2', name: 'Presse', group: 'Halle 2' });
const meas = machine({ id: 'm3', name: 'Messgerät', group: 'Labor', cat: 'messtechnik' });

// window.S is kept aliased to store.state so the component (migrated onto the real store) and
// this test agree; window.notify forwards to store.notify() exactly as app.ts does in
// production, so notifySpy sees every repaint trigger.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  document.body.innerHTML = `<button id="machBtn">Filtern ▾</button><div id="machDrop"></div>`;
  store.set({
    data: { machines: [m1, m2, meas], bookings: {} },
    favs: new Set(),
    machSel: new Set(),
    groupsSel: new Set(),
  } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
  window.notify = () => store.notify();
  localStorage.clear();
  render(<MachineFilterDropdown />, { container: document.getElementById('machDrop')! });
});

function openDropdown(): void {
  act(() => fireEvent.click(document.getElementById('machBtn')!));
}

function catHeader(): Element {
  return document.querySelector('.mlist .cathead')!;
}

describe('MachineFilterDropdown', () => {
  // What: the dropdown starts closed by default.
  // How: checks the open class isn't present right after render.
  it('is closed by default', () => {
    expect(document.getElementById('machDrop')!.classList.contains('open')).toBe(false);
  });

  // What: opening the dropdown shows the category header(s) but no machines yet — the tree
  // starts fully folded (down to just favorites, of which there are none here).
  // How: opens the dropdown and checks the Maschinen category header is present while a
  // specific machine name is not yet shown.
  it('opens on the toolbar button click, tree folded to just favorites (none here)', () => {
    openDropdown();
    expect(document.getElementById('machDrop')!.classList.contains('open')).toBe(true);
    expect(catHeader().textContent).toContain('Maschinen');
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument();
  });

  // What: the tree unfolds progressively — opening a category reveals its group headers, and
  // opening one of those groups reveals its individual machine checkboxes.
  // How: opens the dropdown, clicks the category header (reveals the group header), then
  // clicks the group header (reveals the machine checkbox).
  it('opening a category shows its groups; opening a group shows its machines', () => {
    openDropdown();
    act(() => fireEvent.click(catHeader()));
    const groupHeader = document.querySelector('.mlist .grpsub')!;
    expect(groupHeader.textContent).toContain('Halle 1');
    act(() => fireEvent.click(groupHeader));
    expect(screen.getByRole('checkbox', { name: 'Fräse' })).toBeInTheDocument();
  });

  // What: checking a machine's box adds it to the machine filter set, persists it, repaints,
  // and updates the toolbar button to show the selection count.
  // How: drills down to a machine checkbox, checks it, and verifies the store, localStorage,
  // notify, and button text all reflect the selection.
  it('checking a machine adds it to S.machSel, persists, notifies, and updates the toolbar button', () => {
    openDropdown();
    act(() => fireEvent.click(catHeader()));
    act(() => fireEvent.click(document.querySelector('.mlist .grpsub')!));
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Fräse' })));
    expect(window.S.machSel.has('m1')).toBe(true);
    expect(JSON.parse(localStorage.getItem('mb_machsel')!)).toEqual(['m1']);
    expect(notifySpy).toHaveBeenCalled();
    expect(document.getElementById('machBtn')!.textContent).toContain('1 gewählt');
  });

  // What: the "Filter löschen" (clear filter) button empties the selection and resets the
  // toolbar button back to its unfiltered label.
  // How: seeds a selection, opens the dropdown, clicks the clear button, and checks both the
  // store and the button text reset.
  it('"Filter löschen" clears the selection and resets the toolbar button', () => {
    window.S.machSel = new Set(['m1']);
    updateMachBtn();
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('button', { name: /Filter löschen/ })));
    expect(window.S.machSel.size).toBe(0);
    expect(document.getElementById('machBtn')!.textContent).toContain('Filtern ▾');
  });

  // What: the show/hide toggle for a whole category section (distinct from the machine
  // selection filter) removes that category's section from the list entirely — and this is
  // purely a local dropdown-UI concern, so it doesn't trigger the store's notify/repaint.
  // How: clicks the "Messtechnik" category-shown toggle and checks only the "Maschinen"
  // category header remains, with notify never called.
  it('the category-shown toggle hides a whole category section without calling notify', () => {
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('button', { name: /Messtechnik/ })));
    expect(document.querySelectorAll('.mlist .cathead')).toHaveLength(1); // only "Maschinen" left
    expect(notifySpy).not.toHaveBeenCalled();
  });

  // What: typing in the search box switches the list to a flat set of matches, with no
  // category/group headers at all — search bypasses the fold hierarchy entirely.
  // How: types a machine name into the search box and checks the matching machine appears
  // while no category headers remain.
  it('typing in the search box shows a flat, header-free list of matches', () => {
    openDropdown();
    fireEvent.change(screen.getByPlaceholderText('Ressource suchen…'), {
      target: { value: 'Presse' },
    });
    expect(screen.getByRole('checkbox', { name: 'Presse' })).toBeInTheDocument();
    expect(document.querySelectorAll('.mlist .cathead')).toHaveLength(0);
  });

  // What: closing and re-opening the dropdown resets its transient local UI state (fold
  // state, category-shown toggles, search text) back to defaults — none of that carries over
  // between separate open sessions.
  // How: opens, unfolds a category, types a search query, closes, re-opens, and checks the
  // search box is empty again and the previously-unfolded group is folded again.
  it('re-opening resets fold state, category-shown toggles, and the search box', () => {
    openDropdown();
    act(() => fireEvent.click(catHeader()));
    fireEvent.change(screen.getByPlaceholderText('Ressource suchen…'), {
      target: { value: 'Presse' },
    });
    act(() => fireEvent.click(document.getElementById('machBtn')!)); // close
    openDropdown(); // re-open
    expect((screen.getByPlaceholderText('Ressource suchen…') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument(); // "Halle 1" folded again
  });

  // What: clicking anywhere outside the open dropdown closes it.
  // How: opens the dropdown, mousedowns an unrelated element, and checks the open class is gone.
  it('an outside click closes the dropdown', () => {
    document.body.innerHTML += '<div id="elsewhere"></div>';
    openDropdown();
    act(() => fireEvent.mouseDown(document.getElementById('elsewhere')!));
    expect(document.getElementById('machDrop')!.classList.contains('open')).toBe(false);
  });
});

describe('saveFilters', () => {
  // What: saveFilters persists BOTH the machine-id and group-name filter sets in one call.
  // How: sets both filter sets on the store, calls saveFilters(), and checks both localStorage keys.
  it('persists both the machine and group selections', () => {
    window.S.machSel = new Set(['m1']);
    window.S.groupsSel = new Set(['Halle 2']);
    saveFilters();
    expect(JSON.parse(localStorage.getItem('mb_machsel')!)).toEqual(['m1']);
    expect(JSON.parse(localStorage.getItem('mb_groupssel')!)).toEqual(['Halle 2']);
  });
});

describe('updateMachBtn', () => {
  // What: with machines selected, the toolbar button shows the count and gets a highlighted
  // background so the active filter is visually obvious.
  // How: seeds a 2-machine selection, calls updateMachBtn(), and checks the button's text and
  // background style.
  it('shows the count and highlights when machines are selected', () => {
    window.S.machSel = new Set(['m1', 'm2']);
    updateMachBtn();
    const button = document.getElementById('machBtn')!;
    expect(button.textContent).toContain('2 gewählt');
    expect(button.style.background).toBe('var(--accent-light)');
  });

  // What: with nothing selected, the button shows its default label and no highlight.
  // How: calls updateMachBtn() with an empty selection and checks the button's text/background.
  it('shows "Filtern ▾" with no highlight when nothing is selected', () => {
    updateMachBtn();
    const button = document.getElementById('machBtn')!;
    expect(button.textContent).toContain('Filtern ▾');
    expect(button.style.background).toBe('');
  });

  // What: calling updateMachBtn when the button element isn't in the DOM is a safe no-op.
  // How: removes the button element and checks calling updateMachBtn() doesn't throw.
  it('does nothing when #machBtn is absent', () => {
    document.getElementById('machBtn')!.remove();
    expect(() => updateMachBtn()).not.toThrow();
  });
});
