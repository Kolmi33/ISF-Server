import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escape-html.ts';

describe('escapeHtml', () => {
  it('escapes every HTML-special character', () => {
    expect(escapeHtml(`<b>&"'</b>`)).toBe('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  });

  it('leaves ordinary text unchanged', () => {
    expect(escapeHtml('Kolmanovskyi')).toBe('Kolmanovskyi');
  });

  it('is a no-op on an empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
