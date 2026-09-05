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
import type { Machine } from '../../../../shared/types.ts';
import {
  addDays,
  formatDateAsIsoString,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../../../shared/dates.ts';
import {
  isMachineBlockedOnDate,
  isMachineAvailableOnWeekday,
  getMachineCategory,
} from '../../core/machines.ts';
import {
  addDeviceToTree,
  candidateDaysInRange,
  changeGroupNeed,
  dissolveGroup,
  extendOpenRuns,
  freeDays,
  groupNodeOnto,
  groupRuns,
  hasEligibleWeekday,
  joinNode,
  moveNodeToRoot,
  removeNode,
  setGroupNeed,
  treeDevUid,
  treeDevs,
  treeFind,
  WEEKDAYS_MON_FRI,
  type AssistContainer,
  type WeekdayMask,
} from '../../core/assistant.ts';
import { orderedMachines } from '../grid.ts';
import { getBooking } from '../../core/bookings.ts';
import { buildAssistantResults, type AssistantResultRow } from '../assistant-results.ts';
import { describeSelectionSummary } from '../assistant-summary.ts';
import { toast } from '../toast.ts';
import { openReactModal } from '../modal.tsx';
import { AssistantChecklist } from './AssistantChecklist.tsx';
import { AssistantTree } from './AssistantTree.tsx';
import { AssistantResults } from './AssistantResults.tsx';
import { Icon } from './Icon.tsx';
import { AssistantParameters } from './AssistantParameters.tsx';
import { store } from '../../store-instance.ts';
import { machById } from '../machine-lookup.ts';

function isFreeDevice(id: string, day: string): boolean {
  const machine = machById(id);
  return (
    !!machine &&
    !getBooking(store.get('data')!.bookings, id, day) &&
    !isMachineBlockedOnDate(machine, day) &&
    isMachineAvailableOnWeekday(machine, day)
  );
}

/** Every distinct machine category (Maschine/Messtechnik) present among a group's own devices
 *  — used to flag a Bedarfsgruppe that mixes both kinds. */
function groupCategories(group: AssistContainer): Set<string> {
  return new Set(
    treeDevs(group)
      .map((id) => machById(id))
      .filter((machine): machine is Machine => !!machine)
      .map((machine) => getMachineCategory(machine)),
  );
}

/**
 * After a group/join operation forms or grows `groupUid` into one that mixes machine AND
 * Messtechnik devices, asks for confirmation (user request: "if i have a machine and a
 * messtechnik in my bedarfsgruppe ... I want to have popup question with this information and
 * if thats correct") — reverting by pulling `dragUid` back out to the root if declined. Applied
 * optimistically: the merge already happened (and rendered) by the time this runs, so a
 * decline is a visible "undo" rather than a blocking pre-check — consistent with dropping the
 * earlier, more intrusive pre-search redundancy confirm (see `runAssistantSearch`'s comment).
 * A group that already only has one category, or wasn't actually formed (`groupUid` null from
 * a no-op `groupNodeOnto`), is left alone with no popup at all.
 */
async function confirmMixedCategories(
  tree: AssistContainer,
  groupUid: string | null,
  dragUid: string,
  withRerender: (mutate: () => void) => void,
): Promise<void> {
  if (!groupUid) return;
  const group = treeFind(tree, groupUid);
  if (!group || group.type !== 'grp' || groupCategories(group).size < 2) return;
  const confirmed = await window.askConfirm({
    title: 'Gemischte Bedarfsgruppe',
    body: 'Diese Bedarfsgruppe enthält sowohl eine Maschine als auch ein Messtechnik-Gerät. Ist das so gewollt?',
    yes: 'Ja, das passt',
    danger: false, // a plain yes/no question, not a destructive action
  });
  if (!confirmed) withRerender(() => moveNodeToRoot(tree, dragUid));
}

/** Owns the mutable tree plus every edit operation it supports — a single mutable object
 *  held across renders, so drag-and-drop edits don't need to reconstruct the whole tree. */
function useAssistantTree() {
  const treeRef = useRef<AssistContainer>({ children: [] });
  const [revision, forceRerender] = useState(0);
  const uidCounter = useRef(0);
  const newUid = () => 'n' + ++uidCounter.current;

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
    /** Bumped on every tree edit — lets the search-staleness check notice a tree change
     *  without deep-comparing it. */
    revision,
    addedIds: new Set(treeDevs(treeRef.current)),
    toggleDevice,
    onGroupOnto: (dragUid: string, targetUid: string) => {
      let newGroupUid: string | null = null;
      withRerender(() => {
        newGroupUid = groupNodeOnto(treeRef.current, dragUid, targetUid, newUid);
      });
      void confirmMixedCategories(treeRef.current, newGroupUid, dragUid, withRerender);
    },
    onJoin: (dragUid: string, groupUid: string) => {
      withRerender(() => joinNode(treeRef.current, dragUid, groupUid));
      void confirmMixedCategories(treeRef.current, groupUid, dragUid, withRerender);
    },
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

/** Field-level validation for the date-range inputs, shown beside the field rather than as a
 *  toast (feature 6) — distinguishes a missing endpoint from an inverted range, per the two
 *  distinct causes a user can actually run into. */
function rangeValidationError(from: string, to: string): string | null {
  if (!from || !to) return 'Bitte Start- und Enddatum wählen.';
  if (from > to) return 'Enddatum darf nicht vor dem Startdatum liegen.';
  return null;
}

/** Field-level validation for the weekday selector: an all-excluded mask can never produce a
 *  search (feature 7). */
function weekdayValidationError(mask: WeekdayMask): string | null {
  return hasEligibleWeekday(mask) ? null : 'Wählen Sie mindestens einen Wochentag aus.';
}

/**
 * Searches for free windows under `weekdayMask` and freezes a tree snapshot for the result
 * (see the file header's note on why the result is frozen rather than reading the live tree).
 * Assumes the date range and weekday mask are already known-valid (the component gates the
 * search action on `rangeValidationError`/`weekdayValidationError` first) — this only still
 * guards the one condition with no natural field to attach an inline error to: an empty
 * device selection, which stays a toast.
 */
function runAssistantSearch(
  tree: AssistContainer,
  from: string,
  to: string,
  minDays: number,
  weekdayMask: WeekdayMask,
): AssistantSearchState | null {
  if (!tree.children.length) {
    toast('Bitte oben Geräte übernehmen.');
    return null;
  }
  const frozenTree = structuredClone(tree);
  const days = candidateDaysInRange(from, to, weekdayMask);
  const runs = groupRuns(freeDays(frozenTree, days, isFreeDevice), weekdayMask);
  const openRuns = extendOpenRuns(frozenTree, runs, to, isFreeDevice, weekdayMask);
  const good = runs.filter((run) => run.length >= minDays);
  return {
    results: buildAssistantResults(good, openRuns, minDays),
    tree: frozenTree,
    allIds: treeDevs(frozenTree),
  };
}

/** Selected devices scroll independently within the right-hand card. */
function AssistantSelectedDevicesCard({
  assistant,
}: {
  assistant: ReturnType<typeof useAssistantTree>;
}) {
  return (
    <div className="assist-card assist-cart">
      <div className="assist-card-title">Ausgewählte Geräte</div>
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
    </div>
  );
}

interface AssistantSearchController {
  searchState: AssistantSearchState | null;
  searchRevision: number;
  isSearching: boolean;
  isStale: boolean;
  rangeError: string | null;
  weekdayError: string | null;
  runSearch: () => void;
}

/** Owns the search action's lifecycle: field-level validation (gates the search rather than
 *  toasting), a deferred (`setTimeout`) run so the "Termine werden gesucht…" loading state
 *  actually gets a paint before the (synchronous, in-memory) search runs, a token guard so a
 *  superseded search can never overwrite a newer one's result, and a staleness flag once any
 *  input has changed since the last completed search. */
function useAssistantSearchController(
  tree: AssistContainer,
  treeRevision: number,
  from: string,
  to: string,
  minDays: number,
  weekdayMask: WeekdayMask,
): AssistantSearchController {
  const [searchState, setSearchState] = useState<AssistantSearchState | null>(null);
  const [searchRevision, setSearchRevision] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const rangeError = rangeValidationError(from, to);
  const weekdayError = weekdayValidationError(weekdayMask);
  const signature = JSON.stringify([from, to, minDays, weekdayMask, treeRevision]);

  function runSearch(): void {
    if (rangeError || weekdayError || isSearching) return;
    setIsSearching(true);
    const token = ++tokenRef.current;
    setTimeout(() => {
      if (token !== tokenRef.current) return; // superseded by a newer search since
      let outcome: AssistantSearchState | null;
      try {
        outcome = runAssistantSearch(tree, from, to, minDays, weekdayMask);
      } catch {
        setIsSearching(false);
        toast('Fehler bei der Suche. Bitte erneut versuchen.');
        return;
      }
      setIsSearching(false);
      if (outcome) {
        setSearchRevision((revision) => revision + 1);
        setSearchState(outcome);
        setLastSignature(signature);
      }
    }, 0);
  }

  return {
    searchState,
    searchRevision,
    isSearching,
    isStale: searchState !== null && signature !== lastSignature,
    rangeError,
    weekdayError,
    runSearch,
  };
}

/** The two device-selection cards: "Geräte auswählen" (catalog) at 45%, "Ausgewählte Geräte"
 *  (the work tree) at 55% on desktop, stacked on narrow screens. */
function AssistantDeviceColumns({
  machines,
  assistant,
}: {
  machines: readonly Machine[];
  assistant: ReturnType<typeof useAssistantTree>;
}) {
  return (
    <div className="assist-columns">
      <div className="assist-card assist-catalog">
        <div className="assist-card-title">Geräte auswählen</div>
        <AssistantChecklist
          machines={machines}
          favoriteIds={store.get('favs')}
          addedIds={assistant.addedIds}
          onToggle={assistant.toggleDevice}
        />
      </div>
      <AssistantSelectedDevicesCard assistant={assistant} />
    </div>
  );
}

/** The stale-search banner + results list, once at least one search has completed. */
function AssistantSearchOutcome({ search }: { search: AssistantSearchController }) {
  return (
    <>
      {search.isStale && (
        <p className="assist-stale-banner" role="status">
          Suchkriterien geändert. Bitte erneut suchen.
        </p>
      )}
      {search.searchState && (
        <AssistantResults
          key={search.searchRevision}
          results={search.searchState.results}
          tree={search.searchState.tree}
          isFreeDev={isFreeDevice}
          allIds={search.searchState.allIds}
          machineById={(id) => machById(id)}
        />
      )}
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
  const [weekdayMask, setWeekdayMask] = useState<WeekdayMask>(WEEKDAYS_MON_FRI);
  const search = useAssistantSearchController(
    assistant.tree,
    assistant.revision,
    from,
    to,
    minDays,
    weekdayMask,
  );

  return (
    <div className="assist-shell">
      <header className="assist-header">
        <h2>
          <Icon name="compass" /> Buchungsassistent
        </h2>
        <p className="assist-subtitle">
          Geräte auswählen, Zeitraum festlegen und freie Termine finden.
        </p>
      </header>
      <div className="assist-body">
        <AssistantDeviceColumns machines={machines} assistant={assistant} />
        <AssistantParameters
          from={from}
          to={to}
          minDays={minDays}
          weekdayMask={weekdayMask}
          rangeError={search.rangeError}
          weekdayError={search.weekdayError}
          summary={describeSelectionSummary(assistant.tree)}
          isSearching={search.isSearching}
          onRangeChange={(nextFrom, nextTo) => {
            setFrom(nextFrom);
            setTo(nextTo);
          }}
          onMinDaysChange={setMinDays}
          onWeekdayMaskChange={setWeekdayMask}
          onSearch={search.runSearch}
        />
        <AssistantSearchOutcome search={search} />
      </div>
    </div>
  );
}

/** Opens the booking Assistant. */
export function openAssistant(): void {
  openReactModal(<AssistantModal />);
}
