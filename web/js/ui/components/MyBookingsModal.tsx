import { useEffect, useId, useReducer, useState } from 'react';
import { Inbox, Plus, Search } from 'lucide-react';
import type { BookingData } from '../../../../shared/types.ts';
import {
  mondayOfDate,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../../shared/dates.ts';
import { deleteOwnCells, type CellUndo } from '../../core/bookings.ts';
import { getMachineCategory } from '../../core/machines.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { store } from '../../store-instance.ts';
import { clearSelection } from '../grid-interaction.ts';
import { gotoDate, prependWeek, resetView } from '../grid-scroll.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { offerUndo, toast } from '../toast.ts';
import { saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';
import { askUserName } from './AskUserNameModal.tsx';
import { AssistantModal } from './AssistantModal.tsx';
import { AppDialog } from './app/AppDialog.tsx';
import { MyBookingCampaignCard } from './MyBookingsRun.tsx';
import { openBookingEditor } from './BookingEditorModal.tsx';
import { BookingStatusTabs, type BookingFilterId } from './BookingStatusTabs.tsx';
import {
  computeBookingCampaigns,
  computeMyBookingCampaigns,
  filterMyBookingCampaigns,
  type MyBookingCampaign,
} from '../views/my-bookings.ts';

function useStoreUpdates(): void {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => store.subscribe(() => rerender()), []);
}
function groupedCells(campaign: MyBookingCampaign, today: string) {
  const byMachine = new Map<string, string[]>();
  for (const cell of campaign.cells) {
    if (cell.date < today) continue;
    const dates = byMachine.get(cell.machineId) || [];
    dates.push(cell.date);
    byMachine.set(cell.machineId, dates);
  }
  return byMachine;
}
function deleteCampaignCells(
  data: BookingData,
  campaign: MyBookingCampaign,
  user: string,
  today: string,
) {
  let deletedCount = 0;
  const undo: CellUndo[] = [];
  for (const [machineId, dates] of groupedCells(campaign, today)) {
    const result = deleteOwnCells(data, machineId, user, dates);
    deletedCount += result.deletedCount;
    undo.push(...result.undo);
  }
  return { deletedCount, undo, abort: deletedCount === 0 };
}

function gotoCampaign(campaign: MyBookingCampaign): void {
  const firstDate = campaign.dates[0]!;
  closeReactModal();
  store.state.machSel = new Set(campaign.machines.map((machine) => machine.id));
  for (const machine of campaign.machines) {
    store.get('cats').add(getMachineCategory(machine));
    store.get('collapsed').delete(machine.group);
  }
  saveFilters();
  updateMachBtn();
  store.state.startMonday = mondayOfDate(parseIsoDateString(firstDate));
  resetView();
  store.notify();
  prependWeek();
  clearSelection();
  gotoDate(firstDate);
}

function openNewBooking(): void {
  openReactModal(<AssistantModal />, { sticky: true });
}

function repeatBooking(campaign: MyBookingCampaign): void {
  openReactModal(
    <AssistantModal
      preset={{
        machineIds: campaign.machines.map((machine) => machine.id),
        workdays: campaign.dates.length,
      }}
    />,
    { sticky: true },
  );
}

function EmptyBookings({ narrowed, query, onReset }: EmptyBookingsProps) {
  return (
    <div className="mt-1 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-background py-16 text-center">
      <Inbox className="size-7 text-muted-foreground/60" />
      <p className="max-w-[34ch] text-sm text-muted-foreground">
        {query
          ? `Keine Buchung und kein Gerät passt zu „${query}“.`
          : narrowed
            ? 'In diesem Status liegt gerade nichts.'
            : 'Unter deinem Namen wurden noch keine Buchungen gefunden.'}
      </p>
      <Button variant="outline" size="sm" onClick={narrowed ? onReset : openNewBooking}>
        {narrowed ? 'Filter zurücksetzen' : 'Neue Buchung'}
      </Button>
    </div>
  );
}

interface EmptyBookingsProps {
  narrowed: boolean;
  query: string;
  onReset: () => void;
}

function deviceMatches(campaign: MyBookingCampaign, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    !!needle &&
    campaign.machines.some((machine) =>
      [machine.name, machine.group, machine.id].some((text) => text.toLowerCase().includes(needle)),
    )
  );
}

