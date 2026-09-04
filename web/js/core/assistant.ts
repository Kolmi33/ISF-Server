// =======================================================================================
// BOOKING ASSISTANT MODULE (web/js/core/assistant.ts)
// =======================================================================================
//
// Domain logic for the intelligent Booking Assistant:
// 1. Requirement Tree Management: Represents hierarchical "N-of-M" machine requirements
//    (e.g. "I need 1 of these 3 equivalent CNC mills, plus 1 3D scanner").
// 2. Drag-and-Drop Tree Normalization: Cleanly merges, nests, detaches, and dissolves groups.
// 3. N-of-M Constraint Solver: Scans calendar date ranges to find contiguous windows where
//    all required machine combinations are simultaneously available.
// 4. Optimal Device Selection: Recommends the specific machines to book across the chosen window,
//    prioritizing machines that remain free continuously without requiring mid-run swaps.
//
// =======================================================================================

import { nextWeekday } from '../../../shared/dates.ts';

/** A device leaf in the Assistant requirement tree. */
export interface AssistDev {
  uid: string;
  type: 'dev';
  id: string;
}

/** A "need N of M" group node representing interchangeable or parallel machine requirements. */
export interface AssistGrp {
  uid: string;
  type: 'grp';
  /** Number of children required to be simultaneously available (1 <= need <= children.length). */
  need: number;
  children: AssistNode[];
}

export type AssistNode = AssistDev | AssistGrp;

/** Container holding child nodes (root container or a group node). */
export interface AssistContainer {
  children: AssistNode[];
}

/**
 * Searches the requirement tree recursively for a node with the given `uid`.
 */
