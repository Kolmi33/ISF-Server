// =======================================================================================
// ASSISTANT RESULTS COMPONENT (web/js/ui/components/AssistantResults.tsx)
// =======================================================================================
//
// The Assistant's results list: free-window runs with an editable "days to book" count
// (clamped to the run's length), a suggested-devices line, a "pin" that collapses the modal
// and filters+centers the grid on the run, and "Buchen…" opening the booking form.
//
// Key Principles:
// - RENDERING ONLY, SCHEDULING LIVES ELSEWHERE: the scheduling itself
//   (`freeDays`/`groupRuns`/`extendOpenRuns`/`chooseDevicesForTree`) lives in
//   `core/assistant.ts`; `ui/assistant-results.ts` caps/shapes the list this component renders.
// - INLINE CLAMP TOOLTIP: when a requested day count exceeds the run's actual length, a
//   short-lived hint renders inline next to the input (not a precisely viewport-positioned
//   floating element) — simpler, with no functional difference in what actually clamps.
//
// =======================================================================================

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { formatDateLong, mondayOfDate, parseIsoDateString } from '../../../../shared/dates.ts';
import { chooseDevicesForTree, type AssistContainer, type IsFree } from '../../core/assistant.ts';
import type { AssistantResultRow } from '../assistant-results.ts';
import { clearSelection } from '../grid-interaction.ts';
import { gotoDate, prependWeek, resetView } from '../grid-scroll.ts';
import { nameColor } from '../grid.ts';
import { isDarkTheme } from '../theme.ts';
import { collapseReactModal } from '../modal.tsx';
import { openBookingForm } from './BookingForm.tsx';
import { Icon } from './Icon.tsx';
import { store } from '../../store-instance.ts';
import { saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';

function rangeText(dates: readonly string[]): string {
  return dates.length === 1
    ? formatDateLong(dates[0]!)
    : `${formatDateLong(dates[0]!)} – ${formatDateLong(dates[dates.length - 1]!)}`;
}

/** Jumps to the run's first day, filtered to every device the Assistant considered (not
 *  just this run's picks) — collapsing rather than closing the modal, so the search
 *  selection/results survive underneath it for when the user comes back. */
function gotoRun(firstDate: string, allIds: readonly string[]): void {
  collapseReactModal();
  // Both writes stay silent — saveFilters()/updateMachBtn()/resetView() run before the one
  // notify, matching the original's single window.notify() after all of this.
  store.state.machSel = new Set(allIds);
  saveFilters();
  updateMachBtn();
  store.state.startMonday = mondayOfDate(parseIsoDateString(firstDate));
  resetView();
  store.notify();
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

/** The system's suggested devices for this run, as prominent colored pills directly under the
 *  date range — replacing the old plain-text "Vorschlag: A, B, C" hint line (user request: no
 *  longer hidden in fine print). Each pill's color comes from the same deterministic
 *  name→hue hash the grid's own booking cells use (`nameColor`), so a device's color stays
 *  recognizable if it also shows up as a booking elsewhere. */
function SuggestedDevicePills({ names }: { names: readonly string[] }) {
  if (!names.length) {
    return (
      <div className="aspills">
        <span className="hint" style={{ margin: 0 }}>
          —
        </span>
      </div>
    );
  }
  const dark = isDarkTheme();
  return (
    <div className="aspills">
      {names.map((name) => (
        <span key={name} className="aspill" style={{ background: nameColor(name, dark) }}>
          {name}
        </span>
      ))}
    </div>
  );
}

interface ResultInfoProps {
  selectedDates: readonly string[];
  windowText: string;
  hasGroup: boolean;
  pickedNames: readonly string[];
}

/** The run's date range, (mode-dependent) suggested-device pills, and the free-window
 *  description. Split out of `AssistantResultItem` purely to stay under the function-length
 *  budget. */
function ResultInfo({ selectedDates, windowText, hasGroup, pickedNames }: ResultInfoProps) {
  return (
    <div>
      <b className="asRange">{rangeText(selectedDates)}</b>
      {hasGroup && <SuggestedDevicePills names={pickedNames} />}
      <span className="hint" style={{ margin: 0, display: 'block' }}>
        {windowText}
      </span>
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
