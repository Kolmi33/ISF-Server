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

import { useId } from 'react';
import { FileClock } from 'lucide-react';
import type { LogEntry } from '../../../../shared/types.ts';
import { formatTimestamp } from '../../../../shared/dates.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { store } from '../../store-instance.ts';
import { openAdmin } from './AdminModal.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/app-button.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { EmptyState } from './app/EmptyState.tsx';

/** Opens the change-log modal with a snapshot of the current log. */
export function openLog(): void {
  openReactModal(<LogModal entries={store.get('data')?.log || []} />);
}

export interface LogModalProps {
  entries: readonly LogEntry[];
}

const MAX_SHOWN = 200;

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <li className="logrow rounded-lg border border-transparent px-3 py-2 transition-colors hover:bg-muted">
      <span className="ts block text-[11px] tabular-nums text-muted-foreground">
        {formatTimestamp(entry.ts)}
      </span>
      <span className="mt-0.5 block text-sm text-foreground">
        <span className="font-medium">{entry.user}</span>: {entry.action}
      </span>
    </li>
  );
}

export function LogModal({ entries }: LogModalProps) {
  const shown = entries.slice(0, MAX_SHOWN);
  const titleId = useId();
  return (
    <AppDialog size="md" labelledBy={titleId}>
      <AppDialogHeader
        icon={<FileClock className="size-6" />}
        title="Änderungsprotokoll"
        titleId={titleId}
        subtitle="Wer wann was an Ressourcen und Buchungen geändert hat."
        actions={<Badge variant="outline">letzte {Math.min(entries.length, MAX_SHOWN)}</Badge>}
      />
      <AppDialogBody className="max-h-[60vh]">
        {shown.length ? (
          <ScrollArea className="-mr-3 min-h-0 flex-1 pr-3">
            <ul className="flex flex-col gap-1">
              {shown.map((entry, index) => (
                <LogRow entry={entry} key={index} />
              ))}
            </ul>
          </ScrollArea>
        ) : (
          <EmptyState>Noch keine Einträge.</EmptyState>
        )}
      </AppDialogBody>
      <AppDialogFooter>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="lg" onClick={() => openAdmin()}>
            Zurück
          </Button>
          <Button size="lg" onClick={closeReactModal}>
            Schließen
          </Button>
        </div>
      </AppDialogFooter>
    </AppDialog>
  );
}
