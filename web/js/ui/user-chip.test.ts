// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { AppState } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';
import { setPresence, updateUserChip } from './user-chip.ts';

beforeEach(() => {
  document.body.innerHTML = '<button id="userChip"></button>';
  store.set({ user: 'anna' } as unknown as Partial<AppState>);
  window.S = store.state;
});

describe('updateUserChip', () => {
  // What: rendering the chip includes the presence badge, a user icon, and the current
  // user's name.
  // How: renders the chip and checks the badge element exists, the icon's href points at the
  // user icon symbol, and the name appears in the text content.
  it('renders the presence badge, the user icon, and the current name', () => {
    updateUserChip();
    const chip = document.getElementById('userChip')!;
    expect(chip.querySelector('#presBadge')).toBeInTheDocument();
    expect(chip.querySelector('svg use')?.getAttribute('href')).toBe('#i-user');
    expect(chip.textContent).toContain('anna');
  });

  // What: with no name set, the chip shows a "Name?" placeholder prompting the user to set one.
  // How: clears the store's user field, renders, and checks the placeholder text appears.
  it('shows a placeholder when no name is set', () => {
    window.S.user = '';
    updateUserChip();
    expect(document.getElementById('userChip')!.textContent).toContain('Name?');
  });

  // What: a user name containing HTML-special characters is escaped in the rendered markup
  // (so it can't inject markup) while still reading correctly as plain text.
  // How: sets a name containing an HTML tag, renders, and checks the raw innerHTML does NOT
  // contain the literal tag while the plain textContent DOES show it as text.
  it('escapes a name containing HTML-special characters', () => {
    window.S.user = '<b>x</b>';
    updateUserChip();
    expect(document.getElementById('userChip')!.innerHTML).not.toContain('<b>x</b>');
    expect(document.getElementById('userChip')!.textContent).toContain('<b>x</b>');
  });

  // What: calling updateUserChip when the chip element isn't in the DOM at all doesn't throw
  // — a defensive guard for a render that runs before/without that element.
  // How: clears the whole document body and checks calling updateUserChip() doesn't throw.
  it('does nothing when the chip element is absent', () => {
    document.body.innerHTML = '';
    expect(() => updateUserChip()).not.toThrow();
  });
});

describe('setPresence', () => {
  // What: once the presence badge has been rendered, setPresence updates its count and
  // tooltip in place without re-rendering the whole chip.
  // How: renders the chip once (creating the badge), calls setPresence with a new count/label,
  // and checks the badge's text and title updated.
  it('updates an already-rendered badge in place', () => {
    updateUserChip(); // renders #presBadge with the default label
    setPresence('3', 'Gerade aktiv: anna, bob, carl');
    const badge = document.getElementById('presBadge')!;
    expect(badge.textContent).toBe('3');
    expect(badge.title).toBe('Gerade aktiv: anna, bob, carl');
  });

  // What: calling setPresence before the badge has ever been rendered is a safe no-op, not a throw.
  // How: empties the chip's contents (no badge present) and checks calling setPresence doesn't throw.
  it('is a no-op (not a throw) when the badge has not been rendered yet', () => {
    document.getElementById('userChip')!.innerHTML = '';
    expect(() => setPresence('1', 'x')).not.toThrow();
  });

  // What: a presence value set BEFORE the chip has ever been rendered is still applied once
  // updateUserChip() does its first full rebuild — the label isn't lost just because it
  // arrived before the chip existed.
  // How: calls setPresence first (no badge exists yet, silently absorbed), then calls
  // updateUserChip() to build the chip from scratch, and checks the badge shows the
  // previously-set count rather than the default.
  it('a subsequent updateUserChip() rebuild carries the last-set presence label forward', () => {
    setPresence('2', 'Gerade aktiv: anna, bob');
    updateUserChip(); // rebuilds #userChip from scratch — must not drop the label set above
    expect(document.getElementById('presBadge')!.textContent).toBe('2');
  });
});
