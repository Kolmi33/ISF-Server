// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from './input.tsx';

describe('Input', () => {
  // What: with no className, the default border/background/text styling classes apply.
  // How: renders a plain Input and checks its className carries the marker classes.
  it('renders with the default styling classes', () => {
    render(<Input placeholder="filtern…" />);
    const input = screen.getByPlaceholderText('filtern…');
    expect(input.className).toContain('bg-panel');
    expect(input.className).toContain('border-border');
  });

  // What: since web/css/tailwind.css deliberately skips Tailwind's global Preflight reset
  // (a document-wide reset is wrong for a stylesheet coexisting with app.css), this component
  // must supply its own box-sizing/appearance resets rather than assume a global one.
  // How: renders a plain Input and checks each own-reset marker class is present.
  it('carries its own box-sizing/appearance resets (no global Preflight to rely on)', () => {
    render(<Input placeholder="filtern…" />);
    const input = screen.getByPlaceholderText('filtern…');
    expect(input.className).toContain('box-border');
    expect(input.className).toContain('appearance-none');
  });

  // What: a caller-supplied className is merged in (via cn()), not dropped.
  // How: passes an extra class alongside a placeholder and checks both survive/merge.
  it('merges a caller className with the default styling', () => {
    render(<Input placeholder="Tage" className="asDays" />);
    expect(screen.getByPlaceholderText('Tage').className).toContain('asDays');
  });

  // What: every native <input> prop (type, value, min, max, onChange, style, …) passes
  // through unchanged — this replaces styling only, never input behavior.
  // How: renders a number input with a full set of native props and checks each one landed.
  it('passes native input attributes through unchanged', () => {
    render(
      <Input
        type="number"
        value={3}
        min={1}
        max={30}
        style={{ width: 70 }}
        onChange={() => {}}
        aria-label="Menge"
      />,
    );
    const input = screen.getByRole('spinbutton', { name: 'Menge' }) as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.value).toBe('3');
    expect(input.min).toBe('1');
    expect(input.max).toBe('30');
    expect(input.style.width).toBe('70px');
  });
});
