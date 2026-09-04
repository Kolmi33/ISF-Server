import { describe, it, expect } from 'vitest';
import type { AssistContainer, AssistNode, AssistGrp, IsFree } from './assistant.ts';
import {
  treeFind,
  treeFindParent,
  treeIsAncestor,
  treeDetach,
  treeDevs,
  treeDevUid,
  treeCleanup,
  effectiveNeed,
  isNodeSatisfiable,
  isTreeSatisfiableOnDay,
  freeDays,
  groupRuns,
  extendOpenRuns,
  isSatisfiableAcrossWindow,
  chooseDevicesForNode,
  chooseDevicesForTree,
  groupNodeOnto,
  joinNode,
  moveNodeToRoot,
  dissolveGroup,
  changeGroupNeed,
  setGroupNeed,
  removeNode,
  addDeviceToTree,
} from './assistant.ts';

const dev = (uid: string, id: string): AssistNode => ({ uid, type: 'dev', id });
const grp = (uid: string, need: number, children: AssistNode[]): AssistNode => ({
  uid,
  type: 'grp',
  need,
  children,
});

// root
//  ├─ dev n1 (A)
//  └─ grp n2 need=1
//       ├─ dev n3 (B)
//       └─ dev n4 (C)
function sample(): AssistContainer {
  return { children: [dev('n1', 'A'), grp('n2', 1, [dev('n3', 'B'), dev('n4', 'C')])] };
}

describe('treeFind', () => {
  // What: finds a node by uid whether it's at the root or nested inside a group.
  // How: looks up a top-level device, a device nested inside the sample tree's group, and
  // the group itself, checking each is found with the right shape.
  it('finds top-level and nested nodes', () => {
    const t = sample();
    expect(treeFind(t, 'n1')?.uid).toBe('n1');
    expect(treeFind(t, 'n3')?.type).toBe('dev'); // nested
    expect(treeFind(t, 'n2')?.type).toBe('grp');
  });
  // What: an unknown uid returns null rather than throwing.
  // How: looks up a uid that doesn't exist anywhere in the sample tree.
  it('returns null when not found', () => {
    expect(treeFind(sample(), 'nope')).toBeNull();
  });
});

describe('treeFindParent', () => {
  // What: returns the immediate container a node lives in — the root container itself for a
  // top-level node, or the enclosing group for a nested one.
  // How: checks a top-level device's parent is the root container, and a nested device's
  // parent is its enclosing group (with the expected child count).
  it('returns the direct container of a node', () => {
    const t = sample();
    expect(treeFindParent(t, 'n1')).toBe(t); // root
    expect(treeFindParent(t, 'n3')?.children.length).toBe(2); // the group
  });
  // What: an unknown uid has no parent to find.
  // How: looks up a uid that doesn't exist in the tree.
  it('returns null for the missing or the root itself', () => {
    expect(treeFindParent(sample(), 'nope')).toBeNull();
  });
});

describe('treeIsAncestor', () => {
  // What: a node counts as its own ancestor (reflexive), and a group is a real ancestor of
  // its own children.
  // How: checks a group uid against itself, and against a device nested inside it.
  it('is true for an equal uid or a real ancestor group', () => {
    const t = sample();
    expect(treeIsAncestor(t, 'n2', 'n2')).toBe(true); // equal
    expect(treeIsAncestor(t, 'n2', 'n3')).toBe(true); // group over its child
  });
  // What: a device is never an ancestor of anything (it has no children), and an unknown
  // candidate ancestor is never an ancestor either.
  // How: checks a device uid against another node, and a nonexistent uid against a real node.
  it('is false for a device "ancestor" or a missing node', () => {
    const t = sample();
    expect(treeIsAncestor(t, 'n1', 'n3')).toBe(false); // dev is never an ancestor
    expect(treeIsAncestor(t, 'nope', 'n3')).toBe(false); // a not found
  });
});

