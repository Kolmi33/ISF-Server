// =======================================================================================
// BOOKING ASSISTANT MODULE (web/js/core/assistant.ts)
// =======================================================================================
//
// Pure logic for the booking Assistant: the device/group tree operations AND the N-of-M
// scheduling solver.
// This module provides:
// 1. Tree operations (find, detach, cleanup) over the Assistant's device/group tree.
// 2. Drag-and-drop tree edits (group two nodes, join, dissolve, change a group's need).
// 3. The N-of-M scheduling solver: given an availability predicate, find which days/runs
//    satisfy the whole tree, and which concrete devices to book for a chosen window.
//
// Key Principles:
// - PURE FUNCTIONS: no DOM, no globals — the tree is passed explicitly, and device
//   availability is supplied via an injected `isFree` predicate (E4), so the solver is a
//   pure function of (tree, calendar days, availability) and is fully unit-testable
//   without a live booking calendar.
// - THE TREE MODEL: the Assistant lets the user pick devices and drag equivalents onto
//   each other to form "need N of M" groups. A tree is: a root/group container holds
//   children, each child is a device leaf or a nested group (with its own `need` count).
//   The DOM rendering and drag-and-drop chrome live in the React components; this file is
//   the pure kernel underneath them.
//
// =======================================================================================

import { nextWeekday } from '../../../shared/dates.ts';

/** A device leaf in the Assistant tree. */
export interface AssistDev {
  uid: string;
  type: 'dev';
  id: string;
}

/** A "need N of M" group node. */
export interface AssistGrp {
  uid: string;
  type: 'grp';
  need: number;
  color?: number;
  children: AssistNode[];
}

export type AssistNode = AssistDev | AssistGrp;

/** Anything that holds children: the tree root (no uid/type) or a group. */
export interface AssistContainer {
  children: AssistNode[];
}

/** Finds a node by uid anywhere in the tree (searching every group recursively), or null. */
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

/** Finds the container that directly holds `uid` (its immediate parent group, or the tree
 *  root), or null if `uid` doesn't exist anywhere in the tree. */
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

/** True if `aUid` is `bUid` itself, or a group that (directly or transitively) contains it —
 *  used to block a drag operation that would nest a node inside its own descendant. */
export function treeIsAncestor(root: AssistContainer, aUid: string, bUid: string): boolean {
  if (aUid === bUid) return true;
  const ancestorNode = treeFind(root, aUid);
  return !!ancestorNode && ancestorNode.type === 'grp' && !!treeFind(ancestorNode, bUid);
}

/** Removes the node `uid` from wherever it lives in the tree and returns it (or null if not
 *  found). Mutates the tree — the caller typically re-inserts the detached node elsewhere. */
export function treeDetach(root: AssistContainer, uid: string): AssistNode | null {
  const parent = treeFindParent(root, uid);
  if (!parent) return null;
  const index = parent.children.findIndex((child) => child.uid === uid);
  return parent.children.splice(index, 1)[0]!;
}

/** Lists every device id in the tree, in tree order, flattening all nested groups. */
export function treeDevs(node: AssistContainer): string[] {
  let deviceIds: string[] = [];
  for (const child of node.children) {
    if (child.type === 'dev') deviceIds.push(child.id);
    else deviceIds = deviceIds.concat(treeDevs(child));
  }
  return deviceIds;
}

