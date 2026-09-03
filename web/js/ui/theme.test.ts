// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyTheme, isDarkTheme } from './theme.ts';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => vi.unstubAllGlobals());

describe('applyTheme', () => {
  // What: an explicit "dark" preference wins regardless of what the OS itself prefers.
  // How: stores "dark" and stubs the OS preference as light (matches:false), then checks the
  // applied theme is still dark.
  it('applies "dark" explicitly, regardless of the OS preference', () => {
    localStorage.setItem('mb_theme', 'dark');
    stubMatchMedia(false);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  // What: an explicit "light" preference wins regardless of what the OS itself prefers.
  // How: stores "light" and stubs the OS preference as dark (matches:true), then checks the
  // applied theme is still light.
  it('applies "light" explicitly, regardless of the OS preference', () => {
    localStorage.setItem('mb_theme', 'light');
    stubMatchMedia(true);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  // What: the "auto" setting defers to the OS preference, applying dark when the OS prefers dark.
  // How: stores "auto" and stubs matchMedia to report a dark preference, checking dark is applied.
  it('"auto" follows a dark OS preference', () => {
    localStorage.setItem('mb_theme', 'auto');
    stubMatchMedia(true);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  // What: the "auto" setting also defers to a light OS preference.
  // How: stores "auto" and stubs matchMedia to report a light preference, checking light is applied.
  it('"auto" follows a light OS preference', () => {
    localStorage.setItem('mb_theme', 'auto');
    stubMatchMedia(false);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  // What: with nothing stored at all, the theme defaults to "auto" behavior (following the OS).
  // How: leaves localStorage empty, stubs a dark OS preference, and checks dark is applied
  // (proving the missing-preference case falls through to the same OS-following logic as "auto").
  it('defaults to "auto" when no preference is stored', () => {
    stubMatchMedia(true);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('isDarkTheme', () => {
  // What: isDarkTheme reads back exactly what applyTheme wrote to the DOM — the read side of
  // that write, not a separate computation of its own.
  // How: applies dark then light via applyTheme and checks isDarkTheme agrees each time.
  it('reflects whatever applyTheme last applied', () => {
    localStorage.setItem('mb_theme', 'dark');
    applyTheme();
    expect(isDarkTheme()).toBe(true);

    localStorage.setItem('mb_theme', 'light');
    applyTheme();
    expect(isDarkTheme()).toBe(false);
  });

  // What: with no theme attribute set at all (before the first applyTheme call), isDarkTheme
  // reads as light — never throws on the missing attribute.
  // How: checks isDarkTheme with a completely bare <html> element.
  it('is false when no theme attribute is set yet', () => {
    expect(isDarkTheme()).toBe(false);
  });
});