describe('treeDetach', () => {
  // What: detaching a nested node both removes it from the tree and returns it, so the caller
  // can reinsert it elsewhere.
  // How: detaches a device from inside the sample tree's group, checks the returned node and
  // that it's gone from a subsequent lookup, while its sibling (and the now-smaller group) stays.
  it('removes and returns a nested node, mutating the tree', () => {
    const t = sample();
    const n = treeDetach(t, 'n3');
    expect(n?.uid).toBe('n3');
    expect(treeFind(t, 'n3')).toBeNull();
    expect(treeFind(t, 'n2')).not.toBeNull(); // group still present (still has C)
  });
  // What: detaching an unknown uid returns null rather than throwing.
  // How: calls treeDetach with a uid that doesn't exist.
  it('returns null when the node is not found', () => {
    expect(treeDetach(sample(), 'nope')).toBeNull();
  });
});

describe('treeDevs', () => {
  // What: lists every device id in the tree, flattening groups into a single flat list.
  // How: checks the sample tree's three devices (one top-level, two nested in a group) all
  // come back in one flat array.
  it('lists all device ids, flattening groups', () => {
    expect(treeDevs(sample())).toEqual(['A', 'B', 'C']);
  });
});

describe('treeDevUid', () => {
  // What: maps a device's own id back to its tree uid, searching nested groups too.
  // How: looks up a device id that's nested inside the sample tree's group and checks the
  // uid it resolves to.
  it('maps a device id to its uid, including nested', () => {
    expect(treeDevUid(sample(), 'B')).toBe('n3');
  });
  // What: an id with no matching device returns null.
  // How: looks up a device id that doesn't exist anywhere in the tree.
  it('returns null for an unknown device id', () => {
    expect(treeDevUid(sample(), 'Z')).toBeNull();
  });
});

describe('treeCleanup', () => {
  // What: a loose top-level device is left exactly as it is — cleanup only ever acts on groups.
  // How: builds a tree with just one device and checks it's unchanged after cleanup.
  it('leaves loose devices untouched', () => {
    const t: AssistContainer = { children: [dev('n1', 'A')] };
    treeCleanup(t);
    expect(t.children.map((c) => c.uid)).toEqual(['n1']);
  });
  // What: a group with no children left is removed entirely rather than kept as an empty shell.
  // How: builds a tree with one device plus one empty group and checks the empty group is gone.
  it('removes empty groups', () => {
    const t: AssistContainer = { children: [dev('n1', 'A'), grp('g', 1, [])] };
    treeCleanup(t);
    expect(t.children.map((c) => c.uid)).toEqual(['n1']);
  });
  // What: a group left with exactly one child is dissolved, promoting that child up to the
  // group's own position (a group only makes sense with 2+ children to choose among).
  // How: builds a tree with one group holding a single device and checks the device replaces
  // the group directly.
  it('dissolves single-child groups, promoting the child', () => {
    const t: AssistContainer = { children: [grp('g', 1, [dev('n1', 'A')])] };
    treeCleanup(t);
    expect(t.children).toEqual([dev('n1', 'A')]);
  });
  // What: a group's `need` is clamped into the valid 1..childCount range, both above and below.
  // How: builds a 2-child group with need way above the count (clamps down to 2) and another
  // with need 0 (clamps up to 1).
  it('clamps need to 1..childCount', () => {
    const hi: AssistContainer = { children: [grp('g', 9, [dev('a', 'A'), dev('b', 'B')])] };
    treeCleanup(hi);
    expect((hi.children[0] as { need: number }).need).toBe(2);
    const lo: AssistContainer = { children: [grp('g', 0, [dev('a', 'A'), dev('b', 'B')])] };
    treeCleanup(lo);
    expect((lo.children[0] as { need: number }).need).toBe(1);
  });
  // What: cleanup works bottom-up — an inner empty group is removed before the outer group is
  // evaluated, so the outer group's remaining child count is correct.
  // How: builds an outer group containing two real devices plus one empty inner group, and
  // checks the inner group disappears while the outer group keeps its two real devices.
  it('recurses into nested groups (cleaning inner empties first)', () => {
    const t: AssistContainer = {
      children: [grp('outer', 1, [dev('a', 'A'), dev('b', 'B'), grp('inner', 1, [])])],
    };
    treeCleanup(t);
    // inner empty group removed → outer keeps its 2 devices
    const outer = t.children[0] as { children: AssistNode[] };
    expect(outer.children.map((c) => c.uid)).toEqual(['a', 'b']);
  });
});

