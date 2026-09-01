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
  hasAnyRedundancy,
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
  it('finds top-level and nested nodes', () => {
    const t = sample();
    expect(treeFind(t, 'n1')?.uid).toBe('n1');
    expect(treeFind(t, 'n3')?.type).toBe('dev'); // nested
    expect(treeFind(t, 'n2')?.type).toBe('grp');
  });
  it('returns null when not found', () => {
    expect(treeFind(sample(), 'nope')).toBeNull();
  });
});

describe('treeFindParent', () => {
  it('returns the direct container of a node', () => {
    const t = sample();
    expect(treeFindParent(t, 'n1')).toBe(t); // root
    expect(treeFindParent(t, 'n3')?.children.length).toBe(2); // the group
  });
  it('returns null for the missing or the root itself', () => {
    expect(treeFindParent(sample(), 'nope')).toBeNull();
  });
});

describe('treeIsAncestor', () => {
  it('is true for an equal uid or a real ancestor group', () => {
    const t = sample();
    expect(treeIsAncestor(t, 'n2', 'n2')).toBe(true); // equal
    expect(treeIsAncestor(t, 'n2', 'n3')).toBe(true); // group over its child
  });
  it('is false for a device "ancestor" or a missing node', () => {
    const t = sample();
    expect(treeIsAncestor(t, 'n1', 'n3')).toBe(false); // dev is never an ancestor
    expect(treeIsAncestor(t, 'nope', 'n3')).toBe(false); // a not found
  });
});

describe('treeDetach', () => {
  it('removes and returns a nested node, mutating the tree', () => {
    const t = sample();
    const n = treeDetach(t, 'n3');
    expect(n?.uid).toBe('n3');
    expect(treeFind(t, 'n3')).toBeNull();
    expect(treeFind(t, 'n2')).not.toBeNull(); // group still present (still has C)
  });
  it('returns null when the node is not found', () => {
    expect(treeDetach(sample(), 'nope')).toBeNull();
  });
});

describe('treeDevs', () => {
  it('lists all device ids, flattening groups', () => {
    expect(treeDevs(sample())).toEqual(['A', 'B', 'C']);
  });
});

describe('treeDevUid', () => {
  it('maps a device id to its uid, including nested', () => {
    expect(treeDevUid(sample(), 'B')).toBe('n3');
  });
  it('returns null for an unknown device id', () => {
    expect(treeDevUid(sample(), 'Z')).toBeNull();
  });
});

describe('treeCleanup', () => {
  it('leaves loose devices untouched', () => {
    const t: AssistContainer = { children: [dev('n1', 'A')] };
    treeCleanup(t);
    expect(t.children.map((c) => c.uid)).toEqual(['n1']);
  });
  it('removes empty groups', () => {
    const t: AssistContainer = { children: [dev('n1', 'A'), grp('g', 1, [])] };
    treeCleanup(t);
    expect(t.children.map((c) => c.uid)).toEqual(['n1']);
  });
  it('dissolves single-child groups, promoting the child', () => {
    const t: AssistContainer = { children: [grp('g', 1, [dev('n1', 'A')])] };
    treeCleanup(t);
    expect(t.children).toEqual([dev('n1', 'A')]);
  });
  it('clamps need to 1..childCount', () => {
    const hi: AssistContainer = { children: [grp('g', 9, [dev('a', 'A'), dev('b', 'B')])] };
    treeCleanup(hi);
    expect((hi.children[0] as { need: number }).need).toBe(2);
    const lo: AssistContainer = { children: [grp('g', 0, [dev('a', 'A'), dev('b', 'B')])] };
    treeCleanup(lo);
    expect((lo.children[0] as { need: number }).need).toBe(1);
  });
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
  it('clamps need to 1..childCount', () => {
    expect(effectiveNeed(mkGrp(9, ['A', 'B', 'C']))).toBe(3);
    expect(effectiveNeed(mkGrp(0, ['A', 'B', 'C']))).toBe(1);
    expect(effectiveNeed(mkGrp(2, ['A', 'B', 'C']))).toBe(2);
  });
});