export function treeFind(node: AssistContainer, uid: string): AssistNode | null {
  for (const child of node.children) {
    if (child.uid === uid) return child;
    if (child.type === 'grp') {
      const found = treeFind(child, uid);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Finds the parent container that directly holds the node with `uid`.
 */
export function treeFindParent(node: AssistContainer, uid: string): AssistContainer | null {
  for (const child of node.children) {
    if (child.uid === uid) return node;
    if (child.type === 'grp') {
      const found = treeFindParent(child, uid);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Checks if `aUid` is equal to or an ancestor of `bUid`.
 * Used to prevent invalid circular drag-and-drop operations where a group is dropped into its own child.
 */
export function treeIsAncestor(root: AssistContainer, aUid: string, bUid: string): boolean {
  if (aUid === bUid) return true;
  const ancestorNode = treeFind(root, aUid);
  return !!ancestorNode && ancestorNode.type === 'grp' && !!treeFind(ancestorNode, bUid);
}

/**
 * Detaches the node `uid` from its parent container and returns it.
 */
export function treeDetach(root: AssistContainer, uid: string): AssistNode | null {
  const parent = treeFindParent(root, uid);
  if (!parent) return null;
  const index = parent.children.findIndex((child) => child.uid === uid);
  return parent.children.splice(index, 1)[0]!;
}

/**
 * Returns a flat array of all machine IDs present anywhere in the requirement tree.
 */
export function treeDevs(node: AssistContainer): string[] {
  let deviceIds: string[] = [];
  for (const child of node.children) {
    if (child.type === 'dev') deviceIds.push(child.id);
    else deviceIds = deviceIds.concat(treeDevs(child));
  }
  return deviceIds;
}

/**
 * Finds the `uid` of the tree leaf node corresponding to `id` (machine ID).
 */
export function treeDevUid(node: AssistContainer, id: string): string | null {
  for (const child of node.children) {
    if (child.type === 'dev' && child.id === id) return child.uid;
    if (child.type === 'grp') {
      const found = treeDevUid(child, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Normalizes the requirement tree after an edit:
 * 1. Recursively cleans up child groups.
 * 2. Removes empty groups (`children.length === 0`).
 * 3. Dissolves single-element groups (`children.length === 1`), promoting the single child.
 * 4. Clamps group `need` to `1 <= need <= children.length`.
 */
export function treeCleanup(node: AssistContainer): void {
  for (const child of node.children) {
    if (child.type === 'grp') treeCleanup(child);
  }
  node.children = node.children.flatMap((child) => {
    if (child.type !== 'grp') return [child];
    if (child.children.length === 0) return [];
    if (child.children.length === 1) return [child.children[0]!];
    child.need = Math.max(1, Math.min(child.children.length, child.need));
    return [child];
  });
}

// ---------------------------------------------------------------------------------------
// N-of-M Scheduling Constraint Solver
// ---------------------------------------------------------------------------------------

/** Predicate checking whether device `id` is free and bookable on ISO calendar day `day`. */
export type IsFree = (id: string, day: string) => boolean;

/**
 * Returns the effective `need` count of a group, clamped to `1 <= need <= children.length`.
 */
export function effectiveNeed(group: AssistGrp): number {
  return Math.max(1, Math.min(group.children.length, group.need));
}

/**
 * Evaluates whether `node` is satisfiable on `day`:
 * - Leaf device: Satisfiable if `isFree(device.id, day)` is true.
 * - Group node: Satisfiable if at least `effectiveNeed` child nodes are satisfiable.
 */
export function isNodeSatisfiable(node: AssistNode, day: string, isFree: IsFree): boolean {
  return node.type === 'dev'
    ? isFree(node.id, day)
    : node.children.filter((child) => isNodeSatisfiable(child, day, isFree)).length >=
        effectiveNeed(node);
}

/**
 * Evaluates whether the entire requirement tree is satisfied on `day`.
 * All top-level children under the root must be satisfied.
 */
export function isTreeSatisfiableOnDay(
  root: AssistContainer,
  day: string,
  isFree: IsFree,
): boolean {
  return root.children.every((child) => isNodeSatisfiable(child, day, isFree));
}

/**
 * Filters an array of ISO dates, returning only the days where the requirement tree is satisfiable.
 */
export function freeDays(root: AssistContainer, days: string[], isFree: IsFree): string[] {
  return days.filter((day) => isTreeSatisfiableOnDay(root, day, isFree));
}

/**
 * Groups a sorted array of available ISO dates into contiguous business-day runs (skipping weekends).
 */
export function groupRuns(sortedFreeDates: string[]): string[][] {
  const runs: string[][] = [];
  let currentRun: string[] = [];
  for (const date of sortedFreeDates) {
    if (currentRun.length && nextWeekday(currentRun[currentRun.length - 1]!) === date) {
      currentRun.push(date);
    } else {
      if (currentRun.length) runs.push(currentRun);
      currentRun = [date];
    }
  }
  if (currentRun.length) runs.push(currentRun);
  return runs;
}

/**
 * Extends available runs that reach the search horizon (`to`) into future workdays as long as
 * the requirement tree remains continuously satisfiable, up to a safety `cap` of days.
 */
export function extendOpenRuns(
  root: AssistContainer,
  runs: string[][],
  to: string,
  isFree: IsFree,
  cap = 520,
): Set<string[]> {
  const openRuns = new Set<string[]>();
  for (const run of runs) {
    if (nextWeekday(run[run.length - 1]!) > to) {
      openRuns.add(run);
      let date = nextWeekday(run[run.length - 1]!);
      let daysExtended = 0;
      while (isTreeSatisfiableOnDay(root, date, isFree) && daysExtended < cap) {
        run.push(date);
        date = nextWeekday(date);
        daysExtended++;
      }
    }
  }
  return openRuns;
}

/**
 * Checks whether `node` is satisfiable across EVERY day of `selectedDates`.
 */
export function isSatisfiableAcrossWindow(
  node: AssistNode,
  selectedDates: string[],
  isFree: IsFree,
): boolean {
  return selectedDates.every((date) => isNodeSatisfiable(node, date, isFree));
}

/**
 * Selects the optimal concrete devices to fulfill `node` over `selectedDates`.
 * Prioritizes devices that remain free across the entire window.
 */
export function chooseDevicesForNode(
  node: AssistNode,
  selectedDates: string[],
  isFree: IsFree,
): string[] {
  return node.type === 'dev'
    ? [node.id]
    : [...node.children]
        .sort(
          (childA, childB) =>
            (isSatisfiableAcrossWindow(childB, selectedDates, isFree) ? 1 : 0) -
            (isSatisfiableAcrossWindow(childA, selectedDates, isFree) ? 1 : 0),
        )
        .slice(0, effectiveNeed(node))
        .flatMap((child) => chooseDevicesForNode(child, selectedDates, isFree));
}

/**
 * Resolves the complete set of distinct machine IDs needed to fulfill the requirement tree
 * across `selectedDates`.
 */
export function chooseDevicesForTree(
  root: AssistContainer,
  selectedDates: string[],
  isFree: IsFree,
): string[] {
  return [
    ...new Set(
      root.children.flatMap((child) => chooseDevicesForNode(child, selectedDates, isFree)),
    ),
  ];
}

// ---------------------------------------------------------------------------------------
// Drag-and-Drop Requirement Tree Operations
// ---------------------------------------------------------------------------------------

/**
 * Wraps `dragUid` and `targetUid` in a new "need 1 of 2" group. Returns the new group's uid, or
 * null if the operation was a no-op (invalid drag/target, or a cycle) — callers use this to
 * check the resulting group afterward (e.g. AssistantModal.tsx's mixed-category confirm).
 */
export function groupNodeOnto(
  tree: AssistContainer,
  dragUid: string,
  targetUid: string,
  newUid: () => string,
): string | null {
  if (dragUid === targetUid || treeIsAncestor(tree, dragUid, targetUid)) return null;
  const dragNode = treeDetach(tree, dragUid);
  if (!dragNode) return null;
  const parent = treeFindParent(tree, targetUid);
  if (!parent) {
    tree.children.push(dragNode);
    return null;
  }
  const targetIndex = parent.children.findIndex((child) => child.uid === targetUid);
  const targetNode = parent.children[targetIndex]!;
  const newGroupUid = newUid();
  parent.children.splice(targetIndex, 1, {
    uid: newGroupUid,
    type: 'grp',
    need: 1,
    children: [targetNode, dragNode],
  });
  treeCleanup(tree);
  return newGroupUid;
}

/**
 * Moves `dragUid` into an existing group `groupUid`.
 */
export function joinNode(tree: AssistContainer, dragUid: string, groupUid: string): void {
  if (treeIsAncestor(tree, dragUid, groupUid)) return;
  const group = treeFind(tree, groupUid);
  if (!group || group.type !== 'grp') return;
  const node = treeDetach(tree, dragUid);
  if (!node) return;
  group.children.push(node);
  treeCleanup(tree);
}

/**
 * Moves `dragUid` out of any group back to the root container.
 */
export function moveNodeToRoot(tree: AssistContainer, dragUid: string): void {
  const node = treeDetach(tree, dragUid);
  if (!node) return;
  tree.children.push(node);
  treeCleanup(tree);
}

/**
 * Dissolves `groupUid`, promoting all its child nodes up to the parent container.
 */
export function dissolveGroup(tree: AssistContainer, groupUid: string): void {
  const group = treeFind(tree, groupUid);
  const parent = treeFindParent(tree, groupUid);
  if (!group || group.type !== 'grp' || !parent) return;
  const index = parent.children.findIndex((child) => child.uid === groupUid);
  parent.children.splice(index, 1, ...group.children);
  treeCleanup(tree);
}

/**
 * Adjusts a group's `need` count by `delta` (+1 or -1), clamped to `1 <= need <= children.length`.
 */
export function changeGroupNeed(tree: AssistContainer, groupUid: string, delta: number): void {
  const group = treeFind(tree, groupUid);
  if (!group || group.type !== 'grp') return;
  group.need = Math.max(1, Math.min(group.children.length, group.need + delta));
}

/**
 * Sets a group's `need` count to an absolute number, clamped to `1 <= need <= children.length`.
 */
export function setGroupNeed(tree: AssistContainer, groupUid: string, value: number): void {
  const group = treeFind(tree, groupUid);
  if (!group || group.type !== 'grp') return;
  group.need = Math.max(1, Math.min(group.children.length, value));
}

/**
 * Removes `uid` from the requirement tree and normalizes what remains.
 */
export function removeNode(tree: AssistContainer, uid: string): void {
  treeDetach(tree, uid);
  treeCleanup(tree);
}

/**
 * Adds a machine device leaf to the root of the tree if not already present.
 */
export function addDeviceToTree(
  tree: AssistContainer,
  deviceId: string,
  newUid: () => string,
): boolean {
  if (treeDevs(tree).includes(deviceId)) return false;
  tree.children.push({ uid: newUid(), type: 'dev', id: deviceId });
  return true;
}
