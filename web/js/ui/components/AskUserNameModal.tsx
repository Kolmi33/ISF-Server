// The "what's your name?" modal (Phase 7 slice B9). Faithful port of legacy `askUserName()`.
// Not sticky even on first run — the original never passed `{sticky:true}` here either, so
// Escape/outside-click still dismiss it (only the Cancel *button* is hidden on first run,
// not dismissal itself). Mutates `window.S.user` directly, matching how every other legacy
// write to `S` works — there is no store-level "set user" action to route through yet.

import { useEffect, useRef } from 'react';
import { closeReactModal, openReactModal } from '../modal.tsx';

export interface AskUserNameModalProps {
  firstRun: boolean;
}

export function AskUserNameModal({ firstRun }: AskUserNameModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const save = () => {
    const name = inputRef.current?.value.trim();
    if (!name) {
      inputRef.current?.focus();
      return;
    }
    window.S.user = name;
    localStorage.setItem('mb_user', name);
    window.updateUserChip();
    closeReactModal();
    window.notify();
    window.dbg('user', 'Name gesetzt: ' + name);
    window.presenceTick();
  };

  return (
    <>
      <h2>Wie heißt du?</h2>
      <div className="formrow">
        <label>Name</label>
        <input
          type="text"
          ref={inputRef}
          defaultValue={window.S.user}
          placeholder="Nachname"
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
          }}
        />
      </div>
      <div className="modal-actions">
        {!firstRun && (
          <button className="btn" onClick={closeReactModal}>
            Abbrechen
          </button>
        )}
        <button className="btn primary" onClick={save}>
          Speichern
        </button>
      </div>
    </>
  );
}

/** Open the name-prompt modal. Faithful port of legacy `askUserName(firstRun)`. */
export function askUserName(firstRun: boolean): void {
  openReactModal(<AskUserNameModal firstRun={firstRun} />);
}
