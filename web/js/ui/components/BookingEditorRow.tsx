import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, MoreHorizontal, Repeat2, Trash2 } from 'lucide-react';
import { cn } from 'cn';
import { parseIsoDateString } from '../../../../shared/dates.ts';
import { getMachineCategory } from '../../core/machines.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { store } from '../../store-instance.ts';
import {
  bookingEditBlock,
  resizeBookingEditRow,
  shiftBookingEditRows,
  toggleBookingEditDate,
  type BookingEditModel,
  type BookingEditRow,
} from '../booking-edit.ts';

const CELL_WIDTH = 34;
const HANDLE_WIDTH = 7;
export type BookingBarDragMode = 'move' | 'resize-start' | 'resize-end' | 'all';

const machineName = (id: string) =>
  store.get('data')!.machines.find((machine) => machine.id === id)?.name || `⟨${id}⟩`;
const dayTitle = (date: string) =>
  parseIsoDateString(date).toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
const isWeekendDate = (date: string) => [0, 6].includes(parseIsoDateString(date).getUTCDay());

interface RowMenuProps {
  row: BookingEditRow;
  rows: readonly BookingEditRow[];
  campaignDates: readonly string[];
  onChange: (rows: BookingEditRow[]) => void;
}

function replaceRow(rows: readonly BookingEditRow[], id: string, replacement: BookingEditRow) {
  return rows.map((row) =>
    row.machineId === id ? replacement : { ...row, dates: [...row.dates] },
  );
}

function RowMenuOptions({ row, rows, campaignDates, onChange }: RowMenuProps) {
  const alternatives = store
    .get('data')!
    .machines.filter(
      (machine) =>
        getMachineCategory(machine) === row.category &&
        !rows.some((candidate) => candidate.machineId === machine.id),
    )
    .slice(0, 8);
  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted"
        onClick={() =>
          onChange(replaceRow(rows, row.machineId, { ...row, dates: [...campaignDates] }))
        }
      >
        <CalendarDays className="size-4 text-muted-foreground" /> Auf Gruppenzeitraum setzen
      </button>
      {alternatives.map((machine) => (
        <button
          type="button"
          role="menuitem"
          key={machine.id}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted"
          onClick={() =>
            onChange(replaceRow(rows, row.machineId, { ...row, machineId: machine.id }))
          }
        >
          <Repeat2 className="size-4 text-muted-foreground" /> Tauschen gegen {machine.name}
        </button>
      ))}
      {rows.length > 1 && <div className="my-1 h-px bg-border" />}
      {rows.length > 1 && (
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
          onClick={() =>
            onChange(rows.filter((candidate) => candidate.machineId !== row.machineId))
          }
        >
          <Trash2 className="size-4" /> Gerät entfernen
        </button>
      )}
    </>
  );
}

function useRowMenu() {
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
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({
      top: Math.max(12, Math.min(window.innerHeight - 220, rect.bottom + 6)),
      left: Math.max(12, Math.min(window.innerWidth - 272, rect.right - 256)),
    });
    setOpen((current) => !current);
  };
  return { open, setOpen, position, triggerRef, menuRef, toggle };
}

function RowMenu(props: RowMenuProps) {
  const menu = useRowMenu();
  const change = (rows: BookingEditRow[]) => {
    props.onChange(rows);
    menu.setOpen(false);
  };
  return (
    <div className="shrink-0">
      <Button
        ref={menu.triggerRef}
        variant="ghost"
        size="icon"
        className="size-7 rounded-lg"
        aria-label={`Aktionen für ${machineName(props.row.machineId)}`}
        aria-expanded={menu.open}
        aria-haspopup="menu"
        onClick={menu.toggle}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {menu.open &&
        createPortal(
          <div
            ref={menu.menuRef}
            role="menu"
            data-slot="popover-content"
            data-open=""
            className="ui-scope fixed z-[180] min-w-64 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
            style={menu.position}
          >
            <RowMenuOptions {...props} onChange={change} />
          </div>,
          document.getElementById('modal') || document.body,
        )}
    </div>
  );
}

