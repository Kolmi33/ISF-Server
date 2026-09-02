// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppState } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';
import { dbgOn, dbg, applyDebug, handleError, initDebugPanel } from './debug-panel.ts';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="dbgPanel"><div id="dbgList"></div>
      <button id="dbgClear"></button><button id="dbgClose"></button>
    </div>`;
  localStorage.clear();
  store.set({ user: 'anna' } as unknown as Partial<AppState>);
  window.S = store.state;
});

describe('dbgOn', () => {
  it('reflects the mb_debug flag', () => {
    expect(dbgOn()).toBe(false);
    localStorage.setItem('mb_debug', 'on');
    expect(dbgOn()).toBe(true);
  });
});

describe('dbg', () => {
  it('does nothing when the debug flag is off', () => {
    dbg('info', 'hello');
    expect(document.getElementById('dbgList')!.children).toHaveLength(0);
  });

  it('prepends a row with the kind and message, escaped, when on', () => {
    localStorage.setItem('mb_debug', 'on');
    dbg('write', '<b>x</b>');
    const row = document.getElementById('dbgList')!.firstElementChild!;
    expect(row.className).toBe('dbgrow write');
    expect(row.innerHTML).toContain('[write]');
    expect(row.innerHTML).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(row.innerHTML).not.toContain('<b>x</b>');
  });

  it('gives no extra class to an unrecognized kind', () => {
    localStorage.setItem('mb_debug', 'on');
    dbg('info', 'hello');
    expect(document.getElementById('dbgList')!.firstElementChild!.className).toBe('dbgrow');
  });

  it('caps the list at 200 rows, dropping the oldest', () => {
    localStorage.setItem('mb_debug', 'on');
    for (let i = 0; i < 205; i++) dbg('info', String(i));
    const list = document.getElementById('dbgList')!;
    expect(list.children).toHaveLength(200);
    expect(list.firstElementChild!.innerHTML).toContain('204'); // newest first
  });

  it('is a no-op (not a throw) when #dbgList is absent', () => {
    localStorage.setItem('mb_debug', 'on');
    document.body.innerHTML = '';
    expect(() => dbg('info', 'x')).not.toThrow();
  });
});

describe('applyDebug', () => {
  it('opens the panel and logs an activation line when on', () => {
    localStorage.setItem('mb_debug', 'on');
    applyDebug();
    expect(document.getElementById('dbgPanel')!.classList.contains('open')).toBe(true);
    expect(document.getElementById('dbgList')!.textContent).toContain('anna');
  });

  it('closes the panel and logs nothing when off', () => {
    document.getElementById('dbgPanel')!.classList.add('open');
    applyDebug();
    expect(document.getElementById('dbgPanel')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('dbgList')!.children).toHaveLength(0);
  });
});

describe('handleError', () => {
  it('swallows AbortError entirely — no console.error, no debug log', () => {
    localStorage.setItem('mb_debug', 'on');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleError('ctx', { name: 'AbortError', message: 'aborted' });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(document.getElementById('dbgList')!.children).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it('logs to the console and the debug panel for a real error', () => {
    localStorage.setItem('mb_debug', 'on');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleError('ctx', new Error('boom'));
    expect(errorSpy).toHaveBeenCalledWith('[ctx]', expect.any(Error));
    expect(document.getElementById('dbgList')!.textContent).toContain('ctx: boom');
    errorSpy.mockRestore();
  });

  it('stringifies a non-Error thrown value', () => {
    localStorage.setItem('mb_debug', 'on');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handleError('ctx', 'plain string');
    expect(document.getElementById('dbgList')!.textContent).toContain('ctx: plain string');
  });
});

describe('initDebugPanel', () => {
  it('"Leeren" clears the list', () => {
    localStorage.setItem('mb_debug', 'on');
    dbg('info', 'x');
    initDebugPanel();
    document.getElementById('dbgClear')!.click();
    expect(document.getElementById('dbgList')!.children).toHaveLength(0);
  });

  it('"✕" turns the debug flag off and closes the panel', () => {
    localStorage.setItem('mb_debug', 'on');
    applyDebug();
    initDebugPanel();
    document.getElementById('dbgClose')!.click();
    expect(localStorage.getItem('mb_debug')).toBe('off');
    expect(document.getElementById('dbgPanel')!.classList.contains('open')).toBe(false);
  });
});
