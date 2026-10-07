import { useEffect, useLayoutEffect, useRef, useState } from 'react';
/* eslint-disable max-lines, max-lines-per-function -- pointer gesture state stays co-located with the editor grid. */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from 'cn';
import {
  addDays,
  formatDateAsIsoString,
  getAllDaysInRange,
  parseIsoDateString,
} from '../../../../shared/dates.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { store } from '../../store-instance.ts';
import {
  cloneBookingEditRows,
  paintBookingEditDates,
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
  extendAxis: (days: string[]) => void,
) {
  const modelRef = useRef(model);
  modelRef.current = model;
  const [preview, setPreview] = useState<BookingEditRow[] | null>(null);
  const previewRef = useRef<BookingEditRow[] | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  useEffect(() => () => cleanupRef.current(), []);
  const begin = (
    event: React.PointerEvent,
    mode: BookingBarDragMode,
    startDate: string,
    machineId?: string,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanupRef.current();
    previewRef.current = null;
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
      if (!state || (!state.moved && Math.abs(pointer.clientX - state.startX) < 5)) return;
      state.moved = true;
      const delta = Math.round((pointer.clientX - state.startX) / CELL_WIDTH);
      const movingDates = state.source
        .filter((row) => !state.machineId || row.machineId === state.machineId)
        .flatMap((row) => row.dates)
        .sort();
      const first = formatDateAsIsoString(addDays(parsedDay(movingDates[0]!), delta));
      const last = formatDateAsIsoString(addDays(parsedDay(movingDates.at(-1)!), delta));
      const current = modelRef.current;
      const axisFirst = first < current.days[0]! ? first : current.days[0]!;
      const axisLast = last > current.days.at(-1)! ? last : current.days.at(-1)!;
      const expanded = { ...current, days: [...getAllDaysInRange(axisFirst, axisLast)] };
      if (expanded.days.length !== current.days.length) {
        modelRef.current = expanded;
        extendAxis(expanded.days);
      }
      const next = dragPreview(state, delta, expanded);
      previewRef.current = next;
      setPreview(next);
    };
    const up = () => {
      const state = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (previewRef.current) setRows(previewRef.current);
      previewRef.current = null;
      setPreview(null);
      if (state && !state.moved && state.mode === 'move' && state.machineId)
        setRows(
          toggleBookingEditDate(store.get('data')!, model, rows, state.machineId, state.startDate),
        );
    };
    const cancel = () => {
      cleanupRef.current();
      dragRef.current = null;
      previewRef.current = null;
      setPreview(null);
    };
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };
  return { view: preview || rows, begin };
}

