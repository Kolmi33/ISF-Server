// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { AppState } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';
import { presenceData } from '../live-connection.ts';

// ActiveUsersModal.tsx imports `handleError` directly from `../debug-panel.ts` (F8 cleanup,
// ARCHITECTURE_AUDIT.md) rather than reaching through `window.handleError` — mocked here so
// this test keeps controlling/observing it as before.
vi.mock('../debug-panel.ts', () => ({ handleError: vi.fn() }));

import { ActiveUsersModal, openActiveUsers } from './ActiveUsersModal.tsx';
import { handleError } from '../debug-panel.ts';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="overlay"><div id="modal" tabindex="-1"></div></div>
    <div id="modalReopen"></div>
    <span id="lastRef"></span>`;
  store.set({ user: 'anna' } as unknown as Partial<AppState>);
  window.S = store.state;
  vi.mocked(handleError).mockClear();
  for (const key of Object.keys(presenceData)) delete presenceData[key];
});

describe('ActiveUsersModal', () => {
  // What: with nobody active, the modal shows a placeholder message and no count badge.
  // How: renders with an empty rows array and checks both texts.
  it('shows "niemand aktiv" with no rows', () => {
    render(<ActiveUsersModal rows={[]} />);
    expect(screen.getByText('Zurzeit ist niemand aktiv.')).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Gerade aktiv');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  // What: each active user renders as its own row, a badge beside the title shows the total count, and
  // each row's activity time renders as a relative label (a special "just now" phrase under a
  // threshold, a numeric "N s ago" above it).
  // How: renders two rows with different `ago` values and checks the count badge and both
  // relative-time label forms.
  it('lists each row with a count in the heading, and a relative-time label', () => {
    render(
      <ActiveUsersModal
        rows={[
          { name: 'bob', ago: 5 },
          { name: 'carl', ago: 90 },
        ]}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Gerade aktiv');
    expect(screen.getByText('2')).toBeInTheDocument(); // the count badge beside the title
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('gerade eben')).toBeInTheDocument();
    expect(screen.getByText('vor 90 s')).toBeInTheDocument();
  });

  // What: the row belonging to the current logged-in user is marked "(you)", matched
  // case-insensitively against the store's user name.
  // How: sets the store's user to lowercase 'anna' and renders a row for differently-cased
  // 'Anna', checking the "(du)" marker still appears.
  it('marks the current user with "(du)", case-insensitively', () => {
    render(<ActiveUsersModal rows={[{ name: 'Anna', ago: 1 }]} />);
    expect(screen.getByText('(du)')).toBeInTheDocument();
  });

  // What: a row for someone other than the current user never gets the "(du)" marker.
  // How: renders a row for a different name and checks the marker is absent.
  it('does not mark someone else as "(du)"', () => {
    render(<ActiveUsersModal rows={[{ name: 'bob', ago: 1 }]} />);
    expect(screen.queryByText('(du)')).not.toBeInTheDocument();
  });

  // What: the "Schließen" (close) button closes the shared overlay.
  // How: renders into the shared #modal container, opens the overlay, clicks close, and
  // checks the overlay's open class is gone.
  it('"Schließen" closes the modal', () => {
    render(<ActiveUsersModal rows={[]} />, { container: document.getElementById('modal')! });
    document.getElementById('overlay')!.classList.add('open');
    screen.getByRole('button', { name: 'Schließen' }).click();
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});

describe('openActiveUsers', () => {
  // What: opening the modal first does a fresh presence check-in, then opens showing
  // whatever presence data is now current.
  // How: stubs a working EventSource, seeds one user's presence timestamp, opens the modal,
  // and checks both the overlay opened and that user's row appears.
  it('refreshes presence, then opens with a snapshot of the current rows', async () => {
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener(): void {}
        close(): void {}
      },
    );
    presenceData.bob = Date.now();
    await act(() => openActiveUsers());
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  // What: if the presence check-in itself fails (e.g. the EventSource can't connect), the
  // failure is reported through the error handler rather than crashing the open — and the
  // modal still opens regardless.
  // How: stubs an EventSource whose constructor throws, opens the modal, and checks
  // handleError was called with the failure while the overlay still ended up open.
  it('reports (not throws) when presenceTick fails', async () => {
    vi.stubGlobal(
      'EventSource',
      class {
        constructor() {
          throw new Error('boom');
        }
      },
    );
    await act(() => openActiveUsers());
    expect(handleError).toHaveBeenCalledWith('presenceTick', expect.any(Error));
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
  });
});
