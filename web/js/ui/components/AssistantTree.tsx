// =======================================================================================
// ASSISTANT TREE COMPONENT (web/js/ui/components/AssistantTree.tsx)
// =======================================================================================
//
// The Assistant's "need" tree work area: the drag-and-drop canvas where checked devices
// land, equivalents get dragged onto each other to form "need N of M" groups, and groups nest.
//
// Key Principles:
// - DOM/DND WIRING ONLY: tree mutation itself is already pure and 100%-tested in
//   `core/assistant.ts` — this component is purely the drag-and-drop plumbing around it.
//   Native `dragstart`/`dragover`/`drop` map directly onto React's
//   `onDragStart`/`onDragOver`/`onDrop`, delegated on the work area as a whole.
// - HIGHLIGHT CLASSES ARE IMPERATIVE, NOT REACT STATE: `.dragover`/`.dragover-root`/
//   `.dragging` are toggled via direct DOM manipulation rather than component state —
//   re-rendering the whole tree on every `dragover` (which fires continuously while
//   dragging) would be wasteful for a purely transient visual cue.
//
// =======================================================================================

import { useRef } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import type { AssistContainer, AssistDev, AssistGrp, AssistNode } from '../../core/assistant.ts';
import { effectiveNeed } from '../../core/assistant.ts';
import { getMachineCategory, hasAnyMaintenanceSlot } from '../../core/machines.ts';
import { maintenanceKind, statusRangeText } from '../machine-text.ts';
import { categoryColor, nameColor } from '../grid.ts';
import { isDarkTheme } from '../theme.ts';
import { Icon } from './Icon.tsx';

/** The maintenance/defect status tag, when the machine has one. */
function MachineStatusTag({ machine }: { machine: Machine }) {
  if (!hasAnyMaintenanceSlot(machine)) return null;
  const kind = maintenanceKind(machine);
  return (
    <span className={`tag ${kind || 'wartung'}`} title={statusRangeText(machine)}>
      {kind === 'defekt' ? 'defekt' : 'Wartung'}
    </span>
  );
}

interface NodeHandlers {
  machineById: (id: string) => Machine | undefined;
  onDissolve: (uid: string) => void;
  onChangeNeed: (uid: string, delta: number) => void;
  onSetNeed: (uid: string, value: number) => void;
  onRemove: (uid: string) => void;
}

/** The drag handle (⋮⋮) that's now the sole visual cue a node is draggable — replacing the
 *  file header era's explanatory prose (removed per the redesign: drag-and-drop is
 *  communicated purely visually, via this handle and the dashed drop-zone highlight
 *  `useTreeDragAndDrop` paints below, not through instructional text). */
function DragHandle() {
  return (
    <span className="draghandle" aria-hidden="true">
      ⋮⋮
    </span>
  );
}

function DevNodeView({ node, handlers }: { node: AssistDev; handlers: NodeHandlers }) {
  const machine = handlers.machineById(node.id);
  if (!machine) return null;
  return (
    <div
      className="asnode asdev"
      draggable
      data-uid={node.uid}
      title={`${machine.name} (${machine.group})`}
      // Faint category background (blue Maschinen, green Messtechnik — user request) so
      // equipment reads as "which kind" at a glance, consistently with the result pills
      // (AssistantResults.tsx) using the same categoryColor. Set as a custom property, not a
      // plain inline `background` — an inline style would permanently win over the .asdev:hover
      // /.asdev.dragover CSS rules (app.css) that also need to override this same property.
      style={
        {
          '--devcolor': categoryColor(getMachineCategory(machine), isDarkTheme()),
        } as CSSProperties
      }
    >
      <DragHandle />
      {machine.name}
      {machine.info && (
        <span
          className="machinfo"
          title={machine.info}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="info" />
        </span>
      )}
      <MachineStatusTag machine={machine} />
      <span
        className="rm"
        title="Aus Auswahl entfernen"
        onClick={(event) => {
          event.stopPropagation();
          handlers.onRemove(node.uid);
        }}
      >
        ✕
      </span>
    </div>
  );
}

/** The "Benötigt: N von M" stepper: -/+ buttons and the direct-entry number input, rigorously
 *  shortened from the old "Bedarf: brauche N von M – alle gleichwertigen Geräte hier?" wording
 *  down to just the number itself (user request). Split out of `GroupNodeView` purely to stay
 *  under the function-length budget. */
function GroupNeedStepper({ node, handlers }: { node: AssistGrp; handlers: NodeHandlers }) {
  const childCount = node.children.length;
  const need = effectiveNeed(node);
  return (
    <>
      <b>Benötigt:</b>
      <span className="asgrp-need">
        <button
          className="asstep"
          tabIndex={-1}
          title="weniger"
          onClick={(event) => {
            event.stopPropagation();
            handlers.onChangeNeed(node.uid, -1);
          }}
        >
          –
        </button>
        <input
          type="number"
          className="asNeed"
          value={need}
          min={1}
          max={childCount}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => handlers.onSetNeed(node.uid, parseInt(event.target.value) || 1)}
        />
        <button
          className="asstep"
          tabIndex={-1}
          title="mehr"
          onClick={(event) => {
            event.stopPropagation();
            handlers.onChangeNeed(node.uid, 1);
          }}
        >
          +
        </button>
      </span>
      von {childCount}
    </>
  );
}

