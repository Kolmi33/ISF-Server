// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { AppState } from '../../../shared/types.ts';
import { setPresence, updateUserChip, setPres } from './user-chip.ts';

beforeEach(() => {
  document.body.innerHTML = '<button id="userChip"></button>';
  window.S = { user: 'anna' } as unknown as AppState;
});

describe('updateUserChip', () => {
  it('renders the presence badge, the user icon, and the current name', () => {
    updateUserChip();
    const chip = document.getElementById('userChip')!;
    expect(chip.querySelector('#presBadge')).toBeInTheDocument();
    expect(chip.querySelector('svg use')?.getAttribute('href')).toBe('#i-user');
    expect(chip.textContent).toContain('anna');
  });

  it('shows a placeholder when no name is set', () => {
    window.S.user = '';
    updateUserChip();
    expect(document.getElementById('userChip')!.textContent).toContain('Name?');
  });

  it('escapes a name containing HTML-special characters', () => {
    window.S.user = '<b>x</b>';
    updateUserChip();
    expect(document.getElementById('userChip')!.innerHTML).not.toContain('<b>x</b>');
    expect(document.getElementById('userChip')!.textContent).toContain('<b>x</b>');
  });

  it('does nothing when the chip element is absent', () => {
    document.body.innerHTML = '';
    expect(() => updateUserChip()).not.toThrow();
  });
});

describe('setPresence', () => {
  it('updates an already-rendered badge in place', () => {
    updateUserChip(); // renders #presBadge with the default label
    setPresence('3', 'Gerade aktiv: anna, bob, carl');
    const badge = document.getElementById('presBadge')!;
    expect(badge.textContent).toBe('3');
    expect(badge.title).toBe('Gerade aktiv: anna, bob, carl');
  });

  it('is a no-op (not a throw) when the badge has not been rendered yet', () => {
    document.getElementById('userChip')!.innerHTML = '';
    expect(() => setPresence('1', 'x')).not.toThrow();
  });

  it('a subsequent updateUserChip() rebuild carries the last-set presence label forward', () => {
    setPresence('2', 'Gerade aktiv: anna, bob');
    updateUserChip(); // rebuilds #userChip from scratch — must not drop the label set above
    expect(document.getElementById('presBadge')!.textContent).toBe('2');
  });

  it('is bridged under its legacy name for the still-unported applyPresence', () => {
    expect(setPres).toBe(setPresence);
  });
});
