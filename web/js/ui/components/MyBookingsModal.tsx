import { useEffect, useId, useMemo, useReducer, useState } from 'react';
/* eslint-disable max-lines, max-lines-per-function -- the retained list draft shares the modal's view state. */
import { ArrowDownUp, Inbox, Plus, Search } from 'lucide-react';
import type { BookingData } from '../../../../shared/types.ts';
import {
  formatDateShort,
  formatTimestamp,
  mondayOfDate,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../../shared/dates.ts';
import { deleteOwnCells, type CellUndo } from '../../core/bookings.ts';
import { getMachineCategory } from '../../core/machines.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { Badge } from '../../components/ui/badge.tsx';
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
import {
  BookingCampaignActions,
  BookingCampaignDetails,
  MyBookingCampaignCard,
} from './MyBookingsRun.tsx';
import { openBookingEditor } from './BookingEditorModal.tsx';
import { BookingStatusTabs, type BookingFilterId } from './BookingStatusTabs.tsx';
import {
  computeBookingCampaigns,
  computeMyBookingCampaigns,
  filterMyBookingCampaigns,
  sortBookingCampaigns,
  type AllBookingsSort,
  type MyBookingCampaign,
  type SortDirection,
} from '../views/my-bookings.ts';

/** A modest page keeps the "All" view responsive without making navigation tedious. */
const CAMPAIGNS_PER_PAGE = 25;

function useStoreUpdates(): number {
  const [version, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const rerenderForBookingChange = () => rerender();
    const unsubscribe = store.subscribe(rerenderForBookingChange);
    // Cell writes deliberately patch only affected grid DOM nodes. This lightweight event keeps
    // the cached campaign overview in sync without forcing a full grid repaint.
    window.addEventListener('booking-data-change', rerenderForBookingChange);
    return () => {
      unsubscribe();
      window.removeEventListener('booking-data-change', rerenderForBookingChange);
    };
  }, []);
  return version;
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
  sort,
  sortDirection,
  onSort,
  onToggle,
  onCancel,
}: ListProps) {
  const user = store.get('user').trim().toLowerCase();
  return (
    <ScrollArea className="-mr-3 min-h-0 flex-[1_1_24rem] pr-3">
      {sort && sortDirection && onSort && (
        <CampaignCardColumnHeaders
          showOwner={showOwner}
          sort={sort}
          direction={sortDirection}
          onSort={onSort}
        />
      )}
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

function CampaignCardColumnHeaders({
  showOwner,
  sort,
  direction,
  onSort,
}: {
  showOwner: boolean;
  sort: AllBookingsSort;
  direction: SortDirection;
  onSort: (sort: AllBookingsSort) => void;
}) {
  return (
    <div
      className={`mb-2 hidden items-center px-4 sm:grid sm:gap-5 ${showOwner ? 'sm:grid-cols-[minmax(18rem,1fr)_11rem_16rem_8rem_2.5rem]' : 'sm:grid-cols-[minmax(18rem,1fr)_16rem_8rem_2.5rem]'}`}
    >
      <div className="flex h-7 items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Buchungsgruppe
        </span>
        <TableSortButton
          compact
          label="Termin"
          value="scheduled"
          sort={sort}
          direction={direction}
          onSort={onSort}
        />
      </div>
      {showOwner && (
        <TableSortButton
          label="Gebucht von"
          value="owner"
          sort={sort}
          direction={direction}
          onSort={onSort}
        />
      )}
      <TableSortButton
        label="Gebucht am"
        value="created"
        sort={sort}
        direction={direction}
        onSort={onSort}
      />
      <TableSortButton
        label="Status"
        value="status"
        sort={sort}
        direction={direction}
        onSort={onSort}
      />
      <span aria-hidden="true" />
    </div>
  );
}

const STATUS_LABEL = { aktiv: 'Aktiv', geplant: 'Geplant', abgeschlossen: 'Abgeschlossen' };

function TableSortButton({
  label,
  value,
  sort,
  direction = 'asc',
  onSort,
  compact = false,
}: {
  label: string;
  value: AllBookingsSort;
  sort: AllBookingsSort;
  direction?: SortDirection;
  onSort: (sort: AllBookingsSort) => void;
  compact?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`${compact ? 'w-auto' : 'w-full justify-center'} h-7 gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground`}
      aria-pressed={sort === value}
      title={`Nach ${label.toLowerCase()} ${sort === value && direction === 'asc' ? 'absteigend' : 'aufsteigend'} sortieren`}
      onClick={() => onSort(value)}
    >
      {label}
      <ArrowDownUp
        className={`size-3 ${sort === value ? `text-foreground ${direction === 'desc' ? 'rotate-180' : ''}` : 'text-muted-foreground/60'}`}
      />
    </Button>
  );
}

function campaignDates(campaign: MyBookingCampaign): string {
  const first = formatDateShort(parseIsoDateString(campaign.dates[0]!));
  const last = formatDateShort(parseIsoDateString(campaign.dates[campaign.dates.length - 1]!));
  return first === last ? first : `${first} – ${last}`;
}

/** Experimental dense overview for all bookings. The card presentation remains available while
 * this table-style layout is evaluated. */
// Kept as the reversible internal list draft; card layout is the active presentation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AllBookingsListDraft({
  campaigns,
  query,
  expanded,
  pending,
  sort,
  onSort,
  onToggle,
  onCancel,
}: Omit<ListProps, 'showOwner'> & {
  sort: AllBookingsSort;
  onSort: (sort: AllBookingsSort) => void;
}) {
  const user = store.get('user').trim().toLowerCase();
  return (
    <ScrollArea className="-mr-3 min-h-0 flex-[1_1_24rem] pr-3">
      <div
        role="table"
        aria-label="Buchungsgruppen als Liste"
        className="min-w-[920px] overflow-hidden rounded-xl border border-border bg-background"
      >
        <div
          role="row"
          className="grid grid-cols-[25%_14%_20%_8%_14%_15%_auto] items-center gap-3 border-b border-border bg-muted/50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          <span>Buchungsgruppe</span>
          <TableSortButton label="Gebucht von" value="owner" sort={sort} onSort={onSort} />
          <span>Bereich</span>
          <span>Geräte</span>
          <TableSortButton label="Termin" value="scheduled" sort={sort} onSort={onSort} />
          <TableSortButton label="Gebucht am" value="created" sort={sort} onSort={onSort} />
          <span className="sr-only">Aktionen</span>
        </div>
        {campaigns.map((campaign) => {
          const owned = campaign.owner.trim().toLowerCase() === user;
          const panelId = `booking-group-${campaign.id}`;
          const isExpanded = expanded.has(campaign.id) || deviceMatches(campaign, query);
          const areas = [...new Set(campaign.machines.map((machine) => machine.group))].join(', ');
          return (
            <div key={campaign.id} className="border-b border-border last:border-b-0">
              <div
                role="row"
                className="grid grid-cols-[25%_14%_20%_8%_14%_15%_auto] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/40"
              >
                <button
                  type="button"
                  className="min-w-0 truncate text-left font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                  onClick={() => onToggle(campaign.id)}
                >
                  {isExpanded ? '⌄' : '›'} <span className="ml-1">{campaign.title}</span>
                </button>
                <span className="truncate text-muted-foreground">{campaign.owner}</span>
                <span className="truncate text-muted-foreground" title={areas}>
                  {areas}
                </span>
                <span className="text-muted-foreground">{campaign.machines.length}</span>
                <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                  {campaignDates(campaign)}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                  {campaign.createdAt ? formatTimestamp(campaign.createdAt) : '—'}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[11px]">
                    {STATUS_LABEL[campaign.status]}
                  </Badge>
                  <BookingCampaignActions
                    campaign={campaign}
                    pending={pending === campaign.id}
                    readOnly={store.get('readOnly')}
                    owned={owned}
                    onGoto={() =>
                      owned ? openBookingEditor(campaign, repeatBooking) : gotoCampaign(campaign)
                    }
                    onRepeat={() => repeatBooking(campaign)}
                    onCancel={() => onCancel(campaign)}
                  />
                </div>
              </div>
              {isExpanded && (
                <BookingCampaignDetails
                  campaign={campaign}
                  panelId={panelId}
                  highlight={query.trim().toLowerCase()}
                  showBookingMetadata={false}
                />
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

interface ListProps {
  campaigns: readonly MyBookingCampaign[];
  query: string;
  expanded: ReadonlySet<string>;
  pending: string | null;
  showOwner: boolean;
  sort?: AllBookingsSort;
  sortDirection?: SortDirection;
  onSort?: (sort: AllBookingsSort) => void;
  onToggle: (id: string) => void;
  onCancel: (campaign: MyBookingCampaign) => void;
}

function CampaignPagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  const first = (page - 1) * CAMPAIGNS_PER_PAGE + 1;
  const last = Math.min(page * CAMPAIGNS_PER_PAGE, total);
  return (
    <nav
      className="flex shrink-0 items-center justify-between gap-3 px-1 text-[13px] text-muted-foreground"
      aria-label="Seitennavigation für Buchungen"
    >
      <span className="tabular-nums">
        {first}–{last} von {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
        >
          Zurück
        </Button>
        <span className="min-w-20 text-center tabular-nums">
          Seite {page} von {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page === pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Weiter
        </Button>
      </div>
    </nav>
  );
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

function ModalHeader({ titleId, mode }: { titleId: string; mode: BookingsMode }) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-4 px-6 py-5 sm:px-7">
      <div className="min-w-0 flex-1">
        <h1
          id={titleId}
          className="text-[22px] font-semibold leading-tight tracking-tight text-foreground"
        >
          {mode === 'mine' ? 'Meine Buchungen' : 'Alle Buchungen'}
        </h1>
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
  sort: AllBookingsSort;
  sortDirection: SortDirection;
  page: number;
  pageCount: number;
  pageCampaigns: readonly MyBookingCampaign[];
  totalBookingGroups: number;
  setFilter: (value: BookingFilterId) => void;
  setQuery: (value: string) => void;
  setSort: (value: AllBookingsSort) => void;
  setPage: (page: number) => void;
  reset: () => void;
  toggle: (id: string) => void;
  cancel: (campaign: MyBookingCampaign) => Promise<void>;
}

function BookingsBody(props: BookingsBodyProps) {
  const {
    campaigns,
    visible,
    filter,
    query,
    expanded,
    pending,
    mode,
    sort,
    sortDirection,
    page,
    pageCount,
    pageCampaigns,
    totalBookingGroups,
  } = props;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 border-t border-border bg-muted/30 px-6 pb-6 pt-5 sm:px-7">
      <div className="grid shrink-0 gap-3 sm:grid-cols-[minmax(0,1fr)_19rem] sm:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:flex-nowrap">
          <BookingStatusTabs value={filter} campaigns={campaigns} onChange={props.setFilter} />
        </div>
        <div className="relative w-full">
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
      {mode === 'all' && (
        <p className="shrink-0 px-1 text-[13px] text-muted-foreground">
          {filter !== 'alle' || query.trim()
            ? `${visible.length} von ${totalBookingGroups} Buchungsgruppen`
            : `${totalBookingGroups} Buchungsgruppen`}
        </p>
      )}
      {mode === 'mine' && (filter !== 'alle' || query.trim()) && visible.length > 0 && (
        <p className="shrink-0 px-1 text-[13px] text-muted-foreground">
          {visible.length} von {campaigns.length} Buchungen
        </p>
      )}
      {visible.length ? (
        <CampaignList
          campaigns={pageCampaigns}
          query={query}
          expanded={expanded}
          pending={pending}
          showOwner={mode === 'all'}
          sort={sort}
          sortDirection={sortDirection}
          onSort={props.setSort}
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
      <CampaignPagination
        page={page}
        pageCount={pageCount}
        total={visible.length}
        onPageChange={props.setPage}
      />
    </div>
  );
}

export function MyBookingsModal({ initialMode = 'mine' }: { initialMode?: BookingsMode } = {}) {
  const storeVersion = useStoreUpdates();
  const titleId = useId();
  const [filter, setFilter] = useState<BookingFilterId>('aktiv');
  const [query, setQuery] = useState('');
  const mode = initialMode;
  const [sort, setSort] = useState<AllBookingsSort>('scheduled');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);
  const { expanded, toggle } = useExpandedCampaigns();
  const today = todayAsIsoDateString();
  const data = store.get('data')!;
  // Building all campaigns is the expensive part. Cache it across typing, sorting and page
  // changes; only booking-state notifications (or switching to this tab) rebuild it.
  const allCampaigns = useMemo(
    () => (mode === 'all' ? computeBookingCampaigns(data.machines, data.bookings, today) : []),
    [data, mode, storeVersion, today],
  );
  const myCampaigns = useMemo(
    () => computeMyBookingCampaigns(data.machines, data.bookings, store.get('user'), today),
    [data, storeVersion, today],
  );
  const campaigns = mode === 'mine' ? myCampaigns : allCampaigns;
  const totalBookingGroups = allCampaigns.length;
  // Keep filtering and sorting out of page navigation too. `totalBookingGroups` comes from the
  // cached authoritative campaign array, so reading it is O(1), not another booking scan.
  const visible = useMemo(
    () =>
      sortBookingCampaigns(filterMyBookingCampaigns(campaigns, filter, query), sort, sortDirection),
    [campaigns, filter, mode, query, sort, sortDirection],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / CAMPAIGNS_PER_PAGE));
  // A narrowed result can make the selected page invalid; clamp it for this render until the
  // next user interaction resets it to page one.
  const currentPage = Math.min(page, pageCount);
  const pageCampaigns = visible.slice(
    (currentPage - 1) * CAMPAIGNS_PER_PAGE,
    currentPage * CAMPAIGNS_PER_PAGE,
  );
  const { pending, cancel } = useCampaignCancellation(today);
  const reset = () => {
    setFilter('aktiv');
    setQuery('');
    setPage(1);
  };
  const bodyProps = {
    campaigns,
    visible,
    filter,
    query,
    expanded,
    pending,
    mode,
    sort,
    sortDirection,
    page: currentPage,
    pageCount,
    pageCampaigns,
    totalBookingGroups,
    setFilter: (value: BookingFilterId) => {
      setFilter(value);
      setPage(1);
    },
    setQuery: (value: string) => {
      setQuery(value);
      setPage(1);
    },
    setSort: (value: AllBookingsSort) => {
      setSortDirection((current) =>
        sort === value
          ? current === 'asc'
            ? 'desc'
            : 'asc'
          : value === 'created'
            ? 'desc'
            : 'asc',
      );
      setSort(value);
      setPage(1);
    },
    setPage,
    reset,
    toggle,
    cancel,
  };
  return (
    <AppDialog size="xl" labelledBy={titleId} className="mybookings font-sans">
      <ModalHeader titleId={titleId} mode={mode} />
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
