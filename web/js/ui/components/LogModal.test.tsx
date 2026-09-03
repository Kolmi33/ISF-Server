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
  // What: with no log entries at all, the modal shows a placeholder message and a "0" count.
  // How: renders with an empty entries array and checks both texts appear.
  it('shows a placeholder when there are no entries', () => {
    render(<LogModal entries={[]} />);
    expect(screen.getByText('Noch keine Einträge.')).toBeInTheDocument();
    expect(screen.getByText('letzte 0')).toBeInTheDocument();
  });

  // What: entries render newest-first exactly as given (no re-sorting), but the list is
  // capped at 200 rendered rows even when more entries are passed, and the count label
  // reflects the real (uncapped) total.
  // How: renders 250 entries and checks the count label shows 200, the first entry (index 0)
  // is present, but an entry past the 200-cap (index 200) is not.
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

  // What: entry text (user/action) needs no manual HTML escaping — React's own JSX text
  // rendering already escapes it, so markup-looking text shows up literally, not interpreted.
  // How: renders an entry whose user field contains an HTML tag and checks it appears as
  // literal text in the DOM.
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

  // What: opening the log modal renders it with whatever's currently in the store's log —
  // a live snapshot, not empty.
  // How: seeds the store with one log entry, opens the modal, and checks the "letzte 1" count.
  it('opens with a snapshot of the log', () => {
    act(() => openLog());
    expect(screen.getByText('letzte 1')).toBeInTheDocument();
  });

  // What: the "Zurück" (back) button returns to the admin modal.
  // How: opens the log modal, clicks Zurück, and checks openAdmin was called.
  it('"Zurück" calls openAdmin', () => {
    act(() => openLog());
    screen.getByRole('button', { name: 'Zurück' }).click();
    expect(openAdmin).toHaveBeenCalledOnce();
  });
});