/** A demand group as a distinctly colored card — reinstated per a later user request ("I want
 *  the different 'Bedarfsgruppen' also to have coloured Card borders"), reversing an earlier
 *  redesign that had removed per-group hues (the old `AS_HUES`/`newColor` palette) because
 *  independently-hashed nested-group colors read as visual noise. `nameColor`, keyed by the
 *  group's own stable `uid`, gives each group a soft pastel tint (the same hash-based palette
 *  already used for booker names and My Bookings' group cards) — a darker shade of the same
 *  hue (`color-mix`, see app.css) replaces the previous plain grey border. */
function GroupNodeView({ node, handlers }: { node: AssistGrp; handlers: NodeHandlers }) {
  return (
    <div
      className="asnode asgrp"
      draggable
      data-uid={node.uid}
      style={{ '--groupcolor': nameColor(node.uid, isDarkTheme()) } as CSSProperties}
    >
      <div className="asgrp-head" title="Gruppe ziehen zum Verschachteln">
        <DragHandle />
        <GroupNeedStepper node={node} handlers={handlers} />
        <button
          type="button"
          className="rm"
          title="Gruppe auflösen"
          aria-label="Gruppe auflösen"
          style={{ marginLeft: 'auto' }}
          onClick={(event) => {
            event.stopPropagation();
            handlers.onDissolve(node.uid);
          }}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="asgrp-kids">
        {node.children.map((child) => (
          <AssistNodeView key={child.uid} node={child} handlers={handlers} />
        ))}
      </div>
    </div>
  );
}

function AssistNodeView({ node, handlers }: { node: AssistNode; handlers: NodeHandlers }) {
  return node.type === 'grp' ? (
    <GroupNodeView node={node} handlers={handlers} />
  ) : (
    <DevNodeView node={node} handlers={handlers} />
  );
}

/** Reorders loose (ungrouped) devices so devices sharing a machine group sit adjacently —
 *  no visible header for the grouping, it only affects display order, making it easier to
 *  spot equivalent devices worth dragging onto each other. */
function reorderLooseByMachineGroup(
  loose: readonly AssistDev[],
  machineById: (id: string) => Machine | undefined,
): AssistDev[] {
  const byGroup = new Map<string, AssistDev[]>();
  for (const node of loose) {
    const key = machineById(node.id)?.group ?? '—';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(node);
  }
  return [...byGroup.values()].flat();
}

function clearHighlights(container: HTMLElement): void {
  container.classList.remove('dragover-root');
  container.querySelectorAll('.dragover').forEach((n) => n.classList.remove('dragover'));
}

/** Resolves a drop event's target into the tree edit it should trigger.
 *
 * - Dropping onto a device that's ALREADY a member of a group joins that group flatly (same
 *   as dropping on the group's own background) rather than wrapping just that one device in a
 *   brand-new nested subgroup — with 2+ existing members, aiming for one of them (the
 *   easiest, biggest target to hit) used to bury it one level deeper each time instead of
 *   adding a flat 3rd/4th/... member, which looked broken/like the drag had silently failed
 *   ("snaps back") once a group had more than 2 members.
 * - Dropping ANYWHERE else on an existing group — its `.asgrp-kids` background, or its own
 *   `.asgrp-head` title bar (the drag handle/stepper/dissolve row) — joins that same group.
 *   The two used to be handled differently (only `.asgrp-kids` counted, via its own
 *   `data-dropgrp` attribute), so dropping a group you're trying to nest onto another group's
 *   HEAD — the single biggest, most obvious part of its card, and the one literally titled
 *   "Gruppe ziehen zum Verschachteln" (drag a group here to nest it) — silently fell through
 *   to moving it to the root instead, looking exactly like nesting one Bedarfsgruppe into
 *   another had stopped working. `closest('.asgrp')` covers the group's whole card (head and
 *   kids both) in one check, reading the group's own `data-uid` — `.asgrp-kids`'s separate
 *   `data-dropgrp` carried the exact same uid, so it's gone now too, not just unused.
 *
 * Split out of `handleDrop` purely to stay under the function-length budget.
 */