/** Finds the uid of the device leaf whose device id is `id`, or null if that device isn't
 *  anywhere in the tree. */
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
 * Normalizes the tree in place after an edit, so it never accumulates degenerate groups.
 *
 * How it works, recursively (children cleaned up before their parent, so a parent sees its
 * children's already-final shape):
 * 1. An empty group (every child removed) is dropped entirely.
 * 2. A single-child group is dissolved, promoting that one child up to the group's own
 *    position — a "need 1 of 1" group carries no information a bare device/group doesn't.
 * 3. A surviving group's `need` is clamped to `1..childCount`, so it never asks for more
 *    devices than it has, or fewer than 1.
 */
export function treeCleanup(node: AssistContainer): void {
  for (const child of node.children) {
    if (child.type === 'grp') treeCleanup(child);
  }
  node.children = node.children.flatMap((child) => {
    if (child.type !== 'grp') return [child];
    if (child.children.length === 0) return []; // remove empty group
    if (child.children.length === 1) return [child.children[0]!]; // dissolve single-element group
    child.need = Math.max(1, Math.min(child.children.length, child.need));
    return [child];
  });
}

// ---------------------------------------------------------------------------------------
// N-of-M scheduling solver
// ---------------------------------------------------------------------------------------
// Availability is injected via `isFree(deviceId, isoDay)` — true when that device is
// bookable that day (not already booked, not blocked, and available that weekday). Keeping
// it injected rather than read from the live calendar directly is what keeps the solver a
// pure function, testable with a hand-built availability table instead of a live booking
// calendar.

/** Whether device `id` is free on ISO day `day`. */
export type IsFree = (id: string, day: string) => boolean;

/** A group's effective requirement: `need`, clamped to `1..childCount` in case the stored
 *  value is stale relative to the group's current children. */
export function effectiveNeed(group: AssistGrp): number {
  return Math.max(1, Math.min(group.children.length, group.need));
}

/** Whether `node` is satisfiable on `day`: a device leaf is satisfiable when it's free that
 *  day; a group is satisfiable when at least `effectiveNeed` of its children are (recursively). */
export function isNodeSatisfiable(node: AssistNode, day: string, isFree: IsFree): boolean {
  return node.type === 'dev'
    ? isFree(node.id, day)
    : node.children.filter((child) => isNodeSatisfiable(child, day, isFree)).length >=
        effectiveNeed(node);
}

/** Whether the whole tree is satisfiable on `day` — every top-level child must be
 *  satisfiable (the root itself has no `need`; it's an implicit AND over its children). */
export function isTreeSatisfiableOnDay(
  root: AssistContainer,
  day: string,
  isFree: IsFree,
): boolean {
  return root.children.every((child) => isNodeSatisfiable(child, day, isFree));
}

/** True if any group anywhere in the tree carries real redundancy — more children than it
 *  actually needs — which is what lets the Assistant show "this plan has backup capacity". */
export function hasAnyRedundancy(node: AssistContainer): boolean {
  return node.children.some(
    (child) =>
      child.type === 'grp' &&
      (child.children.length > effectiveNeed(child) || hasAnyRedundancy(child)),
  );
}

/** Filters `days` down to those on which the whole tree is satisfiable. */
export function freeDays(root: AssistContainer, days: string[], isFree: IsFree): string[] {
  return days.filter((day) => isTreeSatisfiableOnDay(root, day, isFree));
}

/** Splits a sorted list of free days into weekday-contiguous runs — a gap of more than one
 *  workday (via `nextWeekday`, so a weekend doesn't itself count as a gap) starts a new run. */
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
 * Extends every run that reaches the end of the search window `to` ("open" runs) for as
 * long as the whole tree stays free, up to `cap` additional days.
 *
 * How it works, per run:
 * 1. A run only counts as "open" if its last day's next workday falls after `to` — i.e. the
 *    search window ended while the run was still going, not because availability ran out.
 * 2. For each open run, keeps appending the next workday while the tree stays satisfiable
 *    on it, stopping at the first unsatisfiable day or at `cap` extensions (whichever comes
 *    first — `cap` is a safety bound against runaway open-ended availability).
 *
 * Mutates each open run's array in place; returns the set of runs that were extended, so
 * the caller can distinguish "ends here for good" from "still open beyond what we searched".
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

/** Whether `node` is satisfiable on EVERY day of `selectedDates` — the check a chosen
 *  booking window must pass before devices are actually picked for it. */
export function isSatisfiableAcrossWindow(
  node: AssistNode,
  selectedDates: string[],
  isFree: IsFree,
): boolean {
  return selectedDates.every((date) => isNodeSatisfiable(node, date, isFree));
}

/**
 * Chooses which device ids to actually book for `node` over the window `selectedDates`.
 *
 * How it works: a device leaf just picks itself. A group sorts its children so the ones
 * satisfiable across the WHOLE window come first (preferring a device that's continuously
 * free over one that would need a mid-window substitution), takes the first `effectiveNeed`
 * of them, and recurses into each chosen child.
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

/** Distinct device ids chosen to satisfy the whole tree over window `selectedDates` — the
 *  union of {@link chooseDevicesForNode}'s picks for every top-level child. */
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
// Drag-and-drop tree edits
// ---------------------------------------------------------------------------------------
// Each of these mutates `tree` in place and calls `treeCleanup` itself, so every edit
// leaves the tree in a normalized state before the caller (the React component) re-renders
// it — the DOM/drag-and-drop chrome itself lives entirely in the component, not here.

/**
 * Drags a device/group onto another node: wraps both in a new 2-child "need 1 of 2" group,
 * colored from the next hue in the caller's cycle. A no-op when dragging onto itself, or
 * onto a node that's already an ancestor of the drag target (that would nest a group inside
 * its own descendant).
 */
export function groupNodeOnto(
  tree: AssistContainer,
  dragUid: string,
  targetUid: string,
  newUid: () => string,
  newColor: () => number,
): void {
  if (dragUid === targetUid || treeIsAncestor(tree, dragUid, targetUid)) return;
  const dragNode = treeDetach(tree, dragUid);
  if (!dragNode) return;
  const parent = treeFindParent(tree, targetUid);
  if (!parent) {
    tree.children.push(dragNode);
    return;
  }
  const targetIndex = parent.children.findIndex((child) => child.uid === targetUid);
  const targetNode = parent.children[targetIndex]!;
  parent.children.splice(targetIndex, 1, {
    uid: newUid(),
    type: 'grp',
    need: 1,
    color: newColor(),
    children: [targetNode, dragNode],
  });
  treeCleanup(tree);
}

/** Moves a dragged node into an existing group. A no-op if the target group is an ancestor
 *  of the dragged node, doesn't exist, or isn't actually a group. */
export function joinNode(tree: AssistContainer, dragUid: string, groupUid: string): void {
  if (treeIsAncestor(tree, dragUid, groupUid)) return;
  const group = treeFind(tree, groupUid);
  if (!group || group.type !== 'grp') return;
  const node = treeDetach(tree, dragUid);
  if (!node) return;
  group.children.push(node);
  treeCleanup(tree);
}

/** Moves a dragged node back to the tree root — dropped on empty canvas, outside any group. */
export function moveNodeToRoot(tree: AssistContainer, dragUid: string): void {
  const node = treeDetach(tree, dragUid);
  if (!node) return;
  tree.children.push(node);
  treeCleanup(tree);
}

/** Dissolves a group, promoting its children up to its own position in the parent. */
export function dissolveGroup(tree: AssistContainer, groupUid: string): void {
  const group = treeFind(tree, groupUid);
  const parent = treeFindParent(tree, groupUid);
  if (!group || group.type !== 'grp' || !parent) return;
  const index = parent.children.findIndex((child) => child.uid === groupUid);
  parent.children.splice(index, 1, ...group.children);
  treeCleanup(tree);
}

/** Changes a group's `need` by `delta` (the stepper buttons' +1/-1), clamped to
 *  `1..childCount` so it can never ask for more devices than the group has, or fewer than 1. */
export function changeGroupNeed(tree: AssistContainer, groupUid: string, delta: number): void {
  const group = treeFind(tree, groupUid);
  if (!group || group.type !== 'grp') return;
  group.need = Math.max(1, Math.min(group.children.length, group.need + delta));
}

/** Sets a group's `need` to an absolute value (typed directly into the number input, as
 *  opposed to `changeGroupNeed`'s relative +1/-1 stepper), clamped to `1..childCount`. */
export function setGroupNeed(tree: AssistContainer, groupUid: string, value: number): void {
  const group = treeFind(tree, groupUid);
  if (!group || group.type !== 'grp') return;
  group.need = Math.max(1, Math.min(group.children.length, value));
}

/** Removes a node (device or group, with all its descendants) from the tree entirely, then
 *  normalizes what's left. The DOM checkbox side effect (unchecking the removed device in
 *  the picker) is the caller's own responsibility, not this function's. */
export function removeNode(tree: AssistContainer, uid: string): void {
  treeDetach(tree, uid);
  treeCleanup(tree);
}

/** Adds a device to the tree root, unless it's already present anywhere in the tree (as a
 *  bare leaf or nested inside a group). Returns whether it was actually added. */
export function addDeviceToTree(
  tree: AssistContainer,
  deviceId: string,
  newUid: () => string,
): boolean {
  if (treeDevs(tree).includes(deviceId)) return false;
  tree.children.push({ uid: newUid(), type: 'dev', id: deviceId });
  return true;
}
