// =======================================================================================
// ACTIVE USERS MODAL COMPONENT (web/js/ui/components/ActiveUsersModal.tsx)
// =======================================================================================
//
// The "active users" popup — opened by a double-click on the user chip.
//
// =======================================================================================

import { useId } from 'react';
import { Users, UserX } from 'lucide-react';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { activeUserRows, presenceTick, type ActiveUserRow } from '../live-connection.ts';
import { store } from '../../store-instance.ts';
import { handleError } from '../debug-panel.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/app-button.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { EmptyState } from './app/EmptyState.tsx';

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
    <li className="mybk flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:bg-muted">
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {row.name}
        {isMe && <span className="ml-1.5 text-muted-foreground">(du)</span>}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {row.ago < 12 ? 'gerade eben' : `vor ${row.ago} s`}
      </span>
    </li>
  );
}

export function ActiveUsersModal({ rows }: ActiveUsersModalProps) {
  const titleId = useId();
  return (
    <AppDialog size="sm" labelledBy={titleId}>
      <AppDialogHeader
        icon={<Users className="size-6" />}
        title="Gerade aktiv"
        titleId={titleId}
        subtitle="Wer den Plan in diesem Moment offen hat."
        actions={rows.length > 0 ? <Badge>{rows.length}</Badge> : undefined}
      />
      <AppDialogBody className="max-h-[60vh]">
        {rows.length ? (
          <ScrollArea className="-mr-3 min-h-0 flex-1 pr-3">
            <ul className="flex flex-col gap-1">
              {rows.map((row) => (
                <UserRow row={row} key={row.name} />
              ))}
            </ul>
          </ScrollArea>
        ) : (
          <EmptyState icon={<UserX className="size-7 text-muted-foreground/60" />}>
            Zurzeit ist niemand aktiv.
          </EmptyState>
        )}
      </AppDialogBody>
      <AppDialogFooter>
        <Button size="lg" className="ml-auto" onClick={closeReactModal}>
          Schließen
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}
