import * as React from 'react';
import { GitMerge } from 'lucide-react';
import { type Device, type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { Button } from './primitives.tsx';
import { Checkbox } from './primitives.tsx';
import { Label } from './primitives.tsx';
import { Popover } from './primitives.tsx';
import { PopoverContent } from './primitives.tsx';
import { PopoverTrigger } from './primitives.tsx';
import { useDevices } from './DeviceProvider.tsx';
import { entryContains } from './plan-tree.ts';

export interface AlternativeCandidate {
  entry: PlanEntry;
  position?: string;
  depth?: number;
}

export function AlternativePicker({
  entry,
  position,
  candidates,
  onGroup,
}: {
  entry: PlanEntry;
  position?: string;
  candidates: AlternativeCandidate[];
  onGroup: (entryId: string, alternativeIds: string[]) => void;
}) {
  const devices = useDevices();
  const sourceName = entryName(entry, devices, position);
  const selection = useAlternativeSelection(entry.id, candidates, onGroup);

  return (
    <Popover open={selection.open} onOpenChange={selection.changeOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={candidates.length === 0}
          aria-label={`Alternativen für ${sourceName} auswählen`}
          title={
            candidates.length > 0
              ? 'Alternativen auswählen (ODER)'
              : 'Kein weiteres Element verfügbar'
          }
          onPointerDown={(event) => event.stopPropagation()}
          className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
        >
          <GitMerge className="size-4" />
        </Button>
      </PopoverTrigger>
      <AlternativeContent
        sourceName={sourceName}
        candidates={candidates}
        selectedIds={selection.selectedIds}
        devices={devices}
        onToggle={selection.toggle}
        onCancel={() => selection.changeOpen(false)}
        onApply={selection.apply}
      />
    </Popover>
  );
}

function AlternativeContent({
  sourceName,
  candidates,
  selectedIds,
  devices,
  onToggle,
  onCancel,
  onApply,
}: {
  sourceName: string;
  candidates: AlternativeCandidate[];
  selectedIds: string[];
  devices: Record<string, Device>;
  onToggle: (entryId: string) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  return (
    <PopoverContent side="left" align="start" className="w-80 overflow-hidden p-0">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">Alternativen auswählen</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          Diese Elemente werden mit {sourceName} als ODER-Gruppe verbunden.
        </p>
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto p-2">
        {candidates.map((candidate) => (
          <AlternativeRow
            key={candidate.entry.id}
            candidate={candidate}
            checked={selectedIds.includes(candidate.entry.id)}
            devices={devices}
            onToggle={onToggle}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/35 px-3 py-2.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="button" size="sm" disabled={selectedIds.length === 0} onClick={onApply}>
          Als ODER gruppieren
        </Button>
      </div>
    </PopoverContent>
  );
}

function useAlternativeSelection(
  entryId: string,
  candidates: AlternativeCandidate[],
  onGroup: (entryId: string, alternativeIds: string[]) => void,
) {
  const [open, setOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setSelectedIds([]);
  };
  const toggle = (id: string) =>
    setSelectedIds((current) => toggleSelection(current, id, candidates));
  const apply = () => {
    if (selectedIds.length === 0) return;
    setOpen(false);
    onGroup(entryId, selectedIds);
  };
  return { open, selectedIds, changeOpen, toggle, apply };
}

/** A group and one of its descendants represent overlapping plan content. Keep the most recent
 * choice and remove any selected ancestor or descendant so applying the picker cannot duplicate
 * a machine. */
export function toggleSelection(
  current: string[],
  id: string,
  candidates: AlternativeCandidate[],
): string[] {
  if (current.includes(id)) return current.filter((candidateId) => candidateId !== id);
  const entry = candidates.find((candidate) => candidate.entry.id === id)?.entry;
  if (!entry) return current;
  return [
    ...current.filter((candidateId) => {
      const selected = candidates.find((candidate) => candidate.entry.id === candidateId)?.entry;
      return selected && !entryContains(entry, selected.id) && !entryContains(selected, entry.id);
    }),
    id,
  ];
}

function AlternativeRow({
  candidate,
  checked,
  devices,
  onToggle,
}: {
  candidate: AlternativeCandidate;
  checked: boolean;
  devices: Record<string, Device>;
  onToggle: (entryId: string) => void;
}) {
  const id = React.useId();
  const name = entryName(candidate.entry, devices, candidate.position);
  return (
    <Label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 font-normal hover:bg-muted"
      style={{ paddingLeft: `${10 + (candidate.depth ?? 0) * 12}px` }}
    >
      <Checkbox id={id} checked={checked} onCheckedChange={() => onToggle(candidate.entry.id)} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{name}</span>
        {candidate.entry.kind === 'group' && (
          <span className="block truncate text-xs text-muted-foreground">
            Gruppe · {deviceNames(candidate.entry, devices).join(', ')}
          </span>
        )}
      </span>
    </Label>
  );
}

function entryName(entry: PlanEntry, devices: Record<string, Device>, position?: string): string {
  if (entry.kind === 'device') return devices[entry.deviceId]?.name ?? entry.deviceId;
  return position ? `Buchungsgruppe ${position}` : 'Buchungsgruppe';
}

function deviceNames(entry: PlanEntry, devices: Record<string, Device>): string[] {
  return entry.kind === 'device'
    ? [devices[entry.deviceId]?.name ?? entry.deviceId]
    : entry.members.flatMap((member) => deviceNames(member, devices));
}
