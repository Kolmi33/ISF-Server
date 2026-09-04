// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button.tsx';

describe('Button', () => {
  // What: with no variant/size props, the default (bordered, panel-background) styling and
  // default (13px, roomier padding) sizing classes apply.
  // How: renders a plain Button and checks its className carries both defaults' marker classes.
  it('renders the default variant and size when none are given', () => {
    render(<Button>Abbrechen</Button>);
    const button = screen.getByRole('button', { name: 'Abbrechen' });
    expect(button.className).toContain('bg-panel');
    expect(button.className).toContain('text-[13px]');
  });

  // What: since web/css/tailwind.css deliberately skips Tailwind's global Preflight reset
  // (a document-wide reset is wrong for a stylesheet coexisting with app.css), this component
  // must supply its own box-sizing/appearance/font resets rather than assume a global one.
  // How: renders a plain Button and checks each own-reset marker class is present.
  it('carries its own box-sizing/appearance/font resets (no global Preflight to rely on)', () => {
    render(<Button>Abbrechen</Button>);
    const button = screen.getByRole('button', { name: 'Abbrechen' });
    expect(button.className).toContain('box-border');
    expect(button.className).toContain('appearance-none');
    expect(button.className).toContain('font-[inherit]');
  });

  // What: variant="primary" swaps in the accent-filled styling used for the flow's primary
  // action.
  // How: renders with variant="primary" and checks the accent background marker class.
  it('renders the primary variant', () => {
    render(<Button variant="primary">Freie Termine suchen</Button>);
    expect(screen.getByRole('button', { name: 'Freie Termine suchen' }).className).toContain(
      'bg-accent',
    );
  });

  // What: variant="ghost" is transparent/borderless — used for the Assistant's secondary
  // "Abbrechen" action, which app.css used to make transparent via a scoped selector keyed
  // on the literal `.btn` class this component no longer carries.
  // How: renders with variant="ghost" and checks the transparent-background marker class.
  it('renders the ghost variant', () => {
    render(<Button variant="ghost">Abbrechen</Button>);
    expect(screen.getByRole('button', { name: 'Abbrechen' }).className).toContain('bg-transparent');
  });

  // What: size="small" swaps in the tighter padding/font-size used for compact result-row
  // actions (e.g. the pin/"Buchen…" buttons).
  // How: renders with size="small" and checks the compact marker classes.
  it('renders the small size', () => {
    render(<Button size="small">Buchen…</Button>);
    expect(screen.getByRole('button', { name: 'Buchen…' }).className).toContain('text-xs');
  });

  // What: a caller-supplied className is merged in, not dropped or fully replaced — and a
  // conflicting utility on the same property wins over the variant's own default (cn()'s
  // tailwind-merge behavior, exercised through the real component this time).
  // How: passes a conflicting background utility as className and checks it wins.
  it('merges a caller className on top of the variant classes', () => {
    render(
      <Button variant="primary" className="bg-danger">
        Buchen…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Buchen…' });
    const classes = button.className.split(' ');
    expect(classes).toContain('bg-danger');
    // The base (non-hover) bg-accent is what conflicts with bg-danger and gets removed; the
    // separate hover:bg-accent-hover variant class is a different state and correctly stays.
    expect(classes).not.toContain('bg-accent');
  });

  // What: every native <button> prop (type, title, disabled, onClick, …) still passes through
  // untouched — this is a thin wrapper, not a reimplementation.
  // How: passes disabled, a title, and an explicit type, then checks all three landed on the
  // rendered element.
  it('passes native button attributes through unchanged', () => {
    render(
      <Button type="submit" title="Termin anzeigen" disabled>
        Buchen…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Buchen…' }) as HTMLButtonElement;
    expect(button.type).toBe('submit');
    expect(button.title).toBe('Termin anzeigen');
    expect(button.disabled).toBe(true);
  });
});
