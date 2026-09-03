// =======================================================================================
// ACTIVE USERS MODAL COMPONENT (web/js/ui/components/ActiveUsersModal.tsx)
// =======================================================================================
//
// The "active users" popup — opened by a double-click on the user chip.
//
// =======================================================================================

import { Icon } from './Icon.tsx';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { activeUserRows, presenceTick, type ActiveUserRow } from '../live-connection.ts';
import { store } from '../../store-instance.ts';
import { handleError } from '../debug-panel.ts';

/** Refreshes presence, then opens the popup with a snapshot of who's active right now. */
export async function openActiveUsers(): Promise<void> {
  try {
    await presenceTick();
  } catch (error) {
    handleError('presenceTick', error);
  }
  openReactModal(<ActiveUsersModal rows={activeUserRows(Date.now())} />);
}

export interface ActiveUsersModalProps {
  rows: readonly ActiveUserRow[];
}

function UserRow({ row }: { row: ActiveUserRow }) {
  const isMe = row.name.toLowerCase() === (store.get('user') || '').toLowerCase();
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
