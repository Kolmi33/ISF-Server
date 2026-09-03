// =======================================================================================
// ASSISTANT MODAL COMPONENT (web/js/ui/components/AssistantModal.tsx)
// =======================================================================================
//
// The booking Assistant: check off devices, drag equivalents onto each other to form
// "need N of M" groups, then search for free windows.
//
// Key Principles:
// - MUTABLE TREE IN A REF, NOT REACT STATE: tree mutation and the N-of-M scheduling solver
//   are already pure and 100%-tested in `core/assistant.ts` — this module holds a mutable
//   tree in a ref plus a forced rerender tick, the same "frozen structure, forced rerender"
//   shape My Bookings/Admin use elsewhere.
// - RESULTS ARE FROZEN AT SEARCH TIME: the results panel's suggested-devices line and its
//   "Buchen…"/pin button device list are computed from a tree snapshot frozen at search
//   time (`structuredClone`), not the live tree re-read at click time — this avoids
//   submitting a booking for a device the user has since removed from the tree between
//   searching and clicking a result.
//
// =======================================================================================

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  addDays,
  formatDateAsIsoString,
  getWeekdaysInRange,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../../shared/dates.ts';
import { isMachineBlockedOnDate, isMachineAvailableOnWeekday } from '../../core/machines.ts';
import {
  addDeviceToTree,
  changeGroupNeed,
  dissolveGroup,
  extendOpenRuns,
  freeDays,
  groupNodeOnto,
  groupRuns,
  hasAnyRedundancy,
  joinNode,
  moveNodeToRoot,
  removeNode,
  setGroupNeed,
  treeDevUid,
  treeDevs,
  type AssistContainer,
} from '../../core/assistant.ts';
import { orderedMachines } from '../grid.ts';
import { getBooking } from '../../core/bookings.ts';
import { buildAssistantResults, type AssistantResultRow } from '../assistant-results.ts';
import { toast } from '../toast.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { AssistantChecklist } from './AssistantChecklist.tsx';
import { AssistantTree } from './AssistantTree.tsx';
import { AssistantResults } from './AssistantResults.tsx';
import { Icon } from './Icon.tsx';
import { store } from '../../store-instance.ts';
import { machById } from '../machine-lookup.ts';

const AS_HUES = [210, 150, 275, 32, 344, 190, 95, 258];

function isFreeDevice(id: string, day: string): boolean {
  const machine = machById(id);
  return (
    !!machine &&
    !getBooking(store.get('data')!.bookings, id, day) &&
    !isMachineBlockedOnDate(machine, day) &&
    isMachineAvailableOnWeekday(machine, day)
  );
}

/** Owns the mutable tree plus every edit operation it supports — a single mutable object
 *  held across renders, so drag-and-drop edits don't need to reconstruct the whole tree. */
function useAssistantTree() {
  const treeRef = useRef<AssistContainer>({ children: [] });
  const [, forceRerender] = useState(0);
  const uidCounter = useRef(0);
  const colorIndex = useRef(0);
  const newUid = () => 'n' + ++uidCounter.current;
  const newColor = () => AS_HUES[colorIndex.current++ % AS_HUES.length]!;

  function withRerender(mutate: () => void): void {
    mutate();
    forceRerender((tick) => tick + 1);
  }

  function toggleDevice(id: string, checked: boolean): void {
    withRerender(() => {
      if (checked) {
        addDeviceToTree(treeRef.current, id, newUid);
      } else {
        const uid = treeDevUid(treeRef.current, id);
        if (uid) removeNode(treeRef.current, uid);
      }
    });
  }

  return {
    tree: treeRef.current,
    addedIds: new Set(treeDevs(treeRef.current)),
    toggleDevice,
    onGroupOnto: (dragUid: string, targetUid: string) =>
      withRerender(() => groupNodeOnto(treeRef.current, dragUid, targetUid, newUid, newColor)),
    onJoin: (dragUid: string, groupUid: string) =>
      withRerender(() => joinNode(treeRef.current, dragUid, groupUid)),
    onToRoot: (dragUid: string) => withRerender(() => moveNodeToRoot(treeRef.current, dragUid)),
    onDissolve: (uid: string) => withRerender(() => dissolveGroup(treeRef.current, uid)),
    onChangeNeed: (uid: string, delta: number) =>
      withRerender(() => changeGroupNeed(treeRef.current, uid, delta)),
    onSetNeed: (uid: string, value: number) =>
      withRerender(() => setGroupNeed(treeRef.current, uid, value)),
    onRemove: (uid: string) => withRerender(() => removeNode(treeRef.current, uid)),
  };
}

interface AssistantSearchState {
  results: readonly AssistantResultRow[];
  tree: AssistContainer;
  allIds: readonly string[];
}

/**
 * Validates the search inputs, confirms redundancy if any exists, then searches for free
 * windows and freezes a tree snapshot for the result (see the file header's note on why the
 * result is frozen rather than reading the live tree).
 */