// ---- solver ----------------------------------------------------------------------------
const mkGrp = (need: number, ids: string[]): AssistGrp => ({
  uid: 'g',
  type: 'grp',
  need,
  children: ids.map((id) => dev('d_' + id, id)),
});
// isFree from a set of "id@day" strings.
const freeOn =
  (pairs: string[]): IsFree =>
  (id, day) =>
    pairs.includes(`${id}@${day}`);

describe('effectiveNeed', () => {
  // What: a group's effective need is its stored `need` clamped into 1..childCount.
  // How: checks a need above the child count clamps down, a need of 0 clamps up to 1, and a
  // need already inside the valid range passes through unchanged.
  it('clamps need to 1..childCount', () => {
    expect(effectiveNeed(mkGrp(9, ['A', 'B', 'C']))).toBe(3);
    expect(effectiveNeed(mkGrp(0, ['A', 'B', 'C']))).toBe(1);
    expect(effectiveNeed(mkGrp(2, ['A', 'B', 'C']))).toBe(2);
  });
});

describe('isNodeSatisfiable', () => {
  // What: a device node is satisfiable exactly when the injected `isFree` predicate says so
  // for that device on that day.
  // How: checks the same device against a day it's marked free for and one it isn't.
  it('a device is free iff isFree says so', () => {
    expect(isNodeSatisfiable(dev('d', 'A'), 'X', freeOn(['A@X']))).toBe(true);
    expect(isNodeSatisfiable(dev('d', 'A'), 'X', freeOn([]))).toBe(false);
  });
  // What: a group node is satisfiable when at least its effective `need` count of children
  // are free that day — not necessarily all of them.
  // How: gives a need-2 group of 3 devices exactly 2 free on one day (satisfiable) and only 1
  // free on another (not satisfiable).
  it('a group needs at least `need` free children', () => {
    const g = mkGrp(2, ['A', 'B', 'C']);
    expect(isNodeSatisfiable(g, 'X', freeOn(['A@X', 'B@X']))).toBe(true); // 2 of 3 free
    expect(isNodeSatisfiable(g, 'Y', freeOn(['A@Y']))).toBe(false); // only 1 free
  });
});

describe('isTreeSatisfiableOnDay', () => {
  // What: the whole tree is satisfiable on a day only when EVERY root-level child is
  // individually satisfiable (a logical AND, not "at least one").
  // How: checks two top-level devices both free on a day (satisfiable) versus only one of
  // them free (not satisfiable).
  it('is the AND over the root children', () => {
    const root: AssistContainer = { children: [dev('a', 'A'), dev('b', 'B')] };
    expect(isTreeSatisfiableOnDay(root, 'X', freeOn(['A@X', 'B@X']))).toBe(true);
    expect(isTreeSatisfiableOnDay(root, 'X', freeOn(['A@X']))).toBe(false); // B not free
  });
});

describe('freeDays / groupRuns', () => {
  // What: freeDays filters a day list down to only the days the tree is satisfiable on.
  // How: checks a 3-day window where the middle day isn't free, keeping only the two outer days.
  it('freeDays keeps only satisfiable days', () => {
    const root: AssistContainer = { children: [dev('a', 'A')] };
    const days = ['2021-01-11', '2021-01-12', '2021-01-13'];
    expect(freeDays(root, days, freeOn(['A@2021-01-11', 'A@2021-01-13']))).toEqual([
      '2021-01-11',
      '2021-01-13',
    ]);
  });
  // What: groupRuns splits a day list into contiguous-workday runs, where a Friday followed
  // by the next Monday counts as adjacent (no weekend gap) but any other gap breaks the run.
  // How: checks an empty list, a Fri+Mon pair (one run), and a run with a genuine 2-day gap
  // (splits into two separate runs).
  it('groupRuns splits into weekday-contiguous runs (Fri+Mon are adjacent)', () => {
    expect(groupRuns([])).toEqual([]);
    expect(groupRuns(['2021-01-08', '2021-01-11'])).toEqual([['2021-01-08', '2021-01-11']]);
    expect(groupRuns(['2021-01-11', '2021-01-12', '2021-01-14'])).toEqual([
      ['2021-01-11', '2021-01-12'],
      ['2021-01-14'],
    ]);
  });
});

