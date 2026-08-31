// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { openReactModal, closeReactModal } from './modal.tsx';

function setDom(): void {
  document.body.innerHTML = `
    <div id="overlay"><div id="modal" tabindex="-1"></div></div>
    <div id="modalReopen" class="show"></div>`;
}

describe('openReactModal / closeReactModal', () => {
  beforeEach(setDom);

  it('mounts the node, opens the overlay, and hides a stale modalReopen tab', () => {
    act(() => openReactModal(<p>hello</p>));
    expect(document.getElementById('modal')!.textContent).toBe('hello');
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
    expect(document.getElementById('modalReopen')!.classList.contains('show')).toBe(false);
  });

  it('restores focus to whatever was focused before opening', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => openReactModal(<p>hello</p>));
    act(() => closeReactModal());
    expect(document.activeElement).toBe(input);
  });

  it('unmounts on close and closes the overlay', () => {
    act(() => openReactModal(<p>hello</p>));
    act(() => closeReactModal());
    expect(document.getElementById('modal')!.textContent).toBe('');
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });

  it('Escape closes a non-sticky modal', () => {
    act(() => openReactModal(<p>hello</p>));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });

  it('Escape does NOT close a sticky modal', () => {
    act(() => openReactModal(<p>hello</p>, { sticky: true }));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
    act(() => closeReactModal()); // cleanup
  });

  it('clicking the overlay backdrop closes a non-sticky modal', () => {
    act(() => openReactModal(<p>hello</p>));
    act(() => {
      document.getElementById('overlay')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });

  it('clicking the overlay backdrop does NOT close a sticky modal', () => {
    act(() => openReactModal(<p>hello</p>, { sticky: true }));
    act(() => {
      document.getElementById('overlay')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
    act(() => closeReactModal()); // cleanup
  });

  it('clicking inside the modal (not the backdrop) does not close it', () => {
    act(() => openReactModal(<p>hello</p>));
    act(() => {
      document.getElementById('modal')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
    act(() => closeReactModal()); // cleanup
  });

  it('opening a second modal while one is open unmounts the first, without a React warning', () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => openReactModal(<p>first</p>));
    act(() => openReactModal(<p>second</p>));
    expect(document.getElementById('modal')!.textContent).toBe('second');
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    act(() => closeReactModal()); // cleanup
  });

  it('these listeners no-op entirely when no React modal is open', () => {
    // No openReactModal call in this test — closeReactModal must not throw even though
    // #modalReopen etc. are in their default state and no root exists to unmount.
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    ).not.toThrow();
  });
});