describe('isNodeSatisfiable', () => {
  it('a device is free iff isFree says so', () => {
    expect(isNodeSatisfiable(dev('d', 'A'), 'X', freeOn(['A@X']))).toBe(true);
    expect(isNodeSatisfiable(dev('d', 'A'), 'X', freeOn([]))).toBe(false);
  });
  it('a group needs at least `need` free children', () => {
    const g = mkGrp(2, ['A', 'B', 'C']);
    expect(isNodeSatisfiable(g, 'X', freeOn(['A@X', 'B@X']))).toBe(true); // 2 of 3 free
    expect(isNodeSatisfiable(g, 'Y', freeOn(['A@Y']))).toBe(false); // only 1 free
  });
});

describe('isTreeSatisfiableOnDay', () => {
  it('is the AND over the root children', () => {
    const root: AssistContainer = { children: [dev('a', 'A'), dev('b', 'B')] };
    expect(isTreeSatisfiableOnDay(root, 'X', freeOn(['A@X', 'B@X']))).toBe(true);
    expect(isTreeSatisfiableOnDay(root, 'X', freeOn(['A@X']))).toBe(false); // B not free
  });
});

describe('hasAnyRedundancy', () => {
  it('detects a group with more children than it needs', () => {
    expect(hasAnyRedundancy({ children: [mkGrp(1, ['A', 'B', 'C'])] })).toBe(true);
    expect(hasAnyRedundancy({ children: [mkGrp(3, ['A', 'B', 'C'])] })).toBe(false);
    expect(hasAnyRedundancy({ children: [dev('a', 'A')] })).toBe(false); // no groups
  });
  it('detects redundancy nested inside a non-redundant group', () => {
    const inner = mkGrp(1, ['B', 'C']); // 2 > need 1 → redundant
    const outer: AssistGrp = { uid: 'o', type: 'grp', need: 2, children: [dev('a', 'A'), inner] };
    expect(hasAnyRedundancy({ children: [outer] })).toBe(true); // outer not redundant, inner is
  });
});

describe('freeDays / groupRuns', () => {
  it('freeDays keeps only satisfiable days', () => {
    const root: AssistContainer = { children: [dev('a', 'A')] };
    const days = ['2021-01-11', '2021-01-12', '2021-01-13'];
    expect(freeDays(root, days, freeOn(['A@2021-01-11', 'A@2021-01-13']))).toEqual([
      '2021-01-11',
      '2021-01-13',
    ]);
  });
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
  it('extends a run that reaches the window end while still free', () => {
    const runs = [['2021-01-11', '2021-01-12']];
    const open = extendOpenRuns(root, runs, '2021-01-12', freeOn(['A@2021-01-13', 'A@2021-01-14']));
    expect(runs[0]).toEqual(['2021-01-11', '2021-01-12', '2021-01-13', '2021-01-14']);
    expect(open.has(runs[0]!)).toBe(true);
  });
  it('leaves a run untouched when it does not reach the window end', () => {
    const runs = [['2021-01-11', '2021-01-12']];
    const open = extendOpenRuns(root, runs, '2021-01-20', freeOn([]));
    expect(runs[0]).toEqual(['2021-01-11', '2021-01-12']);
    expect(open.size).toBe(0);
  });
  it('honors the extension cap', () => {
    const runs = [['2021-01-12']];
    extendOpenRuns(root, runs, '2021-01-12', freeOn(['A@2021-01-13', 'A@2021-01-14']), 1);
    expect(runs[0]!.length).toBe(2); // +1 only
  });
});

