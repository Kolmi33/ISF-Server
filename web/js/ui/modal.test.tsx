// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { openReactModal, closeReactModal, collapseReactModal } from './modal.tsx';

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

  it('lets an open nested popover handle Escape before the modal', () => {
    act(() =>
      openReactModal(
        <div data-slot="popover-content" data-open="">
          Calendar
        </div>,
      ),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('overlay')).toHaveClass('open');
    document.querySelector('[data-slot="popover-content"]')!.removeAttribute('data-open');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('overlay')).not.toHaveClass('open');
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

  it('collapsing hides the overlay and shows the reopen tab, without unmounting', () => {
    act(() => openReactModal(<p>hello</p>));
    act(() => collapseReactModal());
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('modalReopen')!.classList.contains('show')).toBe(true);
    expect(document.getElementById('modal')!.textContent).toBe('hello'); // still mounted
    act(() => closeReactModal()); // cleanup
  });

  it('Escape while collapsed only clears the reopen tab — it does not unmount', () => {
    act(() => openReactModal(<p>hello</p>));
    act(() => collapseReactModal());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.getElementById('modalReopen')!.classList.contains('show')).toBe(false);
    expect(document.getElementById('modal')!.textContent).toBe('hello'); // still mounted
    act(() => closeReactModal()); // cleanup
  });

  it('clicking #modalReopen re-shows the overlay and hides the tab, still mounted', () => {
    act(() => openReactModal(<p>hello</p>));
    act(() => collapseReactModal());
    act(() => {
      document
        .getElementById('modalReopen')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
    expect(document.getElementById('modalReopen')!.classList.contains('show')).toBe(false);
    expect(document.getElementById('modal')!.textContent).toBe('hello');
    act(() => closeReactModal()); // cleanup
  });

  it('regression: Escape closes the modal again after a collapse/re-expand round trip', () => {
    // Before this fix, re-expanding via #modalReopen left the internal "collapsed" flag
    // stuck true, so this Escape would only clear the (already-hidden) reopen tab — a no-op —
    // instead of actually closing the now-visible modal.
    act(() => openReactModal(<p>hello</p>));
    act(() => collapseReactModal());
    act(() => {
      document
        .getElementById('modalReopen')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('modal')!.textContent).toBe(''); // actually unmounted
  });

  it('opening a new modal while collapsed unmounts the collapsed one', () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => openReactModal(<p>first</p>));
    act(() => collapseReactModal());
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
