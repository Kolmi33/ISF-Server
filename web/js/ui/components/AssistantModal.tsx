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
    addedIds: new Set(treeDevs(treeRef.current)),
    toggleDevice,
    onGroupOnto: (dragUid: string, targetUid: string) =>
      withRerender(() => groupNodeOnto(treeRef.current, dragUid, targetUid, newUid)),
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
 * Validates the search inputs, then searches for free windows and freezes a tree snapshot for
 * the result (see the file header's note on why the result is frozen rather than reading the
 * live tree). Used to also confirm before searching when a group had redundancy (need < member
 * count) — removed (user request): the results/suggestion pills already surface a group's
 * structure without an extra blocking dialog in front of every such search.
 */
function runAssistantSearch(
  tree: AssistContainer,
  from: string,
  to: string,
  minDays: number,
): AssistantSearchState | null {
  if (!tree.children.length) {
    toast('Bitte oben Geräte übernehmen.');
    return null;
  }
  if (!from || !to || from > to) {
    toast('Bitte gültigen Zeitraum wählen.');
    return null;
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

interface AssistantParametersProps {
  from: string;
  to: string;
  minDays: number;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onMinDaysChange: (value: number) => void;
}

/** The "Buchungsparameter" card: just the date-range + minimum-consecutive-days inputs, no
 *  action buttons — those are anchored separately at the bottom of the whole right column
 *  (`AssistantModal`), not tied to this one card, per the redesign's "primary action is the
 *  clear final step of the flow" request. */
function AssistantParametersCard({
  from,
  to,
  minDays,
  onFromChange,
  onToChange,
  onMinDaysChange,
}: AssistantParametersProps) {
  const onMinDaysInput = (event: ChangeEvent<HTMLInputElement>) =>
    onMinDaysChange(Math.max(1, Math.min(30, parseInt(event.target.value) || 1)));
  return (
    <div className="assist-card">
      <div className="assist-card-title">Buchungsparameter</div>
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
    </div>
  );
}

/** The "Ausgewählte Geräte" card — a "shopping cart" for checked devices (user request): each
 *  one shows up here as its own line item (`AssistantTree`'s `.asdev`/`.asgrp` nodes already
 *  work exactly this way, own remove icon included) the moment it's checked on the left, no
 *  further action needed. No explanatory drag-and-drop copy here (or in `AssistantTree`'s
 *  empty state) by design — the interaction is communicated purely visually now (drag
 *  handles, dashed drop zones), per the redesign in `AssistantTree`.
 *
 *  The primary actions (Abbrechen / Freie Termine suchen) live inside this card now, pinned to
 *  its bottom-right corner (user request: "Move the ... buttons completely inside the
 *  'Ausgewählte Geräte' card") — the tree above them (`.aswork`, flex: 1) grows to fill the
 *  remaining card height, so the buttons stay flush at the bottom regardless of how many
 *  devices are picked. */
function AssistantSelectedDevicesCard({
  assistant,
  onSearch,
}: {
  assistant: ReturnType<typeof useAssistantTree>;
  onSearch: () => void;
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
      <div className="assist-actions">
        <button className="btn" onClick={closeReactModal}>
          Abbrechen
        </button>
        <button className="btn primary" onClick={onSearch}>
          Freie Termine suchen
        </button>
      </div>
    </div>
  );
}

interface AssistantConfigColumnProps extends AssistantParametersProps {
  assistant: ReturnType<typeof useAssistantTree>;
  onSearch: () => void;
}

/** The right column: the "Buchungsparameter" card and the "Ausgewählte Geräte" cart card (which
 *  now carries the primary action row itself, pinned to its own bottom-right corner — see that
 *  card's comment). Split out of `AssistantModal` purely to stay under the function-length
 *  budget. */
function AssistantConfigColumn({ assistant, onSearch, ...parameters }: AssistantConfigColumnProps) {
  return (
    <div className="assist-col-right">
      <AssistantParametersCard {...parameters} />
      <AssistantSelectedDevicesCard assistant={assistant} onSearch={onSearch} />
    </div>
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

  function search(): void {
    const outcome = runAssistantSearch(assistant.tree, from, to, minDays);
    if (outcome) setSearchState(outcome);
  }

  return (
    <>
      <h2>
        <Icon name="compass" /> Buchungsassistent
      </h2>
      {/* Card-based, two-column dashboard layout on desktop (app.css, ".assist-columns"): a
          light-grey backdrop behind white cards — the catalog (search + checklist) on the
          left, the active configuration (parameters, then the selected-devices "cart") on the
          right, both permanently visible without their own scrolling getting in each other's
          way. Narrower viewports stack everything in this same top-to-bottom order. */}
      <div className="assist-columns">
        <div className="assist-card assist-catalog">
          <div className="assist-card-title">Geräteauswahl</div>
          <AssistantChecklist
            machines={machines}
            favoriteIds={store.get('favs')}
            addedIds={assistant.addedIds}
            onToggle={assistant.toggleDevice}
          />
        </div>
        <AssistantConfigColumn
          assistant={assistant}
          from={from}
          to={to}
          minDays={minDays}
          onFromChange={setFrom}
          onToChange={setTo}
          onMinDaysChange={setMinDays}
          onSearch={search}
        />
      </div>
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
