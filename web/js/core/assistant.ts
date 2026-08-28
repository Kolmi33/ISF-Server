// Pure logic for the booking Assistant, extracted from the monolith (legacy.js): the
// device/group tree operations AND the N-of-M scheduling solver. No DOM, no globals — the
// tree is passed explicitly, and device availability is supplied via an injected `isFree`
// predicate, so the solver is a pure function of (tree, calendar days, availability).
//
// The Assistant lets the user pick devices and drag equivalents onto each other to form
// "need N of M" groups. The tree is: a root/group container holds children, each child is a
// device leaf or a nested group (with a `need` count). The DOM rendering, drag-and-drop, and
// the availability source (bookings/maintenance) stay in legacy.js; this is the pure kernel.

import { parseYmd, addDays, isWeekend, ymd } from './dates.ts';

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
  for (const c of node.children) {
    if (c.uid === uid) return c;
    if (c.type === 'grp') {
      const r = treeFind(c, uid);
      if (r) return r;
    }
  }
  return null;
}

/** Find the container that directly holds `uid`, or null. */
export function treeFindParent(node: AssistContainer, uid: string): AssistContainer | null {
  for (const c of node.children) {
    if (c.uid === uid) return node;
    if (c.type === 'grp') {
      const r = treeFindParent(c, uid);
      if (r) return r;
    }
  }
  return null;
}

/** True if `aUid` is `bUid` or an ancestor group of it. */
export function treeIsAncestor(root: AssistContainer, aUid: string, bUid: string): boolean {
  if (aUid === bUid) return true;
  const a = treeFind(root, aUid);
  return !!a && a.type === 'grp' && !!treeFind(a, bUid);
}

/** Remove the node `uid` from the tree and return it (or null if not found). Mutates the tree. */
export function treeDetach(root: AssistContainer, uid: string): AssistNode | null {
  const p = treeFindParent(root, uid);
  if (!p) return null;
  const i = p.children.findIndex((c) => c.uid === uid);
  return p.children.splice(i, 1)[0]!;
}

/** All device ids in the tree, in order (flattening groups). */
export function treeDevs(node: AssistContainer): string[] {
  let a: string[] = [];
  for (const c of node.children) {
    if (c.type === 'dev') a.push(c.id);
    else a = a.concat(treeDevs(c));
  }
  return a;
}

/** The uid of the device leaf whose device id is `id`, or null. */
export function treeDevUid(node: AssistContainer, id: string): string | null {
  for (const c of node.children) {
    if (c.type === 'dev' && c.id === id) return c.uid;
    if (c.type === 'grp') {
      const r = treeDevUid(c, id);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Normalize the tree in place: recurse first, then drop empty groups, dissolve single-child
 * groups (promoting the child), and clamp each surviving group's `need` to 1..childCount.
 */
export function treeCleanup(node: AssistContainer): void {
  for (const c of node.children) if (c.type === 'grp') treeCleanup(c);
  node.children = node.children.flatMap((c) => {
    if (c.type !== 'grp') return [c];
    if (c.children.length === 0) return []; // remove empty group
    if (c.children.length === 1) return [c.children[0]!]; // dissolve single-element group
    c.need = Math.max(1, Math.min(c.children.length, c.need));
    return [c];
  });
}

// ---- N-of-M scheduling solver ----------------------------------------------------------
// Availability is injected: `isFree(deviceId, isoDay)` is true when that device is bookable
// that day (in legacy.js: not booked, not blocked, weekday available). Keeps the solver pure.

/** Whether device `id` is free on ISO day `d`. */
export type IsFree = (id: string, day: string) => boolean;

/** A group's effective requirement, clamped to 1..childCount. */
export function nodeNeed(g: AssistGrp): number {
  return Math.max(1, Math.min(g.children.length, g.need));
}

/** Is `node` satisfiable on day `d`? A device: free. A group: at least `need` children free. */
export function nodeFree(node: AssistNode, d: string, isFree: IsFree): boolean {
  return node.type === 'dev'
    ? isFree(node.id, d)
    : node.children.filter((c) => nodeFree(c, d, isFree)).length >= nodeNeed(node);
}

/** Is the whole tree satisfiable on day `d`? (Root = AND over its children.) */
export function dayOk(root: AssistContainer, d: string, isFree: IsFree): boolean {
  return root.children.every((c) => nodeFree(c, d, isFree));
}

/** True if any group carries real redundancy (more children than it needs), anywhere. */
export function anyRedund(node: AssistContainer): boolean {
  return node.children.some(
    (c) => c.type === 'grp' && (c.children.length > nodeNeed(c) || anyRedund(c)),
  );
}

/** The next weekday (Mon–Fri) ISO date strictly after `s`, skipping weekends. */
export function nextWeekday(s: string): string {
  let d = parseYmd(s);
  do {
    d = addDays(d, 1);
  } while (isWeekend(d));
  return ymd(d);
}

/** Of `days`, those on which the whole tree is satisfiable. */
export function freeDays(root: AssistContainer, days: string[], isFree: IsFree): string[] {
  return days.filter((d) => dayOk(root, d, isFree));
}

/** Split a sorted list of free days into weekday-contiguous runs. */
export function groupRuns(free: string[]): string[][] {
  const runs: string[][] = [];
  let cur: string[] = [];
  for (const d of free) {
    if (cur.length && nextWeekday(cur[cur.length - 1]!) === d) cur.push(d);
    else {
      if (cur.length) runs.push(cur);
      cur = [d];
    }
  }
  if (cur.length) runs.push(cur);
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
  const open = new Set<string[]>();
  for (const r of runs) {
    if (nextWeekday(r[r.length - 1]!) > to) {
      open.add(r);
      let d = nextWeekday(r[r.length - 1]!);
      let n = 0;
      while (dayOk(root, d, isFree) && n < cap) {
        r.push(d);
        d = nextWeekday(d);
        n++;
      }
    }
  }
  return open;
}

/** Is `node` free on every day of the window `sel`? */
export function winFree(node: AssistNode, sel: string[], isFree: IsFree): boolean {
  return sel.every((d) => nodeFree(node, d, isFree));
}

/** Device ids chosen to satisfy `node` over window `sel`, preferring continuously-free ones. */
export function pickNode(node: AssistNode, sel: string[], isFree: IsFree): string[] {
  return node.type === 'dev'
    ? [node.id]
    : [...node.children]
        .sort((a, b) => (winFree(b, sel, isFree) ? 1 : 0) - (winFree(a, sel, isFree) ? 1 : 0))
        .slice(0, nodeNeed(node))
        .flatMap((c) => pickNode(c, sel, isFree));
}

/** Distinct device ids chosen to satisfy the whole tree over window `sel`. */
export function pickFor(root: AssistContainer, sel: string[], isFree: IsFree): string[] {
  return [...new Set(root.children.flatMap((c) => pickNode(c, sel, isFree)))];
}
