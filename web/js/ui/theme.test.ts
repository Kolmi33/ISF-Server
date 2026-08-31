// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyTheme } from './theme.ts';

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
  it('applies "dark" explicitly, regardless of the OS preference', () => {
    localStorage.setItem('mb_theme', 'dark');
    stubMatchMedia(false);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies "light" explicitly, regardless of the OS preference', () => {
    localStorage.setItem('mb_theme', 'light');
    stubMatchMedia(true);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('"auto" follows a dark OS preference', () => {
    localStorage.setItem('mb_theme', 'auto');
    stubMatchMedia(true);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('"auto" follows a light OS preference', () => {
    localStorage.setItem('mb_theme', 'auto');
    stubMatchMedia(false);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('defaults to "auto" when no preference is stored', () => {
    stubMatchMedia(true);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
