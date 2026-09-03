import { describe, it, expect } from 'vitest';
import { pickString, logOrDefault } from './api-write-helpers.ts';

describe('pickString', () => {
  // What: a genuine non-empty string passes through unchanged.
  // How: checks a real string value returns itself.
  it('passes through a non-empty string', () => {
    expect(pickString('anna')).toBe('anna');
  });

  // What: an empty string and every non-string value all become undefined — the "no real
  // value given" signal every REST write handler reads for an optional passthrough field.
  // How: checks an empty string, undefined, null, and a number all return undefined.
  it('is undefined for an empty string, or any non-string value', () => {
    expect(pickString('')).toBeUndefined();
    expect(pickString(undefined)).toBeUndefined();
    expect(pickString(null)).toBeUndefined();
    expect(pickString(42)).toBeUndefined();
  });
});

describe('logOrDefault', () => {
  // What: a genuine non-empty log string from the caller is used as-is.
  // How: passes a real log string and checks it's returned unchanged, ignoring the fallback.
  it('uses the given log when it is a non-empty string', () => {
    expect(logOrDefault('custom', 'fallback')).toBe('custom');
  });

  // What: an empty string or any non-string value falls back to the given default message.
  // How: checks an empty string, undefined, and a number all produce the fallback.
  it('falls back for an empty string or a non-string value', () => {
    expect(logOrDefault('', 'fallback')).toBe('fallback');
    expect(logOrDefault(undefined, 'fallback')).toBe('fallback');
    expect(logOrDefault(42, 'fallback')).toBe('fallback');
  });
});
