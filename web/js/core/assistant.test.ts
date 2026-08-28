import { describe, it, expect } from 'vitest';
import type { AssistContainer, AssistNode } from './assistant.ts';
import {
  treeFind,
  treeFindParent,
  treeIsAncestor,
  treeDetach,
  treeDevs,
  treeDevUid,
  treeCleanup,
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
