// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { showCollisionBanner, initCollisionBanner } from './collision-banner.ts';

beforeEach(() => {
  document.body.innerHTML = '<div id="collBanner"></div><button id="collOk"></button>';
});

describe('showCollisionBanner', () => {
  // What: showing the banner adds the 'show' class that makes it visible.
  // How: calls showCollisionBanner() against a stub DOM and checks the banner element's class list.
  it('shows the banner', () => {
    showCollisionBanner();
    expect(document.getElementById('collBanner')!.classList.contains('show')).toBe(true);
  });
});

describe('initCollisionBanner', () => {
  // What: the banner is dismissed only by an explicit click on "Verstanden" (its OK button) —
  // wiring it up alone doesn't hide an already-shown banner (persistent, manual-dismiss only).
  // How: shows the banner, wires the dismiss handler, checks the banner is still up (init
  // alone didn't hide it), then clicks the OK button and checks the class is removed.
  it('wires "Verstanden" to dismiss the banner — persistent (manual-dismiss only)', () => {
    showCollisionBanner();
    initCollisionBanner();
    expect(document.getElementById('collBanner')!.classList.contains('show')).toBe(true); // still up
    document.getElementById('collOk')!.click();
    expect(document.getElementById('collBanner')!.classList.contains('show')).toBe(false);
  });
});