async function runAssistantSearch(
  tree: AssistContainer,
  from: string,
  to: string,
  minDays: number,
): Promise<AssistantSearchState | null> {
  if (!tree.children.length) {
    toast('Bitte oben Geräte übernehmen.');
    return null;
  }
  if (!from || !to || from > to) {
    toast('Bitte gültigen Zeitraum wählen.');
    return null;
  }
  if (hasAnyRedundancy(tree)) {
    const confirmed = await window.askConfirm({
      title: 'Alle gleichwertigen Geräte erfasst?',
      yes: 'Ja, Termine suchen',
      no: 'Zurück',
      danger: false,
      body: 'In mindestens einer Bedarfsgruppe brauchst du weniger Geräte, als enthalten sind (Redundanz). Sind dort alle gleichwertigen Geräte enthalten? Fehlende ggf. oben zur Auswahl hinzufügen.',
    });
    if (!confirmed) return null;
  }
  const frozenTree = structuredClone(tree);
  const days = getWeekdaysInRange(from, to);
  const runs = groupRuns(freeDays(frozenTree, days, isFreeDevice));
  const openRuns = extendOpenRuns(frozenTree, runs, to, isFreeDevice);
  const good = runs.filter((run) => run.length >= minDays);
  return {
    results: buildAssistantResults(good, openRuns, minDays),
    tree: frozenTree,
    allIds: treeDevs(frozenTree),
  };
}

interface AssistantSearchFormProps {
  from: string;
  to: string;
  minDays: number;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onMinDaysChange: (value: number) => void;
  onSearch: () => void;
}

/** The date-range + minimum-consecutive-days inputs and the "Freie Termine suchen" button. */
function AssistantSearchForm({
  from,
  to,
  minDays,
  onFromChange,
  onToChange,
  onMinDaysChange,
  onSearch,
}: AssistantSearchFormProps) {
  const onMinDaysInput = (event: ChangeEvent<HTMLInputElement>) =>
    onMinDaysChange(Math.max(1, Math.min(30, parseInt(event.target.value) || 1)));
  return (
    <>
      <div className="formrow">
        <label>Suchen von</label>
        <input type="date" value={from} onChange={(event) => onFromChange(event.target.value)} />
        <label style={{ minWidth: 'auto' }}>bis</label>
        <input type="date" value={to} onChange={(event) => onToChange(event.target.value)} />
      </div>
      <div className="formrow">
        <label>Mind. Tage am Stück</label>
        <input
          type="number"
          value={minDays}
          min={1}
          max={30}
          style={{ width: 70 }}
          onChange={onMinDaysInput}
        />
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={closeReactModal}>
          Abbrechen
        </button>
        <button className="btn primary" onClick={onSearch}>
          Freie Termine suchen
        </button>
      </div>
    </>
  );
}

/** The "Ausgewählte Geräte" heading plus the work-area tree. */
function AssistantWorkSection({ assistant }: { assistant: ReturnType<typeof useAssistantTree> }) {
  return (
    <>
      <div className="catlbl" style={{ marginTop: 4 }}>
        Ausgewählte Geräte{' '}
        <span className="hint" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          – gleichwertige aufeinander ziehen = Bedarfsgruppe
        </span>
      </div>
      <AssistantTree
        tree={assistant.tree}
        machineById={(id) => machById(id)}
        onGroupOnto={assistant.onGroupOnto}
        onJoin={assistant.onJoin}
        onToRoot={assistant.onToRoot}
        onDissolve={assistant.onDissolve}
        onChangeNeed={assistant.onChangeNeed}
        onSetNeed={assistant.onSetNeed}
        onRemove={assistant.onRemove}
      />
    </>
  );
}

export function AssistantModal() {
  const assistant = useAssistantTree();
  const machines = orderedMachines(store.get('data')!.machines, store.get('favs'));
  const [from, setFrom] = useState(todayAsIsoDateString);
  const [to, setTo] = useState(() =>
    formatDateAsIsoString(addDays(parseIsoDateString(todayAsIsoDateString()), 56)),
  );
  const [minDays, setMinDays] = useState(1);
  const [searchState, setSearchState] = useState<AssistantSearchState | null>(null);

  async function search(): Promise<void> {
    const outcome = await runAssistantSearch(assistant.tree, from, to, minDays);
    if (outcome) setSearchState(outcome);
  }

  return (
    <>
      <h2>
        <Icon name="compass" /> Buchungsassistent
      </h2>
      <AssistantChecklist
        machines={machines}
        favoriteIds={store.get('favs')}
        addedIds={assistant.addedIds}
        onToggle={assistant.toggleDevice}
      />
      <AssistantWorkSection assistant={assistant} />
      <AssistantSearchForm
        from={from}
        to={to}
        minDays={minDays}
        onFromChange={setFrom}
        onToChange={setTo}
        onMinDaysChange={setMinDays}
        onSearch={() => void search()}
      />
      {searchState && (
        <AssistantResults
          results={searchState.results}
          tree={searchState.tree}
          isFreeDev={isFreeDevice}
          allIds={searchState.allIds}
          machineById={(id) => machById(id)}
        />
      )}
    </>
  );
}

/** Opens the booking Assistant. */
export function openAssistant(): void {
  openReactModal(<AssistantModal />);
}
