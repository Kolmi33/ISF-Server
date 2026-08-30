// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { HelpModal, openHelp } from './HelpModal.tsx';

describe('HelpModal', () => {
  it('renders the legend headings and the close button', () => {
    render(<HelpModal />);
    expect(screen.getByText('Legende & Bedienung')).toBeInTheDocument();
    expect(screen.getByText('Farben & Markierungen im Raster')).toBeInTheDocument();
    expect(screen.getByText('Buchungsassistent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alles klar' })).toBeInTheDocument();
  });
});

describe('openHelp', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="overlay"><div id="modal" tabindex="-1"></div></div>
      <div id="modalReopen"></div>`;
  });

  it('mounts the modal into #modal and opens the overlay', () => {
    act(() => openHelp());
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
    expect(screen.getByText('Legende & Bedienung')).toBeInTheDocument();
  });

  it('the close button closes the modal', () => {
    act(() => openHelp());
    act(() => screen.getByRole('button', { name: 'Alles klar' }).click());
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});
