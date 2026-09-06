import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Star } from 'lucide-react';
import { cn } from 'cn';
import { Checkbox } from './primitives.tsx';
import { Label } from './primitives.tsx';
import { type Device } from '../../../core/booking-assistant-types.ts';
import { type CatalogCategory } from '../../../core/booking-assistant-types.ts';
import { DeviceSubtitle } from './DeviceSubtitle.tsx';
import { type CatalogEntry } from './useCatalog.ts';
import { type CatalogNode } from './useCatalog.ts';
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
        <DeviceSubtitle device={device} />
      </span>
    </Label>
  );
}

/** Kopfzeile beider Klappebenen — Oberkategorie wie Bereich. */
function FoldHeader({
  label,
  count,
  open,
  starred,
  strong,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  starred?: boolean;
  strong?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {starred && <Star className="size-3.5 shrink-0 fill-brand text-brand" />}
      <span className={cn(SECTION_LABEL_CLASS, strong && 'text-foreground')}>{label}</span>
      <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
        {count}
      </span>
      <ChevronDown
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
          open && 'rotate-180',
        )}
      />
    </button>
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
      <FoldHeader
        label={category.label}
        count={devices.length}
        open={open}
        starred={category.starred}
        strong={!category.section}
        onToggle={() => onToggleOpen(category.id)}
      />

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

/** Oberkategorie: klappt die Bereiche darunter auf, die ihrerseits einzeln klappen. */
export function CatalogSuperSection({
  id,
  label,
  count,
  entries,
  open,
  isOpen,
  onToggleOpen,
  selectedIds,
  onToggleDevice,
}: {
  id: string;
  label: string;
  count: number;
  entries: CatalogEntry[];
  open: boolean;
  isOpen: (categoryId: string) => boolean;
  onToggleOpen: (categoryId: string) => void;
  selectedIds: string[];
  onToggleDevice: (deviceId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <FoldHeader
        label={label}
        count={count}
        open={open}
        strong
        onToggle={() => onToggleOpen(id)}
      />

      {open && (
        <div className="ml-1 flex flex-col gap-3 border-l border-border pl-2.5">
          {entries.map(({ category, devices }) => (
            <CatalogCategorySection
              key={category.id}
              category={category}
              devices={devices}
              open={isOpen(category.id)}
              onToggleOpen={onToggleOpen}
              selectedIds={selectedIds}
              onToggleDevice={onToggleDevice}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Die zwei Ebenen des Katalogs: Oberkategorien mit ihren Bereichen, dazwischen die
 *  Kategorien ohne Oberkategorie (die Favoriten) auf oberster Ebene. */
export function CatalogTree({
  nodes,
  isOpen,
  onToggleOpen,
  selectedIds,
  onToggleDevice,
}: {
  nodes: CatalogNode[];
  isOpen: (id: string) => boolean;
  onToggleOpen: (id: string) => void;
  selectedIds: string[];
  onToggleDevice: (deviceId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {nodes.map((node) =>
        node.kind === 'section' ? (
          <CatalogSuperSection
            key={node.id}
            id={node.id}
            label={node.label}
            count={node.count}
            entries={node.entries}
            open={isOpen(node.id)}
            isOpen={isOpen}
            onToggleOpen={onToggleOpen}
            selectedIds={selectedIds}
            onToggleDevice={onToggleDevice}
          />
        ) : (
          <CatalogCategorySection
            key={node.id}
            category={node.entry.category}
            devices={node.entry.devices}
            open={isOpen(node.id)}
            onToggleOpen={onToggleOpen}
            selectedIds={selectedIds}
            onToggleDevice={onToggleDevice}
          />
        ),
      )}
    </div>
  );
}
