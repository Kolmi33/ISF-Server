// The change-log modal (Phase 7 slice B9). Faithful JSX port of legacy `openLog()` — a
// snapshot of `S.data.log` at open time (not a live subscription; the original didn't
// update while the modal was open either). "Zurück" calls `openAdmin()`, a direct import from
// `AdminModal.tsx` (which imports back from here for its own "Änderungsprotokoll" button) —
// see `AdminModal.tsx`'s header comment for why that cycle is safe.

import type { LogEntry } from '../../../../shared/types.ts';
import { formatTimestamp } from '../../../../shared/dates.ts';
import { Icon } from './Icon.tsx';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { store } from '../../store-instance.ts';
import { openAdmin } from './AdminModal.tsx';

/** Open the change-log modal with a snapshot of the current log. Faithful port of legacy
 *  `openLog()`. */
export function openLog(): void {
  openReactModal(<LogModal entries={store.get('data')?.log || []} />);
}

export interface LogModalProps {
  entries: readonly LogEntry[];
}

const MAX_SHOWN = 200;

export function LogModal({ entries }: LogModalProps) {
  const shown = entries.slice(0, MAX_SHOWN);
  return (
    <>
      <h2>
        <Icon name="doc" /> Änderungsprotokoll{' '}
        <span className="tag">letzte {Math.min(entries.length, MAX_SHOWN)}</span>
      </h2>
      <div className="resultlist" style={{ maxHeight: 420 }}>
        {shown.length ? (
          shown.map((entry, index) => (
            <div className="logrow" key={index}>
              <span className="ts">{formatTimestamp(entry.ts)}</span>
              <b>{entry.user}</b>: {entry.action}
            </div>
          ))
        ) : (
          <p className="hint">Noch keine Einträge.</p>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => openAdmin()}>
          Zurück
        </button>
        <button className="btn" onClick={closeReactModal}>
          Schließen
        </button>
      </div>
    </>
  );
}
