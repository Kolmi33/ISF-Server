// The "what's your name?" modal (Phase 7 slice B9). Faithful port of legacy `askUserName()`.
// Not sticky even on first run — the original never passed `{sticky:true}` here either, so
// Escape/outside-click still dismiss it (only the Cancel *button* is hidden on first run,
// not dismissal itself).

import { useEffect, useRef } from 'react';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { store } from '../../store-instance.ts';

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
    // Silent — updateUserChip()/closeReactModal() run before the one notify, matching the
    // original's single window.notify() after both.
    store.state.user = name;
    localStorage.setItem('mb_user', name);
    window.updateUserChip();
    closeReactModal();
    store.notify();
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
          defaultValue={store.get('user')}
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
