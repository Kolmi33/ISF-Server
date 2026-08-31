// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { showCollisionBanner, initCollisionBanner, showCollision } from './collision-banner.ts';

beforeEach(() => {
  document.body.innerHTML = '<div id="collBanner"></div><button id="collOk"></button>';
});

describe('showCollisionBanner', () => {
  it('shows the banner', () => {
    showCollisionBanner();
    expect(document.getElementById('collBanner')!.classList.contains('show')).toBe(true);
  });

  it('is bridged under its legacy name for the still-unported persist()', () => {
    expect(showCollision).toBe(showCollisionBanner);
  });
});

describe('initCollisionBanner', () => {
  it('wires "Verstanden" to dismiss the banner — persistent (manual-dismiss only)', () => {
    showCollisionBanner();
    initCollisionBanner();
    expect(document.getElementById('collBanner')!.classList.contains('show')).toBe(true); // still up
    document.getElementById('collOk')!.click();
    expect(document.getElementById('collBanner')!.classList.contains('show')).toBe(false);
  });
});