describe('extendOpenRuns', () => {
  const root: AssistContainer = { children: [dev('a', 'A')] };
  // What: a run whose last day is exactly the search window's end is a candidate to extend
  // further, as long as the tree stays satisfiable on the following days.
  // How: gives a run ending exactly at the window boundary, with two more free days beyond
  // it, and checks both days got appended and the run is reported as "open" (extended).
  it('extends a run that reaches the window end while still free', () => {
    const runs = [['2021-01-11', '2021-01-12']];
    const open = extendOpenRuns(root, runs, '2021-01-12', freeOn(['A@2021-01-13', 'A@2021-01-14']));
    expect(runs[0]).toEqual(['2021-01-11', '2021-01-12', '2021-01-13', '2021-01-14']);
    expect(open.has(runs[0]!)).toBe(true);
  });
  // What: a run that doesn't reach the window's end isn't a candidate for extension at all —
  // it's left exactly as it was.
  // How: gives a run ending well before the window end and checks it's unchanged and not
  // marked open.
  it('leaves a run untouched when it does not reach the window end', () => {
    const runs = [['2021-01-11', '2021-01-12']];
    const open = extendOpenRuns(root, runs, '2021-01-20', freeOn([]));
    expect(runs[0]).toEqual(['2021-01-11', '2021-01-12']);
    expect(open.size).toBe(0);
  });
  // What: extension respects a maximum-days-to-add cap, rather than extending as far as the
  // free days allow.
  // How: gives a run at the window boundary with two more free days available, but caps the
  // extension at 1, and checks only one day was actually appended.
  it('honors the extension cap', () => {
    const runs = [['2021-01-12']];
    extendOpenRuns(root, runs, '2021-01-12', freeOn(['A@2021-01-13', 'A@2021-01-14']), 1);
    expect(runs[0]!.length).toBe(2); // +1 only
  });
});

describe('isSatisfiableAcrossWindow / chooseDevicesForNode / chooseDevicesForTree', () => {
  const sel = ['2021-01-11', '2021-01-12'];
  // What: a node is satisfiable "across the window" only when it's satisfiable on EVERY day
  // in the window, not just some of them.
  // How: checks a need-2 group with enough devices free on both window days (satisfiable)
  // versus only free on the first day (not satisfiable).
  it('isSatisfiableAcrossWindow requires the node free on every window day', () => {
    const g = mkGrp(2, ['A', 'B', 'C']);
    const allFree = freeOn(['A@2021-01-11', 'B@2021-01-11', 'A@2021-01-12', 'B@2021-01-12']);
    expect(isSatisfiableAcrossWindow(g, sel, allFree)).toBe(true);
    expect(isSatisfiableAcrossWindow(g, sel, freeOn(['A@2021-01-11']))).toBe(false);
  });
  // What: for a bare device node, the "chosen devices" is trivially just that one device's id.
  // How: calls chooseDevicesForNode directly on a device (not a group) and checks the result.
  it('chooseDevicesForNode returns a device id directly', () => {
    expect(chooseDevicesForNode(dev('a', 'A'), sel, freeOn(['A@2021-01-11']))).toEqual(['A']);
  });
  // What: when picking among a group's devices, the solver prefers whichever device is free
  // across the WHOLE window over one that's only free part of it.
  // How: sets up a need-1 group of two devices where B is free both window days and A only
  // the first, and checks B (the fully-free one) is the one chosen.
  it('chooseDevicesForTree prefers devices free across the whole window', () => {
    const root: AssistContainer = { children: [mkGrp(1, ['A', 'B'])] };
    // B free both days, A only the first → B is chosen for a need-1 group
    const isFree = freeOn(['B@2021-01-11', 'B@2021-01-12', 'A@2021-01-11']);
    expect(chooseDevicesForTree(root, sel, isFree)).toEqual(['B']);
  });
  // What: the same "continuously free wins" preference holds even with more candidates to
  // choose among (a 3-device group, not just 2).
  // How: sets up a need-1 group of three devices where only B is free across both window
  // days (A and C are each free on just one day) and checks B is chosen.
  it('ranks the continuously-free device first in a larger group', () => {
    const root: AssistContainer = { children: [mkGrp(1, ['A', 'B', 'C'])] };
    // only B is free across BOTH days; A and C each free on just one → B wins
    const isFree = freeOn(['B@2021-01-11', 'B@2021-01-12', 'A@2021-01-11', 'C@2021-01-12']);
    expect(chooseDevicesForTree(root, sel, isFree)).toEqual(['B']);
  });
});

