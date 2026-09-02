import { describe, it, expect } from 'vitest';
import { pickString, logOrDefault } from './api-write-helpers.ts';

describe('pickString', () => {
  it('passes through a non-empty string', () => {
    expect(pickString('anna')).toBe('anna');
  });

  it('is undefined for an empty string, or any non-string value', () => {
    expect(pickString('')).toBeUndefined();
    expect(pickString(undefined)).toBeUndefined();
    expect(pickString(null)).toBeUndefined();
    expect(pickString(42)).toBeUndefined();
  });
});

describe('logOrDefault', () => {
  it('uses the given log when it is a non-empty string', () => {
    expect(logOrDefault('custom', 'fallback')).toBe('custom');
  });

  it('falls back for an empty string or a non-string value', () => {
    expect(logOrDefault('', 'fallback')).toBe('fallback');
    expect(logOrDefault(undefined, 'fallback')).toBe('fallback');
    expect(logOrDefault(42, 'fallback')).toBe('fallback');
  });
});
