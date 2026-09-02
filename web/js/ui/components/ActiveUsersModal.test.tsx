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
  it('shows "niemand aktiv" with no rows', () => {
    render(<ActiveUsersModal rows={[]} />);
    expect(screen.getByText('Zurzeit ist niemand aktiv.')).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Gerade aktiv');
  });

  it('lists each row with a count in the heading, and a relative-time label', () => {
    render(
      <ActiveUsersModal
        rows={[
          { name: 'bob', ago: 5 },
          { name: 'carl', ago: 90 },
        ]}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Gerade aktiv (2)');
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('gerade eben')).toBeInTheDocument();
    expect(screen.getByText('vor 90 s')).toBeInTheDocument();
  });

  it('marks the current user with "(du)", case-insensitively', () => {
    render(<ActiveUsersModal rows={[{ name: 'Anna', ago: 1 }]} />);
    expect(screen.getByText('(du)')).toBeInTheDocument();
  });

  it('does not mark someone else as "(du)"', () => {
    render(<ActiveUsersModal rows={[{ name: 'bob', ago: 1 }]} />);
    expect(screen.queryByText('(du)')).not.toBeInTheDocument();
  });

  it('"Schließen" closes the modal', () => {
    render(<ActiveUsersModal rows={[]} />, { container: document.getElementById('modal')! });
    document.getElementById('overlay')!.classList.add('open');
    screen.getByRole('button', { name: 'Schließen' }).click();
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});

describe('openActiveUsers', () => {
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
