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
  it('applies a previously-saved width at init', () => {
    localStorage.setItem('mb_machw', '300px');
    initColumnResize();
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('300px');
  });

  it('does not touch --machw at init when nothing was saved', () => {
    initColumnResize();
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('');
  });

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

  it('starts from the current --machw, not always 230', () => {
    document.documentElement.style.setProperty('--machw', '300px');
    initColumnResize();
    mousedown(document.getElementById('colResize')!, 100);
    mousemove(110); // +10
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('310px');
  });

  it('persists the final width to localStorage on mouseup', () => {
    initColumnResize();
    mousedown(document.getElementById('colResize')!, 100);
    mousemove(150);
    mouseup();
    expect(localStorage.getItem('mb_machw')).toBe('280px');
  });

  it('a mousedown elsewhere does not start a drag', () => {
    initColumnResize();
    mousedown(document.getElementById('elsewhere')!, 100);
    mousemove(150);
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('');
  });

  it('mousemove/mouseup without an active drag are no-ops', () => {
    initColumnResize();
    expect(() => {
      mousemove(150);
      mouseup();
    }).not.toThrow();
    expect(localStorage.getItem('mb_machw')).toBeNull();
  });

  it('a second drag after mouseup starts fresh (no stale state)', () => {
    initColumnResize();
    mousedown(document.getElementById('colResize')!, 100);
    mousemove(150);
    mouseup();
    mousemove(500); // no drag active — must not move --machw further
    expect(document.documentElement.style.getPropertyValue('--machw')).toBe('280px');
  });
});
