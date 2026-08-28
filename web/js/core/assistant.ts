// Pure tree operations for the booking Assistant's device/group tree, extracted from the
// monolith (legacy.js). No DOM, no globals — they take the tree explicitly and either read it
// or mutate the passed-in nodes, exactly as the originals did.
//
// The Assistant lets the user pick devices and drag equivalents onto each other to form
// "need N of M" groups. The tree is: a root/group container holds children, each child is a
// device leaf or a nested group (with a `need` count). The DOM rendering, drag-and-drop, and
// the scheduling solver stay in legacy.js for now; this is just the pure tree kernel.

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
