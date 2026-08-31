// The change-log modal (Phase 7 slice B9). Faithful JSX port of legacy `openLog()` — a
// snapshot of `S.data.log` at open time (not a live subscription; the original didn't
// update while the modal was open either). "Zurück" calls `window.openAdmin()` — bridged
// from `AdminModal.tsx` since Phase 7 slice B5, kept as a window call rather than a direct
// import to avoid a circular import between the two modals.

import type { LogEntry } from '../../../../shared/types.ts';
import { Icon } from './Icon.tsx';
import { closeReactModal, openReactModal } from '../modal.tsx';

/**
 * Open the change-log modal with a snapshot of the current log. Faithful port of legacy
 * `openLog()`. Reads `window.S` directly (not a `store` import) because `state.ts` only
 * exports the `createStore` factory — the one live instance is a module-local in `app.ts`,
 * bridged onto `window.S` as the plain state object. Matches how legacy.js itself reads it.
 */
export function openLog(): void {
  openReactModal(<LogModal entries={window.S.data?.log || []} />);
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
              <span className="ts">{new Date(entry.ts).toLocaleString('de-DE')}</span>
              <b>{entry.user}</b>: {entry.action}
            </div>
          ))
        ) : (
          <p className="hint">Noch keine Einträge.</p>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => window.openAdmin()}>
          Zurück
        </button>
        <button className="btn" onClick={closeReactModal}>
          Schließen
        </button>
      </div>
    </>
  );
}
