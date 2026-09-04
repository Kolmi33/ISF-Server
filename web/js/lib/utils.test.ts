import { describe, it, expect } from 'vitest';
import { cn } from './utils.ts';

describe('cn', () => {
  // What: plain string arguments are joined with a single space, falsy ones dropped.
  // How: mixes strings with a false/undefined/null value and checks the joined result.
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('a', false, 'b', undefined, null, 'c')).toBe('a b c');
  });

  // What: a later conflicting Tailwind utility wins over an earlier one for the same
  // property, rather than both appearing (which would leave the outcome to CSS source
  // order instead of argument order).
  // How: passes two conflicting background-color utilities and checks only the last survives.
  it('resolves conflicting Tailwind utilities in favor of the later one', () => {
    expect(cn('bg-panel', 'bg-danger')).toBe('bg-danger');
  });

  // What: a caller-supplied override (typically passed last, e.g. a component's own
  // className prop) wins over the component's own default classes.
  // How: simulates a component merging its own defaults with a caller override.
  it('lets a later className prop override an earlier default', () => {
    expect(cn('rounded-md border-border', 'border-danger')).toBe('rounded-md border-danger');
  });

  // What: calling with no arguments returns an empty string, not an error or undefined.
  // How: calls cn() with zero arguments and checks the result is ''.
  it('is a no-op with no arguments', () => {
    expect(cn()).toBe('');
  });
});
