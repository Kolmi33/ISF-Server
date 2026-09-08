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

import { useEffect, useId, useRef } from 'react';
import { UserRound } from 'lucide-react';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { store } from '../../store-instance.ts';
import { updateUserChip } from '../user-chip.ts';
import { dbg } from '../debug-panel.ts';
import { presenceTick } from '../live-connection.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { FormField } from './app/FormField.tsx';

export interface AskUserNameModalProps {
  firstRun: boolean;
}

export function AskUserNameModal({ firstRun }: AskUserNameModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const fieldId = useId();

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
    <AppDialog size="sm" labelledBy={titleId}>
      <AppDialogHeader
        icon={<UserRound className="size-6" />}
        title="Wie heißt du?"
        titleId={titleId}
        subtitle="Unter diesem Namen erscheinen deine Buchungen im Plan."
      />
      <AppDialogBody className="overflow-y-auto [scrollbar-gutter:stable]">
        <FormField label="Name" htmlFor={fieldId}>
          <Input
            id={fieldId}
            type="text"
            ref={inputRef}
            defaultValue={store.get('user')}
            placeholder="Nachname"
            className="h-10 rounded-lg"
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }}
          />
        </FormField>
      </AppDialogBody>
      <AppDialogFooter>
        <div className="ml-auto flex items-center gap-2">
          {!firstRun && (
            <Button variant="ghost" size="lg" onClick={closeReactModal}>
              Abbrechen
            </Button>
          )}
          <Button size="lg" onClick={save}>
            Speichern
          </Button>
        </div>
      </AppDialogFooter>
    </AppDialog>
  );
}

/** Opens the name-prompt modal. */
export function askUserName(firstRun: boolean): void {
  openReactModal(<AskUserNameModal firstRun={firstRun} />);
}
