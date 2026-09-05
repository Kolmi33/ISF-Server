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
import { getMachineCategory } from '../../core/machines.ts';
import type { AssistantResultRow } from '../assistant-results.ts';
import { clearSelection } from '../grid-interaction.ts';
import { gotoDate, prependWeek, resetView } from '../grid-scroll.ts';
import { categoryColor } from '../grid.ts';
import { isDarkTheme } from '../theme.ts';
import { collapseReactModal } from '../modal.tsx';
import { openBookingForm } from './BookingForm.tsx';
import { Icon } from './Icon.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
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
      setDays(Math.max(1, requested));
    }
  }

  return { days, tip, onChange };
}

/** The system's suggested devices for this run, as prominent colored pills directly under the
 *  date range — replacing the old plain-text "Vorschlag: A, B, C" hint line (user request: no
 *  longer hidden in fine print). Each pill's color is now its device's resource-category color
 *  (`categoryColor` — blue Maschinen, green Messtechnik, user request), the same one the
 *  Assistant's own selection chips use (`AssistantTree.tsx`), so equipment reads as "which
 *  kind" consistently across both.
 *
 *  Hovering a pill reveals a "×" to drop that one device from THIS result's own booking (user
 *  request: "When i hover over the items in the potential booking i have the option to remove
 *  individual items by pressing the x which appears") — scoped to this one result card only,
 *  not the Assistant's overall device selection in the tree. */
function SuggestedDevicePills({
  devices,
  onRemove,
}: {
  devices: readonly Machine[];
  onRemove: (deviceId: string) => void;
}) {
  if (!devices.length) {
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
      {devices.map((device) => (
        <span
          key={device.id}
          className="aspill"
          style={{ background: categoryColor(getMachineCategory(device), dark) }}
        >
          <span className="aspill-name">{device.name}</span>
          <button
            type="button"
            className="aspill-rm"
            title={`${device.name} aus diesem Termin entfernen`}
            aria-label={`${device.name} aus diesem Termin entfernen`}
            onClick={() => onRemove(device.id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

interface ResultInfoProps {
  fullWindow: readonly string[];
  windowText: string;
  pickedDevices: readonly Machine[];
  onRemoveDevice: (deviceId: string) => void;
}

/** The run's title, the suggested-device pills (color-coded by resource category — a universal
 *  feature now, not just when a Bedarfsgruppe exists: user request), and the free-window
 *  description. Split out of `AssistantResultItem` purely to stay under the function-length
 *  budget.
 *
 *  The title shows the free window's own full start – end span (`fullWindow`, i.e. `row.dates`)
 *  — not the currently-selected/clamped day subset, which used to leave it reading as just a
 *  single bold date whenever "Mind. Tage am Stück" defaulted to 1 (user request: "The Title
 *  should not just be the bold date -> but the time slot available date start -> date end"). */
function ResultInfo({ fullWindow, windowText, pickedDevices, onRemoveDevice }: ResultInfoProps) {
  return (
    <div>
      <b className="asRange">{rangeText(fullWindow)}</b>
      <SuggestedDevicePills devices={pickedDevices} onRemove={onRemoveDevice} />
      <span className="hint" style={{ margin: 0, display: 'block' }}>
        {windowText}
      </span>
    </div>
  );
}

interface ResultActionsProps {
  days: number;
  maxDays: number;
  tip: string | null;
  onDaysChange: (event: ChangeEvent<HTMLInputElement>) => void;
  selectedDates: readonly string[];
  pickedIds: readonly string[];
  allIds: readonly string[];
}

/** The days-to-book input plus the "pin"/"Buchen…" actions — split out of `AssistantResultItem`
 *  purely to stay under the function-length budget. */
function ResultActions({
  days,
  maxDays,
  tip,
  onDaysChange,
  selectedDates,
  pickedIds,
  allIds,
}: ResultActionsProps) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <Input
        type="number"
        className="asDays"
        value={days}
        min={1}
        max={maxDays}
        aria-label="Buchungstage für diesen Termin"
        style={{ width: 62 }}
        title="Anzahl Tage (ab Fensteranfang)"
        onChange={onDaysChange}
      />
      {tip && <span className="hint">{tip}</span>}
      {/* variant="outline": the plain bordered look (Base UI's own "default" variant is a
          filled primary-colored button, not the plain secondary look this icon button
          needs). */}
      <Button
        variant="outline"
        size="sm"
        title="Zum Termin springen und Zeilen auf die gewählten Geräte filtern"
        aria-label="Termin anzeigen"
        onClick={() => gotoRun(selectedDates[0]!, allIds)}
      >
        <Icon name="pin" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!pickedIds.length}
        onClick={() =>
          openBookingForm(
            pickedIds,
            selectedDates[0]!,
            selectedDates[selectedDates.length - 1]!,
            selectedDates,
          )
        }
      >
        Buchen…
      </Button>
    </div>
  );
}

function AssistantResultItem({ row, tree, isFreeDev, allIds, machineById }: ResultItemProps) {
  const maxDays = row.dates.length;
  const { days, tip, onChange } = useClampedDays(maxDays, row.defaultDays);
  // Devices dropped from THIS result's own booking via a pill's hover "×" — scoped to this one
  // card, not the Assistant's overall device selection in the tree (user request).
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const selectedDates = row.dates.slice(0, days);
  const pickedIds = chooseDevicesForTree(tree, selectedDates, isFreeDev).filter(
    (id) => !removedIds.has(id),
  );
  const pickedDevices = pickedIds
    .map((id) => machineById(id))
    .filter((device): device is Machine => !!device);
  const windowText = row.isOpenEnded
    ? `ab ${formatDateLong(row.dates[0]!)} durchgehend frei (offen – ${maxDays} Tage wählbar)`
    : `freies Fenster: ${rangeText(row.dates)} (${maxDays} Tag${maxDays > 1 ? 'e' : ''})`;

  return (
    <div className="res">
      <ResultInfo
        fullWindow={row.dates}
        windowText={windowText}
        pickedDevices={pickedDevices}
        onRemoveDevice={(id) => setRemovedIds((prev) => new Set(prev).add(id))}
      />
      <ResultActions
        days={days}
        maxDays={maxDays}
        tip={tip}
        onDaysChange={onChange}
        selectedDates={selectedDates}
        pickedIds={pickedIds}
        allIds={allIds}
      />
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
  return (
    <>
      <h2 className="assist-results-heading">Passende Termine · {results.length}</h2>
      {results.length === 0 ? (
        <p className="hint">
          <b>Keine passenden Termine im Zeitraum gefunden.</b> Zeitraum vergrößern, „brauche N"
          senken oder Geräte entfernen.
        </p>
      ) : (
        <div className="resultlist">
          {results.map((row, i) => (
            // The parent remounts this list for every successful search; local edits stay
            // scoped to the frozen search snapshot.
            <AssistantResultItem
              key={i}
              row={row}
              tree={tree}
              isFreeDev={isFreeDev}
              allIds={allIds}
              machineById={machineById}
            />
          ))}
        </div>
      )}
    </>
  );
}
