// Pure logic for the booking Assistant, extracted from the monolith (legacy.js): the
// device/group tree operations AND the N-of-M scheduling solver. No DOM, no globals — the
// tree is passed explicitly, and device availability is supplied via an injected `isFree`
// predicate, so the solver is a pure function of (tree, calendar days, availability).
//
// The Assistant lets the user pick devices and drag equivalents onto each other to form
// "need N of M" groups. The tree is: a root/group container holds children, each child is a
// device leaf or a nested group (with a `need` count). The DOM rendering, drag-and-drop, and
// the availability source (bookings/maintenance) stay in legacy.js; this is the pure kernel.
//
// Naming note: the seven `treeXxx` tree operations are called ONLY through legacy.js's
// one-line `asXxx` adapters (e.g. `asFind` calls `treeFind`) — never directly by bare name —
// so they'd need no bridge alias even if renamed. They're left as-is because "tree" + a verb
// is already a full, descriptive name, nothing to shorten. `hasAnyRedundancy` and
// `chooseDevicesForTree`, by contrast, ARE called directly by bare name in `legacy.js`
// (`runAssistant`) under their OLD names (`anyRedund`, `pickFor`) — those old names survive
// only as the aliases at the bottom of this file, deleted whole in Phase 7 slice B10.

import { parseIsoDateString, addDays, isWeekend, formatDateAsIsoString } from './dates.ts';

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

/** Find a node by uid anywhere in the tree, or null. */
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

/** Find the container that directly holds `uid`, or null. */
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

/** True if `aUid` is `bUid` or an ancestor group of it. */
export function treeIsAncestor(root: AssistContainer, aUid: string, bUid: string): boolean {
  if (aUid === bUid) return true;
  const ancestorNode = treeFind(root, aUid);
  return !!ancestorNode && ancestorNode.type === 'grp' && !!treeFind(ancestorNode, bUid);
}

/** Remove the node `uid` from the tree and return it (or null if not found). Mutates the tree. */
export function treeDetach(root: AssistContainer, uid: string): AssistNode | null {
  const parent = treeFindParent(root, uid);
  if (!parent) return null;
  const index = parent.children.findIndex((child) => child.uid === uid);
  return parent.children.splice(index, 1)[0]!;
}

/** All device ids in the tree, in order (flattening groups). */
export function treeDevs(node: AssistContainer): string[] {
  let deviceIds: string[] = [];
  for (const child of node.children) {
    if (child.type === 'dev') deviceIds.push(child.id);
    else deviceIds = deviceIds.concat(treeDevs(child));
  }
  return deviceIds;
}

/** The uid of the device leaf whose device id is `id`, or null. */
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
 * Normalize the tree in place: recurse first, then drop empty groups, dissolve single-child
 * groups (promoting the child), and clamp each surviving group's `need` to 1..childCount.
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

// ---- N-of-M scheduling solver ----------------------------------------------------------
// Availability is injected: `isFree(deviceId, isoDay)` is true when that device is bookable
// that day (in legacy.js: not booked, not blocked, weekday available). Keeps the solver pure.

/** Whether device `id` is free on ISO day `day`. */
export type IsFree = (id: string, day: string) => boolean;

/** A group's effective requirement, clamped to 1..childCount. */
export function effectiveNeed(group: AssistGrp): number {
  return Math.max(1, Math.min(group.children.length, group.need));
}

/** Is `node` satisfiable on `day`? A device: free. A group: at least `need` children free. */
export function isNodeSatisfiable(node: AssistNode, day: string, isFree: IsFree): boolean {
  return node.type === 'dev'
    ? isFree(node.id, day)
    : node.children.filter((child) => isNodeSatisfiable(child, day, isFree)).length >=
        effectiveNeed(node);
}

/** Is the whole tree satisfiable on `day`? (Root = AND over its children.) */
export function isTreeSatisfiableOnDay(
  root: AssistContainer,
  day: string,
  isFree: IsFree,
): boolean {
  return root.children.every((child) => isNodeSatisfiable(child, day, isFree));
}

/** True if any group carries real redundancy (more children than it needs), anywhere. */
export function hasAnyRedundancy(node: AssistContainer): boolean {
  return node.children.some(
    (child) =>
      child.type === 'grp' &&
      (child.children.length > effectiveNeed(child) || hasAnyRedundancy(child)),
  );
}

/** The next weekday (Mon–Fri) ISO date strictly after `isoDateString`, skipping weekends. */
export function nextWeekday(isoDateString: string): string {
  let candidateDate = addDays(parseIsoDateString(isoDateString), 1);
  while (isWeekend(candidateDate)) {
    candidateDate = addDays(candidateDate, 1);
  }
  return formatDateAsIsoString(candidateDate);
}

/** Of `days`, those on which the whole tree is satisfiable. */
export function freeDays(root: AssistContainer, days: string[], isFree: IsFree): string[] {
  return days.filter((day) => isTreeSatisfiableOnDay(root, day, isFree));
}

/** Split a sorted list of free days into weekday-contiguous runs. */
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
 * Runs that reach the end of the search window `to` are "open": extend them (in place) while
 * the whole tree stays free, up to `cap` days. Returns the set of runs that were extended.
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

/** Is `node` free on every day of the window `selectedDates`? */
export function isSatisfiableAcrossWindow(
  node: AssistNode,
  selectedDates: string[],
  isFree: IsFree,
): boolean {
  return selectedDates.every((date) => isNodeSatisfiable(node, date, isFree));
}

/** Device ids chosen to satisfy `node` over window `selectedDates`, preferring continuously-free ones. */
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

/** Distinct device ids chosen to satisfy the whole tree over window `selectedDates`. */
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

// ---- Legacy bridge aliases -------------------------------------------------------
// `legacy.js`'s `runAssistant` calls these by their OLD names as bare globals; it is
// deliberately NOT edited by this pass — it's deleted whole in Phase 7 slice B10. Delete
// this block in that slice. No new code may import from here.
export const anyRedund = hasAnyRedundancy;
export const pickFor = chooseDevicesForTree;