function resolveDrop(
  target: HTMLElement,
  drag: string,
  handlers: {
    onGroupOnto: (dragUid: string, targetUid: string) => void;
    onJoin: (dragUid: string, groupUid: string) => void;
    onToRoot: (dragUid: string) => void;
  },
): void {
  const dev = target.closest<HTMLElement>('.asdev');
  const grp = target.closest<HTMLElement>('.asgrp');
  const devsGroup = dev?.closest<HTMLElement>('.asgrp');
  if (dev && dev.dataset.uid !== drag) {
    if (devsGroup) handlers.onJoin(drag, devsGroup.dataset.uid!);
    else handlers.onGroupOnto(drag, dev.dataset.uid!);
  } else if (grp) {
    handlers.onJoin(drag, grp.dataset.uid!);
  } else {
    handlers.onToRoot(drag);
  }
}

/** The delegated drag-and-drop wiring for the work area: highlight classes are toggled
 *  imperatively via direct DOM manipulation (see the file header) rather than React state,
 *  so this hook returns plain event handlers plus the container ref, not any rendered state. */
function useTreeDragAndDrop(
  onGroupOnto: (dragUid: string, targetUid: string) => void,
  onJoin: (dragUid: string, groupUid: string) => void,
  onToRoot: (dragUid: string) => void,
) {
  const dragUidRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function handleDragStart(event: DragEvent<HTMLDivElement>): void {
    const node = (event.target as HTMLElement).closest<HTMLElement>('[data-uid]');
    if (!node) return;
    dragUidRef.current = node.dataset.uid!;
    node.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragUidRef.current);
    event.stopPropagation();
  }

  function handleDragEnd(): void {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
    clearHighlights(container);
    dragUidRef.current = null;
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    const container = containerRef.current;
    if (!dragUidRef.current || !container) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearHighlights(container);
    const target = event.target as HTMLElement;
    const kids = target.closest<HTMLElement>('.asgrp-kids');
    const dev = target.closest<HTMLElement>('.asdev');
    const grp = target.closest<HTMLElement>('.asgrp');
    if (dev && dev.dataset.uid !== dragUidRef.current) dev.classList.add('dragover');
    else if (kids) kids.classList.add('dragover');
    else if (grp) grp.classList.add('dragover');
    else container.classList.add('dragover-root');
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    const container = containerRef.current;
    if (!dragUidRef.current || !container) return;
    event.preventDefault();
    event.stopPropagation();
    const drag = dragUidRef.current;
    dragUidRef.current = null;
    clearHighlights(container);
    resolveDrop(event.target as HTMLElement, drag, { onGroupOnto, onJoin, onToRoot });
  }

  return { containerRef, handleDragStart, handleDragEnd, handleDragOver, handleDrop };
}

export interface AssistantTreeProps {
  tree: AssistContainer;
  machineById: (id: string) => Machine | undefined;
  onGroupOnto: (dragUid: string, targetUid: string) => void;
  onJoin: (dragUid: string, groupUid: string) => void;
  onToRoot: (dragUid: string) => void;
  onDissolve: (uid: string) => void;
  onChangeNeed: (uid: string, delta: number) => void;
  onSetNeed: (uid: string, value: number) => void;
  onRemove: (uid: string) => void;
}

export function AssistantTree({
  tree,
  machineById,
  onGroupOnto,
  onJoin,
  onToRoot,
  onDissolve,
  onChangeNeed,
  onSetNeed,
  onRemove,
}: AssistantTreeProps) {
  const { containerRef, handleDragStart, handleDragEnd, handleDragOver, handleDrop } =
    useTreeDragAndDrop(onGroupOnto, onJoin, onToRoot);

  // A bare status line, not instructional copy — how drag-and-drop actually works is
  // communicated visually now (each node's own drag handle, the dashed drop-zone highlight
  // below), not explained in prose here (user request). Centered with a faint icon rather than
  // left-aligned plain text, so the empty cart card reads as an intentional state rather than
  // an afterthought (user request).
  if (!tree.children.length) {
    return (
      <div className="aswork-empty">
        <Icon name="doc" />
        <span className="hint" style={{ margin: 0 }}>
          Keine Geräte ausgewählt.
        </span>
      </div>
    );
  }

  const groups = tree.children.filter((c): c is AssistGrp => c.type === 'grp');
  const loose = reorderLooseByMachineGroup(
    tree.children.filter((c): c is AssistDev => c.type === 'dev'),
    machineById,
  );
  const handlers: NodeHandlers = { machineById, onDissolve, onChangeNeed, onSetNeed, onRemove };

  return (
    <div
      ref={containerRef}
      id="asWork"
      className="aswork"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {groups.length > 0 && (
        <>
          <div className="catlbl">Bedarfsgruppen</div>
          {groups.map((g) => (
            <AssistNodeView key={g.uid} node={g} handlers={handlers} />
          ))}
        </>
      )}
      {loose.length > 0 && (
        <>
          <div className="catlbl">Einzelgeräte</div>
          {loose.map((d) => (
            <AssistNodeView key={d.uid} node={d} handlers={handlers} />
          ))}
        </>
      )}
    </div>
  );
}
