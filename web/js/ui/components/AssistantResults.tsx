// The Assistant's results list (Phase 7 slice B7): free-window runs with an editable "days to
// book" count (clamped to the run's length), a suggested-devices line, a "pin" that collapses
// the modal and filters+centers the grid on the run, and "Buchen…" opening the booking form.
// The scheduling itself (`freeDays`/`groupRuns`/`extendOpenRuns`/`chooseDevicesForTree`) already
// lives in `core/assistant.ts`; `ui/assistant-results.ts` caps/shapes the list. Faithful port of
// legacy `runAssistant`'s results-rendering half.
//
// Shape decision (E2 — flagged): legacy's clamp tooltip is a precisely viewport-positioned
// floating element (`showAsTip`, measuring `getBoundingClientRect`). This keeps the same
// message text and ~2s auto-hide, but renders inline next to the input instead of computing an
// absolute screen position — a cosmetic simplification with no functional difference (the
// number still clamps identically either way).

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { formatDateLong, mondayOfDate, parseIsoDateString } from '../../../../shared/dates.ts';
import { chooseDevicesForTree, type AssistContainer, type IsFree } from '../../core/assistant.ts';
import type { AssistantResultRow } from '../assistant-results.ts';
import { clearSelection } from '../grid-interaction.ts';
import { gotoDate, prependWeek, resetView } from '../grid-scroll.ts';
import { collapseReactModal } from '../modal.tsx';
import { openBookingForm } from './BookingForm.tsx';
import { Icon } from './Icon.tsx';

function rangeText(dates: readonly string[]): string {
  return dates.length === 1
    ? formatDateLong(dates[0]!)
    : `${formatDateLong(dates[0]!)} – ${formatDateLong(dates[dates.length - 1]!)}`;
}

/** Jump to the run's first day, filtered to every device the Assistant considered (not just
 *  this run's picks) — collapsing rather than closing, so the selection/results survive.
 *  Faithful port of legacy's `data-show` handler. */
function gotoRun(firstDate: string, allIds: readonly string[]): void {
  collapseReactModal();
  window.S.machSel = new Set(allIds);
  window.saveFilters();
  window.updateMachBtn();
  window.S.startMonday = mondayOfDate(parseIsoDateString(firstDate));
  resetView();
  window.notify();
  prependWeek();
  clearSelection();
  gotoDate(firstDate);
}

interface ResultItemProps {
  row: AssistantResultRow;
  tree: AssistContainer;
  isFreeDev: IsFree;
  hasGroup: boolean;
  allIds: readonly string[];
  machineById: (id: string) => Machine | undefined;
}

function useClampedDays(maxDays: number, initialDays: number) {
  const [days, setDays] = useState(initialDays);
  const [tip, setTip] = useState<string | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout>>();

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    const requested = parseInt(event.target.value) || 1;
    if (requested > maxDays) {
      setDays(maxDays);
      setTip(
        `Im freien Fenster sind nur ${maxDays} Tag${maxDays > 1 ? 'e' : ''} am Stück verfügbar.`,
      );
      clearTimeout(tipTimer.current);
      tipTimer.current = setTimeout(() => setTip(null), 2000);
    } else {
      setDays(requested);
    }
  }

  return { days, tip, onChange };
}

interface ResultInfoProps {
  selectedDates: readonly string[];
  windowText: string;
  hasGroup: boolean;
  pickedNames: readonly string[];
}

/** The run's date range, free-window description, and (mode-dependent) suggested devices.
 *  Split out of `AssistantResultItem` purely to stay under the function-length budget. */
function ResultInfo({ selectedDates, windowText, hasGroup, pickedNames }: ResultInfoProps) {
  return (
    <div>
      <b className="asRange">{rangeText(selectedDates)}</b>
      <br />
      <span className="hint" style={{ margin: 0 }}>
        {windowText}
      </span>
      {hasGroup && (
        <>
          <br />
          <span className="hint" style={{ margin: 0 }}>
            Vorschlag: {pickedNames.length ? pickedNames.join(', ') : '—'}
          </span>
        </>
      )}
    </div>
  );
}

function AssistantResultItem({
  row,
  tree,
  isFreeDev,
  hasGroup,
  allIds,
  machineById,
}: ResultItemProps) {
  const maxDays = row.dates.length;
  const { days, tip, onChange } = useClampedDays(maxDays, row.defaultDays);
  const selectedDates = row.dates.slice(0, days);
  const pickedIds = chooseDevicesForTree(tree, selectedDates, isFreeDev);
  const pickedNames = pickedIds
    .map((id) => machineById(id)?.name)
    .filter((name): name is string => !!name);
  const windowText = row.isOpenEnded
    ? `ab ${formatDateLong(row.dates[0]!)} durchgehend frei (offen – ${maxDays} Tage wählbar)`
    : `freies Fenster: ${rangeText(row.dates)} (${maxDays} Tag${maxDays > 1 ? 'e' : ''})`;

  return (
    <div className="res">
      <ResultInfo
        selectedDates={selectedDates}
        windowText={windowText}
        hasGroup={hasGroup}
        pickedNames={pickedNames}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="number"
          className="asDays"
          value={days}
          min={1}
          style={{ width: 62 }}
          title="Anzahl Tage (ab Fensteranfang)"
          onChange={onChange}
        />
        {tip && <span className="hint">{tip}</span>}
        <button
          className="btn small"
          title="Zum Termin springen und Zeilen auf die gewählten Geräte filtern"
          aria-label="Termin anzeigen"
          onClick={() => gotoRun(selectedDates[0]!, allIds)}
        >
          <Icon name="pin" />
        </button>
        <button
          className="btn small primary"
          onClick={() =>
            openBookingForm(pickedIds, selectedDates[0]!, selectedDates[selectedDates.length - 1]!)
          }
        >
          Buchen…
        </button>
      </div>
    </div>
  );
}

export interface AssistantResultsProps {
  results: readonly AssistantResultRow[];
  tree: AssistContainer;
  isFreeDev: IsFree;
  allIds: readonly string[];
  machineById: (id: string) => Machine | undefined;
}

export function AssistantResults({
  results,
  tree,
  isFreeDev,
  allIds,
  machineById,
}: AssistantResultsProps) {
  if (!results.length) {
    return (
      <p className="hint">
        <b>Keine passenden Termine im Zeitraum gefunden.</b> Zeitraum vergrößern, „brauche N" senken
        oder Geräte entfernen.
      </p>
    );
  }
  const hasGroup = tree.children.some((child) => child.type === 'grp');
  return (
    <>
      <h2 style={{ marginTop: 14 }}>Passende Termine:</h2>
      <div className="resultlist">
        {results.map((row, i) => (
          // Keyed by index — results are replaced wholesale on each search, matching legacy's
          // own `data-i="${i}"` indexing.
          <AssistantResultItem
            key={i}
            row={row}
            tree={tree}
            isFreeDev={isFreeDev}
            hasGroup={hasGroup}
            allIds={allIds}
            machineById={machineById}
          />
        ))}
      </div>
    </>
  );
}