function DayHeader({ date }: { date: string }) {
  const parsed = parsedDay(date);
  return (
    <div
      className={cn(
        'flex h-10 flex-col items-center justify-center border-r border-border/60',
        isWeekendDate(date) && 'bg-gray-200 dark:bg-gray-700',
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
              isWeekendDate(date) && 'bg-gray-200 dark:bg-gray-700',
              covered && 'cursor-grab',
            )}
            onPointerDown={(event) => covered && begin(event, 'all', date)}
          >
            {covered && (
              <span
                className={cn(
                  'absolute inset-x-0 inset-y-2',
                  isWeekendDate(date) ? 'bg-gray-500 dark:bg-gray-400' : 'bg-primary/25',
                )}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export function BookingEditorGrid({ model: initialModel, rows, setRows }: EditorGridProps) {
  const [axis, setAxis] = useState(initialModel.days);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousStart = useRef(axis[0]!);
  useLayoutEffect(() => {
    const inserted = Math.round(
      (parsedDay(previousStart.current).getTime() - parsedDay(axis[0]!).getTime()) / 86_400_000,
    );
    if (inserted > 0 && scrollRef.current) scrollRef.current.scrollLeft += inserted * CELL_WIDTH;
    previousStart.current = axis[0]!;
  }, [axis]);
  const model = { ...initialModel, days: axis };
  const extend = (direction: number) =>
    setAxis((days) => [
      ...getAllDaysInRange(
        direction < 0 ? formatDateAsIsoString(addDays(parsedDay(days[0]!), -14)) : days[0]!,
        direction > 0 ? formatDateAsIsoString(addDays(parsedDay(days.at(-1)!), 14)) : days.at(-1)!,
      ),
    ]);
  const headerCleanup = useRef<() => void>(() => {});
  useEffect(() => () => headerCleanup.current(), []);
  const [fill, setFill] = useState(true);
  const paintRef = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    const end = () => {
      paintRef.current = false;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);
  const paint = (ids: string[], days: string[]) => {
    const next = paintBookingEditDates(store.get('data')!, model, rowsRef.current, ids, days, fill);
    rowsRef.current = next;
    setRows(next);
  };
  const beginHeader = (event: React.PointerEvent, date: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    headerCleanup.current();
    const startX = event.clientX;
    const startIndex = model.days.indexOf(date);
    const source = cloneBookingEditRows(rowsRef.current);
    const apply = (clientX: number) => {
      const index = Math.max(
        0,
        Math.min(model.days.length - 1, startIndex + Math.round((clientX - startX) / CELL_WIDTH)),
      );
      const days = model.days.slice(Math.min(startIndex, index), Math.max(startIndex, index) + 1);
      const next = paintBookingEditDates(
        store.get('data')!,
        model,
        source,
        source.map((row) => row.machineId),
        days,
        fill,
      );
      rowsRef.current = next;
      setRows(next);
    };
    const move = (pointer: PointerEvent) => apply(pointer.clientX);
    const end = () => headerCleanup.current();
    headerCleanup.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    apply(startX);
  };
  const { view, begin } = useBarDrag(model, rows, setRows, setAxis);
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
      paintRow={(event, start) => {
        if (start) {
          if (event.button !== 0) return;
          event.preventDefault();
          paintRef.current = true;
        }
        if (paintRef.current) paint([row.machineId], dates);
      }}
    />
  );
  return (
    <div ref={scrollRef} className="min-h-0 overflow-auto px-6 py-4 sm:px-7">
      <div className="mb-3 flex items-center gap-2">
        <Button variant="outline" onClick={() => extend(-1)}>
          14 Tage davor
        </Button>
        <Button variant="outline" onClick={() => extend(1)}>
          14 Tage danach
        </Button>
        <Button
          variant={fill ? 'default' : 'outline'}
          aria-pressed={fill}
          onClick={() => setFill(true)}
        >
          Füllen
        </Button>
        <Button
          variant={!fill ? 'default' : 'outline'}
          aria-pressed={!fill}
          onClick={() => setFill(false)}
        >
          Entfernen
        </Button>
        <span className="text-xs text-muted-foreground">
          Über Tagesköpfe oder Gerätenamen ziehen
        </span>
      </div>
      <div
        className="grid min-w-max items-center gap-y-1"
        style={{ gridTemplateColumns: `13.5rem repeat(${model.days.length}, ${CELL_WIDTH}px)` }}
      >
        <div className="sticky left-0 z-20 bg-card" />
        {model.days.map((date, index) => {
          if (index && date.slice(0, 7) === model.days[index - 1]!.slice(0, 7)) return null;
          const count = model.days.filter((day) => day.slice(0, 7) === date.slice(0, 7)).length;
          return (
            <div
              key={date}
              className="border-b border-border px-1 py-2 text-sm font-semibold"
              style={{ gridColumn: `span ${count}` }}
            >
              {parsedDay(date).toLocaleDateString('de-DE', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </div>
          );
        })}
        <div className="sticky left-0 z-20 h-10 bg-card" />
        {model.days.map((date) => (
          <div
            key={date}
            data-editor-day={date}
            className="touch-none select-none cursor-crosshair"
            onPointerDown={(event) => beginHeader(event, date)}
          >
            <DayHeader date={date} />
          </div>
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
