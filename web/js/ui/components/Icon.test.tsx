// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Icon } from './Icon.tsx';

describe('Icon', () => {
  // What: a known name renders its mapped Tabler icon, carrying the .ic class every existing
  // app.css sizing/color rule (base + context-scoped overrides) is keyed on.
  // How: renders a couple of real call-site names and checks each produces an <svg class="ic">.
  it('renders the mapped Tabler icon with the .ic class for a known name', () => {
    const { container: compassContainer } = render(<Icon name="compass" />);
    expect(compassContainer.querySelector('svg.ic')).toBeInTheDocument();

    const { container: trashContainer } = render(<Icon name="trash" />);
    expect(trashContainer.querySelector('svg.ic')).toBeInTheDocument();
  });

  // What: the rendered svg is hidden from assistive tech (aria-hidden), matching the
  // sprite-based version this replaces — icons here are always decorative, next to real text.
  // How: renders a known icon and checks aria-hidden="true" on the svg.
  it('marks the icon aria-hidden', () => {
    const { container } = render(<Icon name="info" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  // What: an unmapped name renders nothing rather than throwing — defensive, since `name` is a
  // plain string some call sites compute at runtime (e.g. a category's icon field).
  // How: renders with a name not in the map and checks the container is empty.
  it('renders nothing for an unmapped name', () => {
    const { container } = render(<Icon name="not-a-real-icon" />);
    expect(container).toBeEmptyDOMElement();
  });
});
