// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, type RenderResult } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { GroupFilterDropdown, fillGroupSel } from './GroupFilterDropdown.tsx';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

let mounted: RenderResult;

beforeEach(() => {
  document.body.innerHTML = `<button id="groupBtn">Alle Bereiche ▾</button><div id="groupDrop"></div>`;
  window.S = {
    data: { machines: [machine(), machine({ id: 'm2', name: 'Presse', group: 'Halle 2' })] },
    groupsSel: new Set(),
    machSel: new Set(),
    favs: new Set(),
  } as unknown as AppState;
  window.notify = vi.fn();
  localStorage.clear();
  mounted = render(<GroupFilterDropdown />, { container: document.getElementById('groupDrop')! });
});

function openDropdown(): void {
  act(() => fireEvent.click(document.getElementById('groupBtn')!));
}

describe('GroupFilterDropdown', () => {
  it("initializes #groupBtn's label at mount, with nothing selected", () => {
    expect(document.getElementById('groupBtn')!.textContent).toBe('Alle Bereiche ▾');
  });

  it('is closed by default, listing "Alle Bereiche" (checked) plus one row per group once opened', () => {
    expect(document.getElementById('groupDrop')!.classList.contains('open')).toBe(false);
    openDropdown();
    expect(document.getElementById('groupDrop')!.classList.contains('open')).toBe(true);
    expect(screen.getByRole('checkbox', { name: /Alle Bereiche/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Halle 1' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Halle 2' })).toBeInTheDocument();
  });

  it('checking a group adds it to S.groupsSel, persists, notifies, and updates the toolbar button', () => {
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Halle 1' })));
    expect(window.S.groupsSel.has('Halle 1')).toBe(true);
    expect(JSON.parse(localStorage.getItem('mb_groupssel')!)).toEqual(['Halle 1']);
    expect(window.notify).toHaveBeenCalled();
    expect(document.getElementById('groupBtn')!.textContent).toBe('1 Bereich ▾');
  });

  it('pluralizes once more than one group is selected (but not every group — see below)', () => {
    window.S.data!.machines.push(machine({ id: 'm3', name: 'Bohrer', group: 'Halle 3' }));
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Halle 1' })));
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Halle 2' })));
    expect(document.getElementById('groupBtn')!.textContent).toBe('2 Bereiche ▾');
  });

  it('selecting every group collapses back to "all" (matches legacy\'s "all selected = all")', () => {
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Halle 1' })));
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Halle 2' })));
    expect(window.S.groupsSel.size).toBe(0);
    expect(document.getElementById('groupBtn')!.textContent).toBe('Alle Bereiche ▾');
  });

  it('"Alle Bereiche" always resets the selection to none, persists, and notifies', () => {
    window.S.groupsSel = new Set(['Halle 1']);
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: /Alle Bereiche/ })));
    expect(window.S.groupsSel.size).toBe(0);
    expect(window.notify).toHaveBeenCalled();
  });

  it('an outside click closes the dropdown', () => {
    document.body.innerHTML += '<div id="elsewhere"></div>';
    openDropdown();
    act(() => fireEvent.mouseDown(document.getElementById('elsewhere')!));
    expect(document.getElementById('groupDrop')!.classList.contains('open')).toBe(false);
  });

  it('fillGroupSel recomputes the group list — a newly-added group appears on next open', () => {
    openDropdown();
    act(() => {
      window.S.data!.machines.push(machine({ id: 'm3', name: 'Bohrer', group: 'Halle 3' }));
      fillGroupSel();
    });
    expect(screen.getByRole('checkbox', { name: 'Halle 3' })).toBeInTheDocument();
  });

  it('fillGroupSel is a no-op (not a throw) after the dropdown unmounts', () => {
    // MachineFormModal/live-connection.ts call this unconditionally — must survive the
    // (unlikely) case that no instance is currently mounted to receive it.
    act(() => mounted.unmount());
    expect(() => fillGroupSel()).not.toThrow();
  });
});