describe('groupNodeOnto', () => {
  const newUid = () => 'new';

  // What: dragging one node onto another wraps both into a brand-new need-1-of-2 group (at
  // the target's old position), with the target listed first and the dragged node appended.
  // How: drags a root-level device onto a device nested inside an existing group, and checks
  // the new group's shape, its children order, that the dragged node now resolves inside the
  // new group, and that root no longer lists it directly.
  it('wraps the drag node and target in a new need-1-of-2 group', () => {
    const tree = sample();
    const result = groupNodeOnto(tree, 'n1', 'n3', newUid); // n1 (root) onto n3 (inside n2)
    const n2 = treeFind(tree, 'n2') as AssistGrp;
    const newGroup = n2.children[0] as AssistGrp;
    expect(newGroup).toMatchObject({ uid: 'new', type: 'grp', need: 1 });
    expect(newGroup.children).toEqual([dev('n3', 'B'), dev('n1', 'A')]);
    expect(treeFind(tree, 'n1')).not.toBeNull(); // n1 now lives inside the new group
    expect(tree.children.map((c) => c.uid)).toEqual(['n2']); // gone from root
    // Returns the new group's own uid — callers (AssistantModal.tsx's mixed-category confirm)
    // check the resulting group afterward.
    expect(result).toBe('new');
  });

  // What: dragging a node onto itself is a meaningless operation and changes nothing.
  // How: calls groupNodeOnto with the same uid as both drag source and target and checks the
  // tree is byte-identical to a fresh sample.
  it('is a no-op when dragging a node onto itself', () => {
    const tree = sample();
    const result = groupNodeOnto(tree, 'n1', 'n1', newUid);
    expect(tree).toEqual(sample());
    expect(result).toBeNull();
  });

  // What: dragging a group onto one of its own descendants would create a cycle, so it's refused.
  // How: drags the sample tree's group onto a device nested inside that same group and checks
  // nothing changed.
  it('is a no-op when dragging a group onto its own descendant', () => {
    const tree = sample();
    groupNodeOnto(tree, 'n2', 'n3', newUid);
    expect(tree).toEqual(sample());
  });

  // What: if the target uid can't be found (so it has no parent to wrap into a group), the
  // drag node is still moved — just pushed to the root instead of grouped.
  // How: drags a real node onto a nonexistent target uid and checks the drag node ends up
  // among the root's children.
  it('falls back to pushing the drag node to root when the target has no parent (not found)', () => {
    const tree = sample();
    groupNodeOnto(tree, 'n1', 'missing', newUid);
    expect(tree.children.some((c) => c.uid === 'n1')).toBe(true);
  });

  // What: if the drag node itself doesn't exist, there's nothing to move — a clean no-op.
  // How: calls groupNodeOnto with a nonexistent drag uid and checks nothing changed.
  it('no-ops when the drag node does not exist', () => {
    const tree = sample();
    groupNodeOnto(tree, 'missing', 'n3', newUid);
    expect(tree).toEqual(sample());
  });
});

