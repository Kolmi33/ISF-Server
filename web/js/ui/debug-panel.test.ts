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
  // What: dbgOn reads the persisted mb_debug localStorage flag.
  // How: checks it's false by default, then true once the flag is explicitly set to 'on'.
  it('reflects the mb_debug flag', () => {
    expect(dbgOn()).toBe(false);
    localStorage.setItem('mb_debug', 'on');
    expect(dbgOn()).toBe(true);
  });
});

describe('dbg', () => {
  // What: with debug mode off, calling dbg() logs nothing to the panel at all.
  // How: calls dbg() without enabling the flag and checks the log list stays empty.
  it('does nothing when the debug flag is off', () => {
    dbg('info', 'hello');
    expect(document.getElementById('dbgList')!.children).toHaveLength(0);
  });

  // What: with debug mode on, a log call prepends a new row showing its kind and message,
  // with the message HTML-escaped (so a message containing markup can't inject into the panel).
  // How: enables debug, logs a message containing an HTML tag, and checks the row's class,
  // that it shows the "[write]" kind tag, and that the tag appears escaped, not as raw markup.
  it('prepends a row with the kind and message, escaped, when on', () => {
    localStorage.setItem('mb_debug', 'on');
    dbg('write', '<b>x</b>');
    const row = document.getElementById('dbgList')!.firstElementChild!;
    expect(row.className).toBe('dbgrow write');
    expect(row.innerHTML).toContain('[write]');
    expect(row.innerHTML).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(row.innerHTML).not.toContain('<b>x</b>');
  });

  // What: a log kind outside the known set gets no extra CSS class (just the base "dbgrow"),
  // rather than an arbitrary/unstyled class name.
  // How: logs with an unrecognized kind and checks the row's class is the bare base class.
  it('gives no extra class to an unrecognized kind', () => {
    localStorage.setItem('mb_debug', 'on');
    dbg('info', 'hello');
    expect(document.getElementById('dbgList')!.firstElementChild!.className).toBe('dbgrow');
  });

  // What: the log list is capped at 200 rows — older entries are dropped as new ones arrive,
  // and the newest entry is always first (prepended, not appended).
  // How: logs 205 messages and checks exactly 200 remain, with the very last one logged
  // (index 204) still at the front.
  it('caps the list at 200 rows, dropping the oldest', () => {
    localStorage.setItem('mb_debug', 'on');
    for (let i = 0; i < 205; i++) dbg('info', String(i));
    const list = document.getElementById('dbgList')!;
    expect(list.children).toHaveLength(200);
    expect(list.firstElementChild!.innerHTML).toContain('204'); // newest first
  });

  // What: logging when the panel's list element isn't even in the DOM is a safe no-op.
  // How: enables debug, empties the whole document body, and checks dbg() doesn't throw.
  it('is a no-op (not a throw) when #dbgList is absent', () => {
    localStorage.setItem('mb_debug', 'on');
    document.body.innerHTML = '';
    expect(() => dbg('info', 'x')).not.toThrow();
  });
});

describe('applyDebug', () => {
  // What: applying the debug setting while it's on opens the panel and logs an activation
  // line naming the current user.
  // How: enables the flag, calls applyDebug(), and checks the panel's open class and that the
  // activation log line mentions the user.
  it('opens the panel and logs an activation line when on', () => {
    localStorage.setItem('mb_debug', 'on');
    applyDebug();
    expect(document.getElementById('dbgPanel')!.classList.contains('open')).toBe(true);
    expect(document.getElementById('dbgList')!.textContent).toContain('anna');
  });

  // What: applying the debug setting while it's off closes the panel (even if it was
  // previously open) and logs nothing.
  // How: pre-opens the panel manually, calls applyDebug() with the flag unset, and checks the
  // panel closed and the log list is empty.
  it('closes the panel and logs nothing when off', () => {
    document.getElementById('dbgPanel')!.classList.add('open');
    applyDebug();
    expect(document.getElementById('dbgPanel')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('dbgList')!.children).toHaveLength(0);
  });
});

describe('handleError', () => {
  // What: an AbortError (a deliberately-cancelled request, not a real failure) is swallowed
  // entirely — no console noise, no debug log entry — since it's expected, not exceptional.
  // How: enables debug, spies on console.error, calls handleError with an AbortError-shaped
  // object, and checks neither the console spy nor the debug list saw anything.
  it('swallows AbortError entirely — no console.error, no debug log', () => {
    localStorage.setItem('mb_debug', 'on');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleError('ctx', { name: 'AbortError', message: 'aborted' });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(document.getElementById('dbgList')!.children).toHaveLength(0);
    errorSpy.mockRestore();
  });

  // What: a genuine Error is logged both to the browser console (for developer visibility)
  // and to the debug panel (for on-page inspection), tagged with its calling context.
  // How: enables debug, spies on console.error, calls handleError with a real Error, and
  // checks both the console call arguments and the debug panel's text content.
  it('logs to the console and the debug panel for a real error', () => {
    localStorage.setItem('mb_debug', 'on');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleError('ctx', new Error('boom'));
    expect(errorSpy).toHaveBeenCalledWith('[ctx]', expect.any(Error));
    expect(document.getElementById('dbgList')!.textContent).toContain('ctx: boom');
    errorSpy.mockRestore();
  });

  // What: a thrown value that isn't even an Error instance (a plain string, say) is still
  // handled gracefully — stringified into a readable log line rather than crashing.
  // How: calls handleError with a plain string instead of an Error and checks it appears
  // readably in the debug panel.
  it('stringifies a non-Error thrown value', () => {
    localStorage.setItem('mb_debug', 'on');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handleError('ctx', 'plain string');
    expect(document.getElementById('dbgList')!.textContent).toContain('ctx: plain string');
  });
});

describe('initDebugPanel', () => {
  // What: the "Leeren" (clear) button empties the log list.
  // How: logs one entry, wires the panel, clicks the clear button, and checks the list is empty.
  it('"Leeren" clears the list', () => {
    localStorage.setItem('mb_debug', 'on');
    dbg('info', 'x');
    initDebugPanel();
    document.getElementById('dbgClear')!.click();
    expect(document.getElementById('dbgList')!.children).toHaveLength(0);
  });

  // What: the "✕" (close) button turns the debug flag off entirely (persisted) and closes
  // the panel, not just hiding it visually for the current session.
  // How: enables and opens the panel, wires it, clicks close, and checks both the persisted
  // flag flipped to 'off' and the panel's open class was removed.
  it('"✕" turns the debug flag off and closes the panel', () => {
    localStorage.setItem('mb_debug', 'on');
    applyDebug();
    initDebugPanel();
    document.getElementById('dbgClose')!.click();
    expect(localStorage.getItem('mb_debug')).toBe('off');
    expect(document.getElementById('dbgPanel')!.classList.contains('open')).toBe(false);
  });
});