function CampaignList({
  campaigns,
  query,
  expanded,
  pending,
  showOwner,
  onToggle,
  onCancel,
}: ListProps) {
  const user = store.get('user').trim().toLowerCase();
  return (
    <ScrollArea className="-mr-3 min-h-0 flex-[1_1_24rem] pr-3">
      <ul className="flex flex-col gap-2.5">
        {campaigns.map((campaign) => (
          <MyBookingCampaignCard
            key={campaign.id}
            campaign={campaign}
            expanded={expanded.has(campaign.id) || deviceMatches(campaign, query)}
            highlight={query.trim().toLowerCase()}
            pending={pending === campaign.id}
            readOnly={store.get('readOnly')}
            owned={campaign.owner.trim().toLowerCase() === user}
            showOwner={showOwner}
            onToggle={() => onToggle(campaign.id)}
            onGoto={() =>
              campaign.owner.trim().toLowerCase() === user
                ? openBookingEditor(campaign, repeatBooking)
                : gotoCampaign(campaign)
            }
            onRepeat={() => repeatBooking(campaign)}
            onCancel={() => onCancel(campaign)}
          />
        ))}
      </ul>
    </ScrollArea>
  );
}

interface ListProps {
  campaigns: readonly MyBookingCampaign[];
  query: string;
  expanded: ReadonlySet<string>;
  pending: string | null;
  showOwner: boolean;
  onToggle: (id: string) => void;
  onCancel: (campaign: MyBookingCampaign) => void;
}

function useExpandedCampaigns() {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { expanded, setExpanded, toggle };
}