describe('joinNode', () => {
  // What: joining moves the dragged node into an EXISTING target group (appended at the end),
  // unlike groupNodeOnto which creates a brand-new group.
  // How: joins a root-level device into the sample tree's existing group and checks it's
  // appended after the group's original children, and no longer listed at root.
  it('moves the dragged node into the target group', () => {
    const tree = sample();
    joinNode(tree, 'n1', 'n2');
    const n2 = treeFind(tree, 'n2') as AssistGrp;
    expect(n2.children.map((c) => c.uid)).toEqual(['n3', 'n4', 'n1']);
    expect(tree.children.map((c) => c.uid)).toEqual(['n2']);
  });

  // What: joining a group into itself (or into its own ancestor) is refused, since a group
  // can't become its own child.
  // How: calls joinNode with the same uid for both drag node and target group.
  it('is a no-op when the target is an ancestor of the drag node (or is itself)', () => {
    const tree = sample();
    joinNode(tree, 'n2', 'n2');
    expect(tree).toEqual(sample());
  });

  // What: joining requires a real target that is actually a group — an unknown uid, or a uid
  // that resolves to a device instead, both refuse the join.
  // How: tries joining into a nonexistent target, then tries joining a device INTO another
  // device (not a group), checking both leave the tree unchanged.
  it('is a no-op when the target does not exist or is not a group', () => {
    const tree = sample();
    joinNode(tree, 'n1', 'missing');
    expect(tree).toEqual(sample());
    joinNode(tree, 'n3', 'n1'); // n1 is a dev, not a group
    expect(tree).toEqual(sample());
  });

  // What: if the drag node itself doesn't exist, there's nothing to join — a clean no-op.
  // How: calls joinNode with a nonexistent drag uid.
  it('is a no-op when the drag node does not exist', () => {
    const tree = sample();
    joinNode(tree, 'missing', 'n2');
    expect(tree).toEqual(sample());
  });
});

describe('moveNodeToRoot', () => {
  // What: moving a nested node to the root detaches it from its group and appends it at the
  // top level; if that leaves the old group with just one child, cleanup dissolves it too.
  // How: moves one of the sample tree's two nested devices to root (leaving the group with
  // only its other child) and checks the final root order: the dissolved group's remaining
  // child promoted up, followed by the moved node.
  it('detaches the node and appends it to the root, cleaning up an emptied group', () => {
    const tree = sample();
    moveNodeToRoot(tree, 'n3'); // n2 drops to 1 child (n4) → dissolved by cleanup
    expect(tree.children.map((c) => c.uid)).toEqual(['n1', 'n4', 'n3']);
  });

  // What: moving a nonexistent node to root is a clean no-op.
  // How: calls moveNodeToRoot with a uid that isn't in the tree.
  it('is a no-op when the node does not exist', () => {
    const tree = sample();
    moveNodeToRoot(tree, 'missing');
    expect(tree).toEqual(sample());
  });
});

describe('dissolveGroup', () => {
  // What: dissolving a group promotes all of its children up to the group's own position in
  // its parent, removing the group itself.
  // How: dissolves the sample tree's one group and checks its two children now sit directly
  // among the root's children, in the group's old order, right after the original root device.
  it("promotes the group's children to its own position", () => {
    const tree = sample();
    dissolveGroup(tree, 'n2');
    expect(tree.children.map((c) => c.uid)).toEqual(['n1', 'n3', 'n4']);
  });

  // What: dissolving only makes sense for an actual group with a parent — a device uid, or an
  // unknown uid, both refuse and change nothing.
  // How: calls dissolveGroup on a device uid and on a nonexistent uid, checking the tree stays
  // unchanged after both.
  it('is a no-op for a dev uid, a missing uid, or a node with no parent', () => {
    const tree = sample();
    dissolveGroup(tree, 'n1'); // a dev, not a group
    dissolveGroup(tree, 'missing');
    expect(tree).toEqual(sample());
  });
});

