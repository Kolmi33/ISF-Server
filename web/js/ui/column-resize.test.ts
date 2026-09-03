// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { initColumnResize } from './column-resize.ts';

function mousedown(target: Element, clientX: number): void {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX }));
}
function mousemove(clientX: number): void {
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX }));
}
function mouseup(): void {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty('--machw');
  document.body.innerHTML = '<span id="colResize"></span><span id="elsewhere"></span>';
});

describe('initColumnResize', () => {
  // What: a previously-saved column width is applied to the CSS variable right at init, so
  // the grid renders at the user's remembered width from the first paint.
  // How: seeds localStorage with a saved width, initializes, and checks the CSS variable.
  it('applies a previously-saved width at init', () => {
    localStorage.setItem('mb_machw', '300px');
    initColumnResize();
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('300px');
  });

  // What: with nothing saved, init leaves the CSS variable alone (so the stylesheet's own
  // default takes effect) rather than writing a default value itself.
  // How: initializes against empty localStorage and checks the CSS variable is still unset.
  it('does not touch --machw at init when nothing was saved', () => {
    initColumnResize();
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('');
  });

  // What: dragging the resize handle updates the column width live as the mouse moves, and
  // the delta is clamped to the [110, 560]px range regardless of how far the mouse travels.
  // How: starts a drag, moves +50px (checks the width tracks it from the 230px default base),
  // then moves way past both the low and high clamp bounds and checks each clamps correctly.
  it('dragging from #colResize resizes --machw live, clamped to [110, 560]', () => {
    initColumnResize();
    mousedown(document.getElementById('colResize')!, 100);
    mousemove(150); // +50 from the default 230 base
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('280px');
    mousemove(-500); // way past the low clamp
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('110px');
    mousemove(1000); // way past the high clamp
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('560px');
  });

  // What: a drag starts from whatever the CURRENT --machw value is, not always the 230px
  // hardcoded default — so resizing twice in a row compounds correctly.
  // How: pre-sets --machw to 300px, drags +10px, and checks the result is 310px (not 240px,
  // which would be the wrong result if the drag ignored the pre-set value).
  it('starts from the current --machw, not always 230', () => {
    document.documentElement.style.setProperty('--machw', '300px');
    initColumnResize();
    mousedown(document.getElementById('colResize')!, 100);
    mousemove(110); // +10
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('310px');
  });

  // What: the final width reached during a drag is persisted to localStorage once the drag
  // ends (mouseup), so it survives a reload.
  // How: drags to a new width, releases the mouse, and checks localStorage holds that width.
  it('persists the final width to localStorage on mouseup', () => {
    initColumnResize();
    mousedown(document.getElementById('colResize')!, 100);
    mousemove(150);
    mouseup();
    expect(localStorage.getItem('mb_machw')).toBe('280px');
  });

  // What: a mousedown on some other element (not the resize handle) never starts a drag —
  // subsequent mouse movement has no effect on the column width.
  // How: fires mousedown on an unrelated element, then a mousemove, and checks the width
  // never changed from its unset default.
  it('a mousedown elsewhere does not start a drag', () => {
    initColumnResize();
    mousedown(document.getElementById('elsewhere')!, 100);
    mousemove(150);
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('');
  });

  // What: mousemove and mouseup events with no drag currently in progress are safe no-ops,
  // not errors.
  // How: fires both events with no prior mousedown and checks nothing throws and nothing
  // was persisted.
  it('mousemove/mouseup without an active drag are no-ops', () => {
    initColumnResize();
    expect(() => {
      mousemove(150);
      mouseup();
    }).not.toThrow();
    expect(localStorage.getItem('mb_machw')).toBeNull();
  });

  // What: after a drag completes (mouseup), a stray mousemove that follows doesn't keep
  // resizing — each drag is a fresh, self-contained gesture with no leftover state.
  // How: completes one drag ending at 280px, then fires another mousemove with no new
  // mousedown, and checks the width stayed at 280px rather than moving further.
  it('a second drag after mouseup starts fresh (no stale state)', () => {
    initColumnResize();
    mousedown(document.getElementById('colResize')!, 100);
    mousemove(150);
    mouseup();
    mousemove(500); // no drag active — must not move --machw further
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('280px');
  });
});
