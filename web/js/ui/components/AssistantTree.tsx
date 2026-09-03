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
import type { DragEvent } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import type { AssistContainer, AssistDev, AssistGrp, AssistNode } from '../../core/assistant.ts';
import { effectiveNeed } from '../../core/assistant.ts';
import { hasAnyMaintenanceSlot } from '../../core/machines.ts';
import { maintenanceKind, statusRangeText } from '../machine-text.ts';
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

function DevNodeView({ node, handlers }: { node: AssistDev; handlers: NodeHandlers }) {
  const machine = handlers.machineById(node.id);
  if (!machine) return null;
  return (
    <div
      className="asnode asdev"
      draggable
      data-uid={node.uid}
      title={`${machine.name} (${machine.group})`}
    >
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

/** The "brauche N von M" stepper: -/+ buttons and the direct-entry number input. Split out of
 *  `GroupNodeView` purely to stay under the function-length budget. */
function GroupNeedStepper({ node, handlers }: { node: AssistGrp; handlers: NodeHandlers }) {
  const childCount = node.children.length;
  const need = effectiveNeed(node);
  return (
    <>
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
      </span>{' '}
      von {childCount}
      {childCount > need && (
        <span className="hint" style={{ margin: 0 }}>
          {' '}
          – alle gleichwertigen Geräte hier?
        </span>
      )}
    </>
  );
}

function GroupNodeView({ node, handlers }: { node: AssistGrp; handlers: NodeHandlers }) {
  return (
    <div
      className="asnode asgrp"
      draggable
      data-uid={node.uid}
      style={{
        borderColor: `hsl(${node.color} 60% 55%)`,
        background: `hsla(${node.color},60%,55%,.10)`,
      }}
    >
      <div className="asgrp-head" title="Gruppe ziehen zum Verschachteln">
        <b>Bedarf:</b> brauche
        <GroupNeedStepper node={node} handlers={handlers} />
        <span
          className="rm"
          title="Gruppe auflösen"
          style={{ marginLeft: 'auto' }}
          onClick={(event) => {
            event.stopPropagation();
            handlers.onDissolve(node.uid);
          }}
        >
          ✕ auflösen
        </span>
      </div>
      <div className="asgrp-kids" data-dropgrp={node.uid}>
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
    const target = event.target as HTMLElement;
    const dev = target.closest<HTMLElement>('.asdev');
    const kids = target.closest<HTMLElement>('.asgrp-kids');
    if (dev && dev.dataset.uid !== drag) onGroupOnto(drag, dev.dataset.uid!);
    else if (kids) onJoin(drag, kids.dataset.dropgrp!);
    else onToRoot(drag);
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

  if (!tree.children.length) {
    return (
      <span className="hint" style={{ margin: 0 }}>
        Oben Geräte anhaken – sie erscheinen hier. Gleichwertige per Drag &amp; Drop aufeinander
        ziehen = Bedarfsgruppe (dann genügt „N von … frei").
      </span>
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
