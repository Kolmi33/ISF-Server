// =======================================================================================
// ASK USER NAME MODAL COMPONENT (web/js/ui/components/AskUserNameModal.tsx)
// =======================================================================================
//
// The "what's your name?" modal.
//
// Key Principles:
// - DISMISSIBLE EVEN ON FIRST RUN: Escape/outside-click always dismiss this modal — only
//   the Cancel *button* is hidden on `firstRun`, not the ability to dismiss it some other
//   way. A first-time user isn't force-walled behind naming themselves.
//
// =======================================================================================

import { useEffect, useRef } from 'react';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { store } from '../../store-instance.ts';
import { updateUserChip } from '../user-chip.ts';
import { dbg } from '../debug-panel.ts';
import { presenceTick } from '../live-connection.ts';

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
    updateUserChip();
    closeReactModal();
    store.notify();
    dbg('user', 'Name gesetzt: ' + name);
    void presenceTick();
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

/** Opens the name-prompt modal. */
export function askUserName(firstRun: boolean): void {
  openReactModal(<AskUserNameModal firstRun={firstRun} />);
}
