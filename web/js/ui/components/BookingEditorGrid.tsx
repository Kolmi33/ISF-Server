import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from 'cn';
import { parseIsoDateString } from '../../../../shared/dates.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { store } from '../../store-instance.ts';
import {
  cloneBookingEditRows,
  resizeBookingEditRow,
  shiftBookingEditRows,
  toggleBookingEditDate,
  type BookingEditModel,
  type BookingEditRow,
} from '../booking-edit.ts';
import { BookingEditorRow, type BookingBarDragMode } from './BookingEditorRow.tsx';

const CELL_WIDTH = 34;
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const parsedDay = (date: string) => parseIsoDateString(date);
const isWeekendDate = (date: string) => [0, 6].includes(parsedDay(date).getUTCDay());
const dayTitle = (date: string) =>
  parsedDay(date).toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

interface DragState {
  mode: BookingBarDragMode;
  machineId?: string;
  startX: number;
  startDate: string;
  source: BookingEditRow[];
  moved: boolean;
}

function dragPreview(state: DragState, delta: number, model: BookingEditModel) {
  if (state.mode === 'all') return shiftBookingEditRows(state.source, delta, undefined, model.days);
  if (state.mode === 'move')
    return shiftBookingEditRows(state.source, delta, state.machineId, model.days);
  const row = state.source.find((candidate) => candidate.machineId === state.machineId)!;
  const boundary = state.mode === 'resize-start' ? row.dates[0]! : row.dates.at(-1)!;
  const index = Math.max(0, Math.min(model.days.length - 1, model.days.indexOf(boundary) + delta));
  return resizeBookingEditRow(
    store.get('data')!,
    model,
    state.source,
    state.machineId!,
    state.mode === 'resize-start' ? 'start' : 'end',
    model.days[index]!,
  );
}

function useBarDrag(
  model: BookingEditModel,
  rows: BookingEditRow[],
  setRows: (rows: BookingEditRow[]) => void,
) {
  const [preview, setPreview] = useState<BookingEditRow[] | null>(null);
  const previewRef = useRef<BookingEditRow[] | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const begin = (
    event: React.PointerEvent,
    mode: BookingBarDragMode,
    startDate: string,
    machineId?: string,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      mode,
      machineId,
      startX: event.clientX,
      startDate,
      source: cloneBookingEditRows(rows),
      moved: false,
    };
    const move = (pointer: PointerEvent) => {
      const state = dragRef.current;
      if (!state || Math.abs(pointer.clientX - state.startX) < 5) return;
      state.moved = true;
      const next = dragPreview(
        state,
        Math.round((pointer.clientX - state.startX) / CELL_WIDTH),
        model,
      );
      previewRef.current = next;
      setPreview(next);
    };
    const up = () => {
      const state = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (previewRef.current) setRows(previewRef.current);
      previewRef.current = null;
      setPreview(null);
      if (state && !state.moved && state.mode === 'move' && state.machineId)
        setRows(
          toggleBookingEditDate(store.get('data')!, model, rows, state.machineId, state.startDate),
        );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { view: preview || rows, begin };
}

function DayHeader({ date }: { date: string }) {
  const parsed = parsedDay(date);
  return (
    <div
      className={cn(
        'flex h-10 flex-col items-center justify-center border-r border-border/60',
        isWeekendDate(date) && 'bg-muted/70',
      )}
      title={dayTitle(date)}
    >
      <span className="text-[11px] leading-none text-muted-foreground/70">
        {WEEKDAYS[parsed.getUTCDay()]}
      </span>
      <span className="font-mono text-[13px] leading-none tabular-nums text-foreground">
        {String(parsed.getUTCDate()).padStart(2, '0')}
      </span>
    </div>
  );
}

function SectionLabel({ label, columns }: { label: string; columns: number }) {
  return (
    <>
      <div className="sticky left-0 z-20 bg-card pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="pt-3" style={{ gridColumn: `span ${columns}` }} />
    </>
  );
}

export interface EditorGridProps {
  model: BookingEditModel;
  rows: BookingEditRow[];
  setRows: (rows: BookingEditRow[]) => void;
}

function GroupShiftControls({
  model,
  rows,
  setRows,
}: Pick<EditorGridProps, 'model' | 'rows' | 'setRows'>) {
  return (
    <span className="ml-auto flex gap-1">
      <Button
        variant="outline"
        size="icon"
        className="size-6 rounded-md"
        aria-label="Alles einen Tag früher"
        onClick={() => setRows(shiftBookingEditRows(rows, -1, undefined, model.days))}
      >
        <ChevronLeft className="size-3" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-6 rounded-md"
        aria-label="Alles einen Tag später"
        onClick={() => setRows(shiftBookingEditRows(rows, 1, undefined, model.days))}
      >
        <ChevronRight className="size-3" />
      </Button>
    </span>
  );
}

function GroupBar({
  model,
  rows,
  setRows,
  view,
  begin,
}: EditorGridProps & {
  view: readonly BookingEditRow[];
  begin: (
    event: React.PointerEvent,
    mode: BookingBarDragMode,
    date: string,
    machineId?: string,
  ) => void;
}) {
  return (
    <>
      <div className="sticky left-0 z-20 flex h-8 items-center gap-1 border-r border-border bg-card pr-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Buchungsgruppe
        </span>
        <GroupShiftControls model={model} rows={rows} setRows={setRows} />
      </div>
      {model.days.map((date) => {
        const covered = view.some((row) => row.dates.includes(date));
        return (
          <div
            key={date}
            className={cn(
              'relative h-8 border-r border-border/60',
              isWeekendDate(date) && 'bg-muted/70',
              covered && 'cursor-grab',
            )}
            onPointerDown={(event) => covered && begin(event, 'all', date)}
          >
            {covered && <span className="absolute inset-x-0 inset-y-2 bg-primary/25" />}
          </div>
        );
      })}
    </>
  );
}

export function BookingEditorGrid({ model, rows, setRows }: EditorGridProps) {
  const { view, begin } = useBarDrag(model, rows, setRows);
  const dates = [...new Set(view.flatMap((row) => row.dates))].sort();
  const machines = view.filter((row) => row.category === 'maschine');
  const measurement = view.filter((row) => row.category === 'messtechnik');
  const renderRow = (row: BookingEditRow) => (
    <BookingEditorRow
      key={row.machineId}
      row={row}
      rows={view}
      model={model}
      campaignDates={dates}
      onRowsChange={setRows}
      begin={begin}
    />
  );
  return (
    <div className="overflow-x-auto px-6 py-4 sm:px-7">
      <div
        className="grid min-w-max items-center gap-y-1"
        style={{ gridTemplateColumns: `13.5rem repeat(${model.days.length}, ${CELL_WIDTH}px)` }}
      >
        <div className="sticky left-0 z-20 h-10 bg-card" />
        {model.days.map((date) => (
          <DayHeader date={date} key={date} />
        ))}
        <GroupBar model={model} rows={rows} view={view} setRows={setRows} begin={begin} />
        {!!machines.length && <SectionLabel label="Maschinen" columns={model.days.length} />}
        {machines.map(renderRow)}
        {!!measurement.length && <SectionLabel label="Messtechnik" columns={model.days.length} />}
        {measurement.map(renderRow)}
      </div>
    </div>
  );
}
