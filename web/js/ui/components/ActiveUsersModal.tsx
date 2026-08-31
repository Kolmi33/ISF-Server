// The "active users" popup (Phase 7 slice B10d) — opened by a double-click on the user chip.
// Faithful port of legacy `openActiveUsers`, now a React modal reusing `openReactModal`/
// `closeReactModal` (`ui/modal.tsx`) instead of legacy's own `openModal`/`closeModal`. It was
// their only remaining caller — this slice retires both, along with `modalSticky`/
// `lastFocusEl` and the already-dead `collapseModal`.

import { Icon } from './Icon.tsx';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { activeUserRows, presenceTick, type ActiveUserRow } from '../live-connection.ts';

/** Refresh presence, then open the popup with a snapshot of who's active. Faithful port of
 *  legacy `openActiveUsers`. */
export async function openActiveUsers(): Promise<void> {
  try {
    await presenceTick();
  } catch (error) {
    window.handleError('presenceTick', error);
  }
  openReactModal(<ActiveUsersModal rows={activeUserRows(Date.now())} />);
}

export interface ActiveUsersModalProps {
  rows: readonly ActiveUserRow[];
}

function UserRow({ row }: { row: ActiveUserRow }) {
  const isMe = row.name.toLowerCase() === (window.S.user || '').toLowerCase();
  return (
    <div className="mybk">
      <div>
        <b>{row.name}</b>
        {isMe && (
          <span className="hint" style={{ margin: 0 }}>
            {' '}
            (du)
          </span>
        )}
      </div>
      <span className="hint" style={{ margin: 0 }}>
        {row.ago < 12 ? 'gerade eben' : `vor ${row.ago} s`}
      </span>
    </div>
  );
}

export function ActiveUsersModal({ rows }: ActiveUsersModalProps) {
  return (
    <>
      <h2>
        <Icon name="user" /> Gerade aktiv{rows.length ? ` (${rows.length})` : ''}
      </h2>
      {rows.length ? (
        <div className="resultlist" style={{ maxHeight: 320 }}>
          {rows.map((row) => (
            <UserRow row={row} key={row.name} />
          ))}
        </div>
      ) : (
        <p className="hint">Zurzeit ist niemand aktiv.</p>
      )}
      <div className="modal-actions">
        <button className="btn primary" onClick={closeReactModal}>
          Schließen
        </button>
      </div>
    </>
  );
}