describe('isSatisfiableAcrossWindow / chooseDevicesForNode / chooseDevicesForTree', () => {
  const sel = ['2021-01-11', '2021-01-12'];
  it('isSatisfiableAcrossWindow requires the node free on every window day', () => {
    const g = mkGrp(2, ['A', 'B', 'C']);
    const allFree = freeOn(['A@2021-01-11', 'B@2021-01-11', 'A@2021-01-12', 'B@2021-01-12']);
    expect(isSatisfiableAcrossWindow(g, sel, allFree)).toBe(true);
    expect(isSatisfiableAcrossWindow(g, sel, freeOn(['A@2021-01-11']))).toBe(false);
  });
  it('chooseDevicesForNode returns a device id directly', () => {
    expect(chooseDevicesForNode(dev('a', 'A'), sel, freeOn(['A@2021-01-11']))).toEqual(['A']);
  });
  it('chooseDevicesForTree prefers devices free across the whole window', () => {
    const root: AssistContainer = { children: [mkGrp(1, ['A', 'B'])] };
    // B free both days, A only the first → B is chosen for a need-1 group
    const isFree = freeOn(['B@2021-01-11', 'B@2021-01-12', 'A@2021-01-11']);
    expect(chooseDevicesForTree(root, sel, isFree)).toEqual(['B']);
  });
  it('ranks the continuously-free device first in a larger group', () => {
    const root: AssistContainer = { children: [mkGrp(1, ['A', 'B', 'C'])] };
    // only B is free across BOTH days; A and C each free on just one → B wins
    const isFree = freeOn(['B@2021-01-11', 'B@2021-01-12', 'A@2021-01-11', 'C@2021-01-12']);
    expect(chooseDevicesForTree(root, sel, isFree)).toEqual(['B']);
  });
});

describe('groupNodeOnto', () => {
  const newUid = () => 'new';
  const newColor = () => 999;

  it('wraps the drag node and target in a new need-1-of-2 group with the next color', () => {
    const tree = sample();
    groupNodeOnto(tree, 'n1', 'n3', newUid, newColor); // n1 (root) onto n3 (inside n2)
    const n2 = treeFind(tree, 'n2') as AssistGrp;
    const newGroup = n2.children[0] as AssistGrp;
    expect(newGroup).toMatchObject({ uid: 'new', type: 'grp', need: 1, color: 999 });
    expect(newGroup.children).toEqual([dev('n3', 'B'), dev('n1', 'A')]);
    expect(treeFind(tree, 'n1')).not.toBeNull(); // n1 now lives inside the new group
    expect(tree.children.map((c) => c.uid)).toEqual(['n2']); // gone from root
  });

  it('is a no-op when dragging a node onto itself', () => {
    const tree = sample();
    groupNodeOnto(tree, 'n1', 'n1', newUid, newColor);
    expect(tree).toEqual(sample());
  });

  it('is a no-op when dragging a group onto its own descendant', () => {
    const tree = sample();
    groupNodeOnto(tree, 'n2', 'n3', newUid, newColor);
    expect(tree).toEqual(sample());
  });

  it('falls back to pushing the drag node to root when the target has no parent (not found)', () => {
    const tree = sample();
    groupNodeOnto(tree, 'n1', 'missing', newUid, newColor);
    expect(tree.children.some((c) => c.uid === 'n1')).toBe(true);
  });

  it('no-ops when the drag node does not exist', () => {
    const tree = sample();
    groupNodeOnto(tree, 'missing', 'n3', newUid, newColor);
    expect(tree).toEqual(sample());
  });
});

describe('joinNode', () => {
  it('moves the dragged node into the target group', () => {
    const tree = sample();
    joinNode(tree, 'n1', 'n2');
    const n2 = treeFind(tree, 'n2') as AssistGrp;
    expect(n2.children.map((c) => c.uid)).toEqual(['n3', 'n4', 'n1']);
    expect(tree.children.map((c) => c.uid)).toEqual(['n2']);
  });

  it('is a no-op when the target is an ancestor of the drag node (or is itself)', () => {
    const tree = sample();
    joinNode(tree, 'n2', 'n2');
    expect(tree).toEqual(sample());
  });

  it('is a no-op when the target does not exist or is not a group', () => {
    const tree = sample();
    joinNode(tree, 'n1', 'missing');
    expect(tree).toEqual(sample());
    joinNode(tree, 'n3', 'n1'); // n1 is a dev, not a group
    expect(tree).toEqual(sample());
  });

  it('is a no-op when the drag node does not exist', () => {
    const tree = sample();
    joinNode(tree, 'missing', 'n2');
    expect(tree).toEqual(sample());
  });
});