function useCampaignCancellation(today: string) {
  const [pending, setPending] = useState<string | null>(null);
  async function cancel(campaign: MyBookingCampaign): Promise<void> {
    if (pending) return;
    const count = campaign.cells.filter((cell) => cell.date >= today).length;
    const confirmed = await window.askConfirm({
      title: 'Buchung stornieren?',
      body: `<b>${campaign.title}</b><br>${count} gebuchte${count === 1 ? 'r Tag' : ' Tage'} ab heute werden gelöscht.`,
      yes: 'Buchung stornieren',
    });
    if (!confirmed) return;
    setPending(campaign.id);
    try {
      const result = await window.mutate(
        (fresh) => deleteCampaignCells(fresh, campaign, store.get('user'), today),
        `Storniert: ${store.get('user')} · ${campaign.title}`,
      );
      if (result && !result.abort)
        offerUndo(`${result.deletedCount} Buchung(en) storniert.`, result.undo, 'Stornieren');
      else if (result?.abort) toast('Die Buchung war bereits geändert oder storniert.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Serverfehler';
      toast(`Stornieren fehlgeschlagen: ${reason}`, undefined, 6000);
    } finally {
      setPending(null);
    }
  }
  return { pending, cancel };
}

type BookingsMode = 'mine' | 'all';

function ModalHeader({
  titleId,
  mode,
  onModeChange,
}: {
  titleId: string;
  mode: BookingsMode;
  onModeChange: (mode: BookingsMode) => void;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-4 px-6 py-5 sm:px-7">
      <div className="min-w-0 flex-1">
        <h1
          id={titleId}
          className="text-[22px] font-semibold leading-tight tracking-tight text-foreground"
        >
          {mode === 'mine' ? 'Meine Buchungen' : 'Alle Buchungen'}
        </h1>
        <div
          className="mt-2 inline-flex rounded-lg bg-muted p-1"
          role="group"
          aria-label="Buchungsansicht"
        >
          {(['mine', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => onModeChange(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {value === 'mine' ? 'Meine' : 'Alle'}
            </button>
          ))}
        </div>
      </div>
      <Button size="lg" onClick={openNewBooking} disabled={store.get('readOnly')}>
        <Plus className="size-4" /> Neue Buchung
      </Button>
    </header>
  );
}

interface BookingsBodyProps {
  campaigns: readonly MyBookingCampaign[];
  visible: readonly MyBookingCampaign[];
  filter: BookingFilterId;
  query: string;
  expanded: ReadonlySet<string>;
  pending: string | null;
  mode: BookingsMode;
  owner: string;
  owners: readonly string[];
  setFilter: (value: BookingFilterId) => void;
  setQuery: (value: string) => void;
  setOwner: (value: string) => void;
  reset: () => void;
  toggle: (id: string) => void;
  cancel: (campaign: MyBookingCampaign) => Promise<void>;
}

function BookingsBody(props: BookingsBodyProps) {
  const { campaigns, visible, filter, query, expanded, pending, mode, owner, owners } = props;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 border-t border-border bg-muted/30 px-6 pb-6 pt-5 sm:px-7">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <BookingStatusTabs value={filter} campaigns={campaigns} onChange={props.setFilter} />
        {mode === 'all' && (
          <select
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            aria-label="Buchungen nach Person filtern"
            value={owner}
            onChange={(event) => props.setOwner(event.target.value)}
          >
            <option value="">Alle Personen ({campaigns.length})</option>
            {owners.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <div className="relative ml-auto w-full sm:w-[19rem]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => props.setQuery(event.target.value)}
            placeholder="Buchungsgruppe oder Gerät"
            aria-label="Buchungsgruppe oder Gerät suchen"
            className="h-10 pl-10"
          />
        </div>
      </div>
      {(filter !== 'alle' || query.trim()) && visible.length > 0 && (
        <p className="shrink-0 px-1 text-[13px] text-muted-foreground">
          {visible.length} von {campaigns.length} Buchungen
        </p>
      )}
      {visible.length ? (
        <CampaignList
          campaigns={visible}
          query={query}
          expanded={expanded}
          pending={pending}
          showOwner={mode === 'all'}
          onToggle={props.toggle}
          onCancel={(item) => void props.cancel(item)}
        />
      ) : (
        <EmptyBookings
          narrowed={filter !== 'alle' || !!query.trim()}
          query={query}
          onReset={props.reset}
        />
      )}
    </div>
  );
}

export function MyBookingsModal({ initialMode = 'mine' }: { initialMode?: BookingsMode } = {}) {
  useStoreUpdates();
  const titleId = useId();
  const [filter, setFilter] = useState<BookingFilterId>('alle');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<BookingsMode>(initialMode);
  const [owner, setOwner] = useState('');
  const { expanded, toggle } = useExpandedCampaigns();
  const today = todayAsIsoDateString();
  const data = store.get('data')!;
  const allCampaigns = computeBookingCampaigns(data.machines, data.bookings, today);
  const campaigns =
    mode === 'mine'
      ? computeMyBookingCampaigns(data.machines, data.bookings, store.get('user'), today)
      : allCampaigns;
  const owners = [...new Set(allCampaigns.map((campaign) => campaign.owner))].sort((a, b) =>
    a.localeCompare(b, 'de'),
  );
  const visible = filterMyBookingCampaigns(campaigns, filter, query).filter(
    (campaign) => !owner || campaign.owner === owner,
  );
  const { pending, cancel } = useCampaignCancellation(today);
  const reset = () => {
    setFilter('alle');
    setQuery('');
    setOwner('');
  };
  const bodyProps = {
    campaigns,
    visible,
    filter,
    query,
    expanded,
    pending,
    mode,
    owner,
    owners,
    setFilter,
    setQuery,
    setOwner,
    reset,
    toggle,
    cancel,
  };
  return (
    <AppDialog size="xl" labelledBy={titleId} className="mybookings max-w-[1120px] font-sans">
      <ModalHeader
        titleId={titleId}
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          setOwner('');
        }}
      />
      <BookingsBody {...bodyProps} />
    </AppDialog>
  );
}

export function openMyBookings(): void {
  if (!store.get('user')) {
    askUserName(false);
    return;
  }
  openReactModal(<MyBookingsModal />);
}

export function openBookings(initialMode: BookingsMode = 'mine'): void {
  if (!store.get('user')) {
    askUserName(false);
    return;
  }
  openReactModal(<MyBookingsModal initialMode={initialMode} />);
}
