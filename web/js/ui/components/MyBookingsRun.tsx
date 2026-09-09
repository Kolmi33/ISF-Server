// =======================================================================================
// MY BOOKING CAMPAIGN CARD (web/js/ui/components/MyBookingsRun.tsx)
// =======================================================================================

import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays,
  ChevronDown,
  Eye,
  MoreHorizontal,
  Pencil,
  Repeat2,
  Trash2,
} from 'lucide-react';
import { cn } from 'cn';
import { formatDateShort, parseIsoDateString } from '../../../../shared/dates.ts';
import { getMachineCategory } from '../../core/machines.ts';
import type { MyBookingCampaign, MyBookingStatus } from '../views/my-bookings.ts';
import { Button } from '../../components/ui/app-button.tsx';

const STATUS_META: Record<MyBookingStatus, { label: string; dot: string }> = {
  aktiv: { label: 'Aktiv', dot: 'bg-primary' },
  geplant: { label: 'Geplant', dot: 'bg-sensor' },
  abgeschlossen: { label: 'Abgeschlossen', dot: 'bg-muted-foreground/45' },
};

function dateLabel(date: string, year = true): string {
  const parsed = parseIsoDateString(date);
  if (!year) return formatDateShort(parsed);
  return parsed.toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function rangeLabel(campaign: MyBookingCampaign): string {
  const first = campaign.dates[0]!;
  const last = campaign.dates[campaign.dates.length - 1]!;
  if (first === last) return dateLabel(first);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${dateLabel(first, !sameYear)} – ${dateLabel(last)}`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

interface DeviceChipProps {
  campaign: MyBookingCampaign;
  machineId: string;
  highlight: string;
}

function DeviceChip({ campaign, machineId, highlight }: DeviceChipProps) {
  const machine = campaign.machines.find((candidate) => candidate.id === machineId)!;
  const matches =
    !!highlight &&
    [machine.name, machine.group, machine.id].some((text) =>
      text.toLowerCase().includes(highlight),
    );
  const isMachine = getMachineCategory(machine) === 'maschine';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold leading-none',
        isMachine
          ? 'bg-secondary text-secondary-foreground'
          : 'bg-sensor-soft text-sensor-foreground',
        matches && 'ring-2 ring-brand/60 ring-offset-1 ring-offset-background',
      )}
      title={`${machine.name} · ${machine.group}`}
    >
      {machine.name}
    </span>
  );
}

interface DeviceSectionProps {
  campaign: MyBookingCampaign;
  category: 'maschine' | 'messtechnik';
  title: string;
  highlight: string;
}

function DeviceSection({ campaign, category, title, highlight }: DeviceSectionProps) {
  const machineIds = campaign.machines
    .filter((machine) => getMachineCategory(machine) === category)
    .map((machine) => machine.id);
  if (!machineIds.length) return null;
  return (
    <section>
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h4>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {machineIds.map((machineId) => (
          <DeviceChip
            key={machineId}
            campaign={campaign}
            machineId={machineId}
            highlight={highlight}
          />
        ))}
      </div>
    </section>
  );
}

interface CampaignActionsProps {
  campaign: MyBookingCampaign;
  pending: boolean;
  readOnly: boolean;
  owned: boolean;
  onGoto: () => void;
  onRepeat: () => void;
  onCancel: () => void;
}

function isEditingDisabled({ campaign, pending, readOnly, owned }: CampaignActionsProps): boolean {
  return owned && (readOnly || campaign.status === 'abgeschlossen' || pending);
}

function CampaignActionMenu(props: CampaignActionsProps & { close: () => void }) {
  const { campaign, pending, readOnly, owned, onGoto, onRepeat, onCancel, close } = props;
  const cancellationDisabled = readOnly || !owned || campaign.status === 'abgeschlossen' || pending;
  const editingDisabled = isEditingDisabled(props);
  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        disabled={editingDisabled}
        onClick={() => {
          close();
          onGoto();
        }}
      >
        {owned ? (
          <Pencil className="size-4 text-muted-foreground" />
        ) : (
          <Eye className="size-4 text-muted-foreground" />
        )}{' '}
        {owned ? 'Bearbeiten' : 'Ansehen'}
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        disabled={readOnly}
        onClick={() => {
          close();
          onRepeat();
        }}
      >
        <Repeat2 className="size-4 text-muted-foreground" />
        {owned ? 'Buchung wiederholen' : 'Als Vorlage verwenden'}
      </button>
      {owned && <div className="my-1 h-px bg-border" />}
      {owned && (
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          disabled={cancellationDisabled}
          onClick={() => {
            close();
            onCancel();
          }}
        >
          <Trash2 className="size-4" /> {pending ? 'Wird storniert …' : 'Stornieren'}
        </button>
      )}
    </>
  );
}

function useCampaignActionMenu() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target))
        setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({
      top: Math.max(12, Math.min(window.innerHeight - 132, rect.bottom + 8)),
      left: Math.max(12, Math.min(window.innerWidth - 220, rect.right - 208)),
    });
    setOpen((current) => !current);
  };
  return { open, setOpen, position, triggerRef, menuRef, toggleMenu };
}

function CampaignActions({
  campaign,
  pending,
  readOnly,
  owned,
  onGoto,
  onRepeat,
  onCancel,
}: CampaignActionsProps) {
  const { open, setOpen, position, triggerRef, menuRef, toggleMenu } = useCampaignActionMenu();
  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        className="size-8 rounded-lg"
        aria-label={`Aktionen für ${campaign.title}`}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={pending}
        onClick={toggleMenu}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            data-slot="popover-content"
            data-open=""
            aria-label={`Aktionen für ${campaign.title}`}
            className="ui-scope fixed z-[170] min-w-52 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
            style={position}
          >
            <CampaignActionMenu
              {...{ campaign, pending, readOnly, owned, onGoto, onRepeat, onCancel }}
              close={() => setOpen(false)}
            />
          </div>,
          document.getElementById('modal') || document.body,
        )}
    </>
  );
}

interface MyBookingCampaignCardProps {
  campaign: MyBookingCampaign;
  expanded: boolean;
  highlight: string;
  pending: boolean;
  readOnly: boolean;
  owned?: boolean;
  showOwner?: boolean;
  onToggle: () => void;
  onGoto: () => void;
  onRepeat: () => void;
  onCancel: () => void;
}

function CampaignHeading({ campaign, expanded, panelId, onToggle }: CampaignHeadingProps) {
  const machineCount = campaign.machines.filter(
    (machine) => getMachineCategory(machine) === 'maschine',
  ).length;
  const sensorCount = campaign.machines.length - machineCount;
  const showTechnicalId = campaign.groupId && campaign.title === 'Buchungsgruppe';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={panelId}
      className="group flex min-w-[17rem] flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground">
        <ChevronDown
          className={cn('size-4 transition-transform duration-200', !expanded && '-rotate-90')}
        />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-[15px] font-medium text-foreground">{campaign.title}</span>
          {showTechnicalId && (
            <span className="font-mono text-[13px] tracking-tight text-muted-foreground/75">
              {campaign.id}
            </span>
          )}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
          <CalendarDays className="size-3.5 shrink-0" />
          <span className="font-mono tabular-nums">{rangeLabel(campaign)}</span>
          <span>· {plural(campaign.dates.length, 'Tag', 'Tage')}</span>
          <span>· {plural(machineCount, 'Maschine', 'Maschinen')}</span>
          <span>· {plural(sensorCount, 'Sensor', 'Sensoren')}</span>
        </span>
      </span>
    </button>
  );
}

interface CampaignHeadingProps {
  campaign: MyBookingCampaign;
  expanded: boolean;
  panelId: string;
  onToggle: () => void;
}

function StatusAndActions(props: MyBookingCampaignCardProps) {
  const {
    campaign,
    pending,
    readOnly,
    owned = true,
    showOwner,
    onGoto,
    onRepeat,
    onCancel,
  } = props;
  const status = STATUS_META[campaign.status];
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {showOwner && (
        <span
          className="max-w-40 truncate rounded-lg bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
          title={campaign.owner}
        >
          {owned ? 'ich' : campaign.owner}
        </span>
      )}
      <span className="inline-flex w-fit items-center gap-2 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold leading-none text-muted-foreground">
        <span className={cn('size-1.5 rounded-full', status.dot)} aria-hidden="true" />
        {status.label}
      </span>
      <CampaignActions {...{ campaign, pending, readOnly, owned, onGoto, onRepeat, onCancel }} />
    </div>
  );
}

function CampaignDetails({ campaign, panelId, highlight }: CampaignDetailsProps) {
  return (
    <div
      id={panelId}
      className="grid grid-cols-2 gap-x-10 gap-y-5 border-t border-border px-4 py-4 sm:pl-[3.25rem]"
    >
      <DeviceSection
        campaign={campaign}
        category="maschine"
        title="Maschinen"
        highlight={highlight}
      />
      <DeviceSection
        campaign={campaign}
        category="messtechnik"
        title="Messtechnik"
        highlight={highlight}
      />
      {campaign.note && campaign.note.trim() !== campaign.title.trim() && (
        <p className="text-[13px] text-muted-foreground sm:col-span-2">{campaign.note}</p>
      )}
    </div>
  );
}

interface CampaignDetailsProps {
  campaign: MyBookingCampaign;
  panelId: string;
  highlight: string;
}

export function MyBookingCampaignCard(props: MyBookingCampaignCardProps) {
  const panelId = useId();
  return (
    <li className="rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
        <CampaignHeading
          campaign={props.campaign}
          expanded={props.expanded}
          panelId={panelId}
          onToggle={props.onToggle}
        />
        <StatusAndActions {...props} />
      </div>
      {props.expanded && (
        <CampaignDetails campaign={props.campaign} panelId={panelId} highlight={props.highlight} />
      )}
    </li>
  );
}
