import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escape-html.ts';

describe('escapeHtml', () => {
  // What: every HTML-special character (<, >, &, ", ') is replaced with its entity form.
  // How: escapes a string containing all five special characters and checks the exact output.
  it('escapes every HTML-special character', () => {
    expect(escapeHtml(`<b>&"'</b>`)).toBe('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  });

  // What: text with no HTML-special characters passes through completely unchanged.
  // How: escapes a plain name and checks it's returned identically.
  it('leaves ordinary text unchanged', () => {
    expect(escapeHtml('Kolmanovskyi')).toBe('Kolmanovskyi');
  });

  // What: an empty string escapes to an empty string, not an error or undefined.
  // How: calls escapeHtml('') and checks the result is also ''.
  it('is a no-op on an empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
