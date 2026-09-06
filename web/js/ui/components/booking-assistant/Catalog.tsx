import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Star } from 'lucide-react';
import { cn } from 'cn';
import { Checkbox } from './primitives.tsx';
import { Label } from './primitives.tsx';
import { type Device } from '../../../core/booking-assistant-types.ts';
import { type CatalogCategory } from '../../../core/booking-assistant-types.ts';
import { SECTION_LABEL_CLASS } from './styles.ts';

export function CatalogRow({
  device,
  selected,
  onToggle,
}: {
  device: Device;
  selected: boolean;
  onToggle: (deviceId: string) => void;
}) {
  const id = React.useId();
  /* Bewusst <Label> um die <Checkbox>: dadurch ist die ganze Zeile klickbar,
     ohne ein `sr-only`-Input zu verstecken. Ein `sr-only`-Element ist
     `position: absolute` und würde am nächsten positionierten Vorfahren
     hängen — hier der ScrollArea-Container. Beim Fokussieren springt der
     Scroll dann an den Listenanfang. */
  return (
    <Label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer select-none items-center gap-3 rounded-lg border px-3 py-2.5 font-normal transition-colors',
        selected ? 'border-primary/45 bg-primary/[0.08]' : 'border-transparent hover:bg-muted',
      )}
    >
      <Checkbox
        id={id}
        checked={selected}
        onCheckedChange={() => onToggle(device.id)}
        className="size-5 rounded-[6px]"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{device.name}</span>
        <span className="mt-0.5 block truncate font-mono text-[11px] tracking-tight text-muted-foreground">
          {device.code} · {device.lab}
        </span>
      </span>
    </Label>
  );
}

export function CatalogCategorySection({
  category,
  devices,
  open,
  onToggleOpen,
  selectedIds,
  onToggleDevice,
}: {
  category: CatalogCategory;
  devices: Device[];
  open: boolean;
  onToggleOpen: (categoryId: string) => void;
  selectedIds: string[];
  onToggleDevice: (deviceId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggleOpen(category.id)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {category.starred && <Star className="size-3.5 shrink-0 fill-brand text-brand" />}
        <span className={SECTION_LABEL_CLASS}>{category.label}</span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {devices.length}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-1">
          {devices.map((device) => (
            <CatalogRow
              key={device.id}
              device={device}
              selected={selectedIds.includes(device.id)}
              onToggle={onToggleDevice}
            />
          ))}
        </div>
      )}
    </section>
  );
}
