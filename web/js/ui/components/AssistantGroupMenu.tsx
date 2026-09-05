// =======================================================================================
// ASSISTANT GROUP MENU (web/js/ui/components/AssistantGroupMenu.tsx)
// =======================================================================================
//
// "In Gruppe verschieben": a keyboard-accessible alternative to dragging a loose device onto
// another device/group to form or grow a Bedarfsgruppe. Every option here maps onto the exact
// same tree edits the drag-and-drop canvas already offers (`onGroupOnto`/`onJoin`,
// `core/assistant.ts`) — this is a second way to trigger them, not a new mutation.
//
// =======================================================================================

import { Menu } from '@base-ui/react/menu';
import { useRef } from 'react';
import type { MouseEvent } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import type { AssistDev, AssistGrp } from '../../core/assistant.ts';
import { treeDevs } from '../../core/assistant.ts';
import { Button } from '../../components/ui/button.tsx';
import { Icon } from './Icon.tsx';

/** Names a group by up to its first two members' names, e.g. "Fräse, Presse" or "Fräse, Presse, …". */
function groupPreviewLabel(
  group: AssistGrp,
  machineById: (id: string) => Machine | undefined,
): string {
  const names = treeDevs(group)
    .map((id) => machineById(id)?.name)
    .filter((name): name is string => !!name);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')}, …` : names.join(', ');
}

export interface AssistantGroupMenuProps {
  /** The loose device this menu moves — excluded from its own list of possible targets. */
  device: AssistDev;
  /** Every OTHER loose (top-level, ungrouped) device — each is a candidate to group with. */
  otherLooseDevices: readonly AssistDev[];
  /** Every existing top-level group — each is a candidate to join. */
  groups: readonly AssistGrp[];
  machineById: (id: string) => Machine | undefined;
  onGroupOnto: (dragUid: string, targetUid: string) => void;
  onJoin: (dragUid: string, groupUid: string) => void;
}

/** A small "..." menu beside a loose device, offering every group-forming move the drag
 *  canvas supports without requiring drag-and-drop. Renders nothing (no menu, no empty
 *  trigger) when there's genuinely no other device or group to move into. */
export function AssistantGroupMenu({
  device,
  otherLooseDevices,
  groups,
  machineById,
  onGroupOnto,
  onJoin,
}: AssistantGroupMenuProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  if (!otherLooseDevices.length && !groups.length) return null;
  return (
    // Portaled into this local ref (matching DateRangePicker's own convention), not the
    // default document.body — see AssistantHelpTooltip.tsx's HoverHelp doc note for why.
    <span ref={containerRef}>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`${machineById(device.id)?.name ?? device.id} in Gruppe verschieben`}
              className="assist-group-menu-trigger"
              onClick={(event: MouseEvent) => event.stopPropagation()}
            />
          }
        >
          <Icon name="dots" />
        </Menu.Trigger>
        <Menu.Portal container={containerRef}>
          <Menu.Positioner sideOffset={4} align="end">
            <Menu.Popup className="assist-group-menu-popup">
              {groups.map((group) => (
                <Menu.Item
                  key={group.uid}
                  className="assist-group-menu-item"
                  onClick={() => onJoin(device.uid, group.uid)}
                >
                  Zu Gruppe „{groupPreviewLabel(group, machineById)}" hinzufügen
                </Menu.Item>
              ))}
              {otherLooseDevices.map((other) => (
                <Menu.Item
                  key={other.uid}
                  className="assist-group-menu-item"
                  onClick={() => onGroupOnto(device.uid, other.uid)}
                >
                  Mit {machineById(other.id)?.name ?? other.id} gruppieren
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </span>
  );
}
