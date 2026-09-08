import type { MyBookingCampaign, MyBookingStatus } from '../views/my-bookings.ts';

export type BookingFilterId = 'alle' | MyBookingStatus;

const FILTERS: { id: BookingFilterId; label: string }[] = [
  { id: 'alle', label: 'Alle' },
  { id: 'aktiv', label: 'Aktiv' },
  { id: 'geplant', label: 'Geplant' },
  { id: 'abgeschlossen', label: 'Abgeschlossen' },
];

export function BookingStatusTabs({
  value,
  campaigns,
  onChange,
}: {
  value: BookingFilterId;
  campaigns: readonly MyBookingCampaign[];
  onChange: (value: BookingFilterId) => void;
}) {
  const counts = Object.fromEntries(
    FILTERS.map(({ id }) => [
      id,
      id === 'alle' ? campaigns.length : campaigns.filter((item) => item.status === id).length,
    ]),
  ) as Record<BookingFilterId, number>;
  return (
    <div
      role="tablist"
      aria-label="Buchungsstatus"
      className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-muted p-1"
    >
      {FILTERS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${value === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {item.label}
          <span className="font-mono text-[13px] tabular-nums text-muted-foreground/70">
            {counts[item.id]}
          </span>
        </button>
      ))}
    </div>
  );
}
