// =======================================================================================
// LOG MODAL COMPONENT (web/js/ui/components/LogModal.tsx)
// =======================================================================================
//
// The change-log modal.
//
// Key Principles:
// - A SNAPSHOT, NOT A LIVE VIEW: shows the log as it was at open time, not a live
//   subscription — a later write elsewhere doesn't update this modal while it's open.
// - A SAFE IMPORT CYCLE: "Zurück" calls `openAdmin()`, a direct import from
//   `AdminModal.tsx` (which imports back from here for its own "Änderungsprotokoll"
//   button) — see `AdminModal.tsx`'s header comment for why that three-way cycle is safe.
//
// =======================================================================================

import type { LogEntry } from '../../../../shared/types.ts';
import { formatTimestamp } from '../../../../shared/dates.ts';
import { Icon } from './Icon.tsx';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { store } from '../../store-instance.ts';
import { openAdmin } from './AdminModal.tsx';

/** Opens the change-log modal with a snapshot of the current log. */
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
