// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { AppState } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';

// LogModal.tsx imports `openAdmin` directly from `./AdminModal.tsx` (part of a real 3-way
// import cycle with MachineFormModal.tsx too — F8 cleanup, ARCHITECTURE_AUDIT.md) rather than
// reaching through `window.openAdmin` — mocked here so this test keeps observing it as before.
vi.mock('./AdminModal.tsx', () => ({ openAdmin: vi.fn() }));

import { LogModal, openLog } from './LogModal.tsx';
import { openAdmin } from './AdminModal.tsx';

describe('LogModal', () => {
  it('shows a placeholder when there are no entries', () => {
    render(<LogModal entries={[]} />);
    expect(screen.getByText('Noch keine Einträge.')).toBeInTheDocument();
    expect(screen.getByText('letzte 0')).toBeInTheDocument();
  });

  it('lists entries newest-first as given, capped at 200 and labeled with the real count', () => {
    const entries = Array.from({ length: 250 }, (_, i) => ({
      ts: '2021-01-04T10:00:00.000Z',
      user: `User${i}`,
      action: `Action${i}`,
    }));
    render(<LogModal entries={entries} />);
    expect(screen.getByText('letzte 200')).toBeInTheDocument();
    expect(screen.getByText('User0', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('User200', { exact: false })).not.toBeInTheDocument();
  });

  it("escapes nothing extra — user/action render as plain text via React's own escaping", () => {
    render(
      <LogModal entries={[{ ts: '2021-01-04T10:00:00.000Z', user: '<b>x</b>', action: 'y' }]} />,
    );
    expect(screen.getByText('<b>x</b>', { exact: false })).toBeInTheDocument();
  });
});

describe('openLog', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="overlay"><div id="modal" tabindex="-1"></div></div>
      <div id="modalReopen"></div>`;
    store.set({
      data: { log: [{ ts: '2021-01-04T10:00:00.000Z', user: 'A', action: 'B' }] },
    } as unknown as Partial<AppState>);
    window.S = store.state;
    vi.mocked(openAdmin).mockClear();
  });

  it('opens with a snapshot of the log', () => {
    act(() => openLog());
    expect(screen.getByText('letzte 1')).toBeInTheDocument();
  });

  it('"Zurück" calls openAdmin', () => {
    act(() => openLog());
    screen.getByRole('button', { name: 'Zurück' }).click();
    expect(openAdmin).toHaveBeenCalledOnce();
  });
});
