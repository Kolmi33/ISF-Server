// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { HelpModal, openHelp } from './HelpModal.tsx';

describe('HelpModal', () => {
  // What: the modal renders its section headings and its single close button.
  // How: renders the component directly and checks each expected text/button is present.
  it('renders the legend headings and the close button', () => {
    render(<HelpModal />);
    expect(screen.getByText('Legende & Bedienung')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Farben & Markierungen im Raster' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Buchungsassistent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alles klar' })).toBeInTheDocument();
  });
});

describe('openHelp', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="overlay"><div id="modal" tabindex="-1"></div></div>
      <div id="modalReopen"></div>`;
  });

  // What: openHelp mounts the modal component into the shared #modal DOM node and opens the
  // shared overlay chrome.
  // How: calls openHelp() and checks the overlay's open class plus the modal's own content
  // both appear.
  it('mounts the modal into #modal and opens the overlay', () => {
    act(() => openHelp());
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
    expect(screen.getByText('Legende & Bedienung')).toBeInTheDocument();
  });

  // What: clicking the close button closes the shared overlay.
  // How: opens the modal, clicks its close button, and checks the overlay's open class is gone.
  it('the close button closes the modal', () => {
    act(() => openHelp());
    act(() => screen.getByRole('button', { name: 'Alles klar' }).click());
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});
