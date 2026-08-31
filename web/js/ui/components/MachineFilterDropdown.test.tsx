// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { MachineFilterDropdown, saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

const m1 = machine();
const m2 = machine({ id: 'm2', name: 'Presse', group: 'Halle 2' });
const meas = machine({ id: 'm3', name: 'Messgerät', group: 'Labor', cat: 'messtechnik' });

beforeEach(() => {
  document.body.innerHTML = `<button id="machBtn">Filtern ▾</button><div id="machDrop"></div>`;
  window.S = {
    data: { machines: [m1, m2, meas], bookings: {} },
    favs: new Set(),
    machSel: new Set(),
    groupsSel: new Set(),
  } as unknown as AppState;
  window.notify = vi.fn();
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
  it('is closed by default', () => {
    expect(document.getElementById('machDrop')!.classList.contains('open')).toBe(false);
  });

  it('opens on the toolbar button click, tree folded to just favorites (none here)', () => {
    openDropdown();
    expect(document.getElementById('machDrop')!.classList.contains('open')).toBe(true);
    expect(catHeader().textContent).toContain('Maschinen');
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument();
  });

  it('opening a category shows its groups; opening a group shows its machines', () => {
    openDropdown();
    act(() => fireEvent.click(catHeader()));
    const groupHeader = document.querySelector('.mlist .grpsub')!;
    expect(groupHeader.textContent).toContain('Halle 1');
    act(() => fireEvent.click(groupHeader));
    expect(screen.getByRole('checkbox', { name: 'Fräse' })).toBeInTheDocument();
  });

  it('checking a machine adds it to S.machSel, persists, notifies, and updates the toolbar button', () => {
    openDropdown();
    act(() => fireEvent.click(catHeader()));
    act(() => fireEvent.click(document.querySelector('.mlist .grpsub')!));
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Fräse' })));
    expect(window.S.machSel.has('m1')).toBe(true);
    expect(JSON.parse(localStorage.getItem('mb_machsel')!)).toEqual(['m1']);
    expect(window.notify).toHaveBeenCalled();
    expect(document.getElementById('machBtn')!.textContent).toContain('1 gewählt');
  });

  it('"Filter löschen" clears the selection and resets the toolbar button', () => {
    window.S.machSel = new Set(['m1']);
    updateMachBtn();
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('button', { name: /Filter löschen/ })));
    expect(window.S.machSel.size).toBe(0);
    expect(document.getElementById('machBtn')!.textContent).toContain('Filtern ▾');
  });

  it('the category-shown toggle hides a whole category section without calling notify', () => {
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('button', { name: /Messtechnik/ })));
    expect(document.querySelectorAll('.mlist .cathead')).toHaveLength(1); // only "Maschinen" left
    expect(window.notify).not.toHaveBeenCalled();
  });

  it('typing in the search box shows a flat, header-free list of matches', () => {
    openDropdown();
    fireEvent.change(screen.getByPlaceholderText('Ressource suchen…'), {
      target: { value: 'Presse' },
    });
    expect(screen.getByRole('checkbox', { name: 'Presse' })).toBeInTheDocument();
    expect(document.querySelectorAll('.mlist .cathead')).toHaveLength(0);
  });

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

  it('an outside click closes the dropdown', () => {
    document.body.innerHTML += '<div id="elsewhere"></div>';
    openDropdown();
    act(() => fireEvent.mouseDown(document.getElementById('elsewhere')!));
    expect(document.getElementById('machDrop')!.classList.contains('open')).toBe(false);
  });
});

describe('saveFilters', () => {
  it('persists both the machine and group selections', () => {
    window.S.machSel = new Set(['m1']);
    window.S.groupsSel = new Set(['Halle 2']);
    saveFilters();
    expect(JSON.parse(localStorage.getItem('mb_machsel')!)).toEqual(['m1']);
    expect(JSON.parse(localStorage.getItem('mb_groupssel')!)).toEqual(['Halle 2']);
  });
});

describe('updateMachBtn', () => {
  it('shows the count and highlights when machines are selected', () => {
    window.S.machSel = new Set(['m1', 'm2']);
    updateMachBtn();
    const button = document.getElementById('machBtn')!;
    expect(button.textContent).toContain('2 gewählt');
    expect(button.style.background).toBe('var(--accent-light)');
  });

  it('shows "Filtern ▾" with no highlight when nothing is selected', () => {
    updateMachBtn();
    const button = document.getElementById('machBtn')!;
    expect(button.textContent).toContain('Filtern ▾');
    expect(button.style.background).toBe('');
  });

  it('does nothing when #machBtn is absent', () => {
    document.getElementById('machBtn')!.remove();
    expect(() => updateMachBtn()).not.toThrow();
  });
});
