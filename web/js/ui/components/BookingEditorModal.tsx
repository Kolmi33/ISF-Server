import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import { AlertTriangle, CalendarDays, Search, X } from 'lucide-react';
import { todayAsIsoDateString } from '../../../../shared/dates.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { store } from '../../store-instance.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { toast } from '../toast.ts';
import type { MyBookingCampaign } from '../views/my-bookings.ts';
import {
  applyBookingEdit,
  bookingEditChanged,
  bookingEditChanges,
  bookingEditConflicts,
  buildBookingEditModel,
  cloneBookingEditRows,
  type BookingEditModel,
  type BookingEditRow,
} from '../booking-edit.ts';
import { AppDialog, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { BookingEditorGrid } from './BookingEditorGrid.tsx';

function useStoreUpdates(): void {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => store.subscribe(() => rerender()), []);
}

function EditorLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-6 py-3 text-[13px] text-muted-foreground sm:px-7">
      <span className="flex items-center gap-2">
        <span className="h-3 w-5 rounded-sm bg-primary/85" /> gebucht
      </span>
      <span className="flex items-center gap-2">
        <span className="booking-editor-busy h-3 w-5 rounded-sm border border-border" /> fremdbelegt
      </span>
      <span className="flex items-center gap-2">
        <span className="h-3 w-5 rounded-sm bg-brand/25" /> Wartung
      </span>
      <span className="flex items-center gap-2">
        <span className="h-3 w-5 rounded-sm bg-destructive/75" /> Konflikt
      </span>
      <span className="ml-auto">
        Balken ziehen = verschieben · Kante ziehen = dehnen · Klick = Tag umschalten
      </span>
    </div>
  );
}

interface EditorState {
  model: BookingEditModel;
  rows: BookingEditRow[];
  pending: boolean;
  error: string;
}

function useEditorState(campaign: MyBookingCampaign) {
  const initial = () => buildBookingEditModel(store.get('data')!, campaign, todayAsIsoDateString());
  const [model, setModel] = useState(initial);
  const [rows, setRows] = useState(() => cloneBookingEditRows(model.initialRows));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const reset = (message: string) => {
    const refreshed = initial();
    setModel(refreshed);
    setRows(cloneBookingEditRows(refreshed.initialRows));
    setError(message);
  };
  return { model, rows, pending, error, setRows, setPending, setError, reset };
}

async function saveEditor(campaign: MyBookingCampaign, state: ReturnType<typeof useEditorState>) {
  if (state.pending) return;
  state.setPending(true);
  state.setError('');
  const result = await window.mutate(
    (fresh) => applyBookingEdit(fresh, state.model, state.rows, store.get('user')),
    `Buchung bearbeitet: ${store.get('user')} · ${campaign.title}`,
    { waitForServer: true, atomic: true },
  );
  state.setPending(false);
  if (!result || result.abort) {
    state.reset(result?.error || 'Speichern fehlgeschlagen. Der aktuelle Stand wurde neu geladen.');
    return;
  }
  toast('Buchung aktualisiert ✓');
  closeReactModal();
}

function EditorStatus({
  state,
  conflicts,
  changes,
}: {
  state: EditorState;
  conflicts: number;
  changes: readonly string[];
}) {
  if (state.error) return <p className="text-destructive">{state.error}</p>;
  if (conflicts)
    return (
      <p className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="size-4" /> {conflicts}{' '}
        {conflicts === 1 ? 'Tag liegt' : 'Tage liegen'} auf einer Sperre.
      </p>
    );
  if (changes.length)
    return (
      <p className="text-muted-foreground">
        {changes.slice(0, 3).join(' · ')}
        {changes.length > 3 ? ` · +${changes.length - 3} weitere` : ''}
      </p>
    );
  return <p className="text-muted-foreground">Keine Änderungen.</p>;
}

interface EditorFooterProps {
  campaign: MyBookingCampaign;
  state: ReturnType<typeof useEditorState>;
  conflicts: number;
  changes: readonly string[];
  changed: boolean;
  onSearchWindow: (campaign: MyBookingCampaign) => void;
}

function EditorFooter(props: EditorFooterProps) {
  return (
    <AppDialogFooter>
      <div className="min-w-[16rem] flex-1 text-sm">
        <EditorStatus state={props.state} conflicts={props.conflicts} changes={props.changes} />
      </div>
      {!!props.conflicts && (
        <Button variant="outline" size="lg" onClick={() => props.onSearchWindow(props.campaign)}>
          <Search className="size-4" /> Freien Termin suchen
        </Button>
      )}
      <Button variant="ghost" size="lg" disabled={props.state.pending} onClick={closeReactModal}>
        Verwerfen
      </Button>
      <Button
        size="lg"
        disabled={props.state.pending || !props.changed || !!props.conflicts}
        onClick={() => void saveEditor(props.campaign, props.state)}
      >
        {props.state.pending ? 'Wird gespeichert …' : 'Änderungen speichern'}
      </Button>
    </AppDialogFooter>
  );
}

export function BookingEditorModal({
  campaign,
  onSearchWindow,
}: {
  campaign: MyBookingCampaign;
  onSearchWindow: (campaign: MyBookingCampaign) => void;
}) {
  useStoreUpdates();
  const titleId = useId();
  const state = useEditorState(campaign);
  const data = store.get('data')!;
  const conflicts = bookingEditConflicts(data, state.model, state.rows).length;
  const changes = useMemo(
    () => bookingEditChanges(data, state.model.initialRows, state.rows),
    [data, state.model, state.rows],
  );
  const changed = bookingEditChanged(state.model.initialRows, state.rows);
  return (
    <AppDialog size="xl" labelledBy={titleId} className="booking-editor font-sans">
      <AppDialogHeader
        icon={<CalendarDays className="size-6" />}
        title="Belegung bearbeiten"
        titleId={titleId}
        subtitle={campaign.title}
        actions={
          <Button variant="ghost" size="icon" aria-label="Schließen" onClick={closeReactModal}>
            <X className="size-5" />
          </Button>
        }
      />
      <EditorLegend />
      {state.model.initialRows.length ? (
        <BookingEditorGrid model={state.model} rows={state.rows} setRows={state.setRows} />
      ) : (
        <div className="border-t border-border px-7 py-16 text-center text-sm text-muted-foreground">
          Diese Buchung enthält keine zukünftig bearbeitbaren Tage mehr.
        </div>
      )}
      <EditorFooter
        campaign={campaign}
        state={state}
        conflicts={conflicts}
        changes={changes}
        changed={changed}
        onSearchWindow={onSearchWindow}
      />
    </AppDialog>
  );
}

export function openBookingEditor(
  campaign: MyBookingCampaign,
  onSearchWindow: (campaign: MyBookingCampaign) => void,
): void {
  openReactModal(<BookingEditorModal campaign={campaign} onSearchWindow={onSearchWindow} />, {
    sticky: true,
  });
}