describe('moveNodeToRoot', () => {
  it('detaches the node and appends it to the root, cleaning up an emptied group', () => {
    const tree = sample();
    moveNodeToRoot(tree, 'n3'); // n2 drops to 1 child (n4) → dissolved by cleanup
    expect(tree.children.map((c) => c.uid)).toEqual(['n1', 'n4', 'n3']);
  });

  it('is a no-op when the node does not exist', () => {
    const tree = sample();
    moveNodeToRoot(tree, 'missing');
    expect(tree).toEqual(sample());
  });
});

describe('dissolveGroup', () => {
  it("promotes the group's children to its own position", () => {
    const tree = sample();
    dissolveGroup(tree, 'n2');
    expect(tree.children.map((c) => c.uid)).toEqual(['n1', 'n3', 'n4']);
  });

  it('is a no-op for a dev uid, a missing uid, or a node with no parent', () => {
    const tree = sample();
    dissolveGroup(tree, 'n1'); // a dev, not a group
    dissolveGroup(tree, 'missing');
    expect(tree).toEqual(sample());
  });
});

describe('changeGroupNeed', () => {
  it('increments and clamps to the child count', () => {
    const tree = sample();
    changeGroupNeed(tree, 'n2', 1);
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(2);
    changeGroupNeed(tree, 'n2', 1); // already at the 2-child max
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(2);
  });

  it('decrements and clamps to 1', () => {
    const tree = sample();
    changeGroupNeed(tree, 'n2', -1); // already at 1
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(1);
  });

  it('is a no-op for a missing uid or a dev uid', () => {
    const tree = sample();
    changeGroupNeed(tree, 'missing', 1);
    changeGroupNeed(tree, 'n1', 1);
    expect(tree).toEqual(sample());
  });
});

describe('setGroupNeed', () => {
  it('sets an absolute value, clamped to 1..childCount', () => {
    const tree = sample();
    setGroupNeed(tree, 'n2', 2);
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(2);
    setGroupNeed(tree, 'n2', 99);
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(2); // clamped to childCount
    setGroupNeed(tree, 'n2', 0);
    expect((treeFind(tree, 'n2') as AssistGrp).need).toBe(1); // clamped to 1
  });

  it('is a no-op for a missing uid or a dev uid', () => {
    const tree = sample();
    setGroupNeed(tree, 'missing', 2);
    setGroupNeed(tree, 'n1', 2);
    expect(tree).toEqual(sample());
  });
});

describe('removeNode', () => {
  it('removes a device, cleaning up an emptied group', () => {
    const tree = sample();
    removeNode(tree, 'n3'); // n2 drops to 1 child (n4) → dissolved
    expect(tree.children.map((c) => c.uid)).toEqual(['n1', 'n4']);
  });

  it('is a no-op when the uid does not exist', () => {
    const tree = sample();
    removeNode(tree, 'missing');
    expect(tree).toEqual(sample());
  });
});

describe('addDeviceToTree', () => {
  it('adds a new device to the root and reports success', () => {
    const tree: AssistContainer = { children: [] };
    expect(addDeviceToTree(tree, 'X', () => 'uidX')).toBe(true);
    expect(tree.children).toEqual([{ uid: 'uidX', type: 'dev', id: 'X' }]);
  });

  it('refuses a device already present anywhere in the tree (including nested)', () => {
    const tree = sample(); // 'B' is nested inside grp n2
    expect(addDeviceToTree(tree, 'B', () => 'uidB')).toBe(false);
    expect(tree).toEqual(sample());
  });
});
