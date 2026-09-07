import { CalendarIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button } from './primitives.tsx';
import { Label } from './primitives.tsx';
import { useDevices } from './DeviceProvider.tsx';
import { type AvailabilityWindow } from '../../../core/booking-assistant-types.ts';
import { formatDate } from './model.ts';
import { formatDateLong } from './model.ts';
import { NumberInput } from './NumberField.tsx';
import { LABEL_CLASS } from '../app/typography.ts';
import { DeviceSubtitle } from './DeviceSubtitle.tsx';

export function ResultCard({
  window,
  onSelectedDaysChange,
  onBook,
  onShowCalendar,
}: {
  window: AvailabilityWindow;
  onSelectedDaysChange: (windowId: string, days: number) => void;
  onBook: (window: AvailabilityWindow) => void;
  onShowCalendar: (window: AvailabilityWindow) => void;
}) {
  const { minSelectableDays, maxSelectableDays, selectedDays } = window;

  return (
    <li className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <ResultDetails window={window} />

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Label className={LABEL_CLASS}>Buchungstage</Label>
          <div className="flex items-center gap-2">
            <NumberInput
              value={selectedDays}
              min={minSelectableDays}
              max={maxSelectableDays}
              ariaLabel="Buchungstage"
              onChange={(days) => onSelectedDaysChange(window.id, days)}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Im Kalender anzeigen"
              onClick={() => onShowCalendar(window)}
              className="size-9 rounded-lg"
            >
              <CalendarIcon className="size-4" />
            </Button>
            <Button onClick={() => onBook(window)}>Buchen</Button>
          </div>
        </div>
      </div>
    </li>
  );
}
function ResultDetails({ window }: { window: AvailabilityWindow }) {
  const { start, end, openEnded, spanDays, minSelectableDays, maxSelectableDays } = window;
  return (
    <div className="min-w-[16rem] flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatDateLong(start)}
          <span className="mx-1.5 text-muted-foreground">→</span>
          {openEnded ? <span className="text-muted-foreground">offen</span> : formatDateLong(end)}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
            openEnded
              ? 'bg-brand-soft text-brand-foreground'
              : 'bg-secondary text-secondary-foreground',
          )}
        >
          {openEnded ? 'durchgehend frei' : `${spanDays} Arbeitstage frei`}
        </span>
      </div>

      {/* grün = direkt gewähltes Gerät · orange = aus einer Bedarfsgruppe aufgelöst */}
      <ResultDevices devices={window.devices} />

      <p className="mt-2.5 text-[11px] tabular-nums text-muted-foreground">
        {openEnded
          ? `ab ${formatDate(start)} nach aktuellem Buchungsstand durchgehend frei`
          : `freies Fenster · ${spanDays} Arbeitstage`}
        {' · '}
        {minSelectableDays === maxSelectableDays
          ? `genau ${minSelectableDays} Arbeitstage`
          : `${minSelectableDays}–${maxSelectableDays} Arbeitstage wählbar`}
      </p>
    </div>
  );
}
function ResultDevices({ devices }: { devices: AvailabilityWindow['devices'] }) {
  const DEVICES_BY_ID = useDevices();
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {devices.map((resolved, index) => {
        const device = DEVICES_BY_ID[resolved.deviceId]!;
        return (
          <span
            key={`${resolved.deviceId}-${index}`}
            title={resolved.fromGroup ? 'aus einer Bedarfsgruppe gewählt' : undefined}
            className={cn(
              'inline-flex min-w-0 items-center rounded-xl px-3 py-2',
              resolved.fromGroup
                ? 'bg-brand-soft text-brand-foreground'
                : 'bg-secondary text-secondary-foreground',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{device.name}</span>
              <DeviceSubtitle device={device} />
            </span>
          </span>
        );
      })}
    </div>
  );
}