describe('changeGroupNeed', () => {
  // What: a relative +1 change increments need but never past the group's child count.
  // How: increments the sample tree's 2-child group's need from 1 to 2, then increments again
  // and checks it stays clamped at 2 (the max for 2 children).
  it('increments and clamps to the child count', () => {
    const tree = sample();
    changeGroupNeed(tree, 'n2', 1);
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(2);
    changeGroupNeed(tree, 'n2', 1); // already at the 2-child max
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(2);
  });

  // What: a relative -1 change decrements need but never below 1.
  // How: decrements the sample tree's group (already at its minimum need of 1) and checks it
  // stays clamped at 1 rather than going to 0.
  it('decrements and clamps to 1', () => {
    const tree = sample();
    changeGroupNeed(tree, 'n2', -1); // already at 1
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(1);
  });

  // What: changing need only applies to a real group — a missing uid or a device uid both
  // refuse and leave the tree untouched.
  // How: calls changeGroupNeed with a nonexistent uid and with a device's uid, checking
  // neither had any effect.
  it('is a no-op for a missing uid or a dev uid', () => {
    const tree = sample();
    changeGroupNeed(tree, 'missing', 1);
    changeGroupNeed(tree, 'n1', 1);
    expect(tree).toEqual(sample());
  });
});

describe('setGroupNeed', () => {
  // What: sets an absolute need value (not relative), still clamped into 1..childCount.
  // How: sets the sample tree's 2-child group's need to 2 (in range), then to 99 (clamps down
  // to 2), then to 0 (clamps up to 1), checking the clamped value after each.
  it('sets an absolute value, clamped to 1..childCount', () => {
    const tree = sample();
    setGroupNeed(tree, 'n2', 2);
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(2);
    setGroupNeed(tree, 'n2', 99);
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(2); // clamped to childCount
    setGroupNeed(tree, 'n2', 0);
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(1); // clamped to 1
  });

  // What: like changeGroupNeed, setGroupNeed only applies to a real group.
  // How: calls setGroupNeed with a nonexistent uid and with a device's uid, checking neither
  // had any effect.
  it('is a no-op for a missing uid or a dev uid', () => {
    const tree = sample();
    setGroupNeed(tree, 'missing', 2);
    setGroupNeed(tree, 'n1', 2);
    expect(tree).toEqual(sample());
  });
});

describe('removeNode', () => {
  // What: removing a device deletes it from the tree, and if that empties its group down to
  // one remaining child, cleanup dissolves that group too.
  // How: removes one of the sample tree's two nested devices (leaving the group with only its
  // other child) and checks the root ends up with the original device plus the promoted
  // survivor, with the group itself gone.
  it('removes a device, cleaning up an emptied group', () => {
    const tree = sample();
    removeNode(tree, 'n3'); // n2 drops to 1 child (n4) → dissolved
    expect(tree.children.map((c) => c.uid)).toEqual(['n1', 'n4']);
  });

  // What: removing a uid that doesn't exist is a clean no-op.
  // How: calls removeNode with a uid not present in the tree.
  it('is a no-op when the uid does not exist', () => {
    const tree = sample();
    removeNode(tree, 'missing');
    expect(tree).toEqual(sample());
  });
});

describe('addDeviceToTree', () => {
  // What: adding a brand-new device id appends it as a root-level device and reports success.
  // How: adds a device to an empty tree and checks both the true return value and the tree's
  // resulting shape.
  it('adds a new device to the root and reports success', () => {
    const tree: AssistContainer = { children: [] };
    expect(addDeviceToTree(tree, 'X', () => 'uidX')).toBe(true);
    expect(tree.children).toEqual([{ uid: 'uidX', type: 'dev', id: 'X' }]);
  });

  // What: a device id already present ANYWHERE in the tree — even nested inside a group —
  // can't be added again; the call reports failure and leaves the tree untouched.
  // How: tries adding a device id that's already nested inside the sample tree's group, and
  // checks it's refused with no change to the tree.
  it('refuses a device already present anywhere in the tree (including nested)', () => {
    const tree = sample(); // 'B' is nested inside grp n2
    expect(addDeviceToTree(tree, 'B', () => 'uidB')).toBe(false);
    expect(tree).toEqual(sample());
  });
});