interface BarCellProps {
  row: BookingEditRow;
  rows: readonly BookingEditRow[];
  model: BookingEditModel;
  date: string;
  index: number;
  onRowsChange: (rows: BookingEditRow[]) => void;
  begin: (
    event: React.PointerEvent,
    mode: BookingBarDragMode,
    date: string,
    machineId?: string,
  ) => void;
}

function barMode(first: boolean, last: boolean, offset: number): BookingBarDragMode {
  if (first && offset < HANDLE_WIDTH) return 'resize-start';
  if (last && offset > CELL_WIDTH - HANDLE_WIDTH) return 'resize-end';
  return 'move';
}

function barCellClasses(
  date: string,
  booked: boolean,
  first: boolean,
  last: boolean,
  kind?: string,
) {
  return cn(
    'relative h-8 border-r border-border/60',
    isWeekendDate(date) && 'bg-muted/70',
    kind === 'maintenance' && 'bg-brand/20',
    kind === 'foreign' && 'booking-editor-busy',
    !booked && !kind && 'hover:bg-primary/10',
    booked && 'cursor-grab',
    booked && (first || last) && 'cursor-ew-resize',
  );
}

function BarCell({ row, rows, model, date, index, onRowsChange, begin }: BarCellProps) {
  const booked = row.dates.includes(date);
  const first = booked && !row.dates.includes(model.days[index - 1]!);
  const last = booked && !row.dates.includes(model.days[index + 1]!);
  const block = bookingEditBlock(store.get('data')!, model, row.machineId, date);
  const click = (event: React.PointerEvent) => {
    if (booked) begin(event, barMode(first, last, event.nativeEvent.offsetX), date, row.machineId);
    else onRowsChange(toggleBookingEditDate(store.get('data')!, model, rows, row.machineId, date));
  };
  return (
    <div
      title={`${machineName(row.machineId)} · ${dayTitle(date)}${block ? ` · ${block.label}` : ''}`}
      className={barCellClasses(date, booked, first, last, block?.kind)}
      onPointerDown={click}
    >
      {booked && (
        <span
          className={cn(
            'absolute inset-y-1 left-0 right-0',
            block ? 'bg-destructive/75' : 'bg-primary/85',
            first && 'left-0.5 rounded-l-md',
            last && 'right-0.5 rounded-r-md',
          )}
        />
      )}
    </div>
  );
}

export interface BookingEditorRowProps {
  row: BookingEditRow;
  rows: readonly BookingEditRow[];
  model: BookingEditModel;
  campaignDates: readonly string[];
  onRowsChange: (rows: BookingEditRow[]) => void;
  begin: BarCellProps['begin'];
}

export function BookingEditorRow(props: BookingEditorRowProps) {
  const keyDown = (event: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    if (!event.shiftKey) {
      props.onRowsChange(
        shiftBookingEditRows(props.rows, delta, props.row.machineId, props.model.days),
      );
      return;
    }
    const index = Math.max(
      0,
      Math.min(
        props.model.days.length - 1,
        props.model.days.indexOf(props.row.dates.at(-1)!) + delta,
      ),
    );
    props.onRowsChange(
      resizeBookingEditRow(
        store.get('data')!,
        props.model,
        props.rows,
        props.row.machineId,
        'end',
        props.model.days[index]!,
      ),
    );
  };
  return (
    <>
      <div
        tabIndex={0}
        onKeyDown={keyDown}
        aria-label={`${machineName(props.row.machineId)} – Pfeiltasten verschieben, Umschalt und Pfeil dehnt`}
        className="sticky left-0 z-20 flex h-8 items-center gap-2 border-r border-border bg-card pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {machineName(props.row.machineId)}
        </span>
        <RowMenu
          row={props.row}
          rows={props.rows}
          campaignDates={props.campaignDates}
          onChange={props.onRowsChange}
        />
      </div>
      {props.model.days.map((date, index) => (
        <BarCell {...props} date={date} index={index} key={date} />
      ))}
    </>
  );
}
