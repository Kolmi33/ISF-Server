// =======================================================================================
// ASSISTANT HELP TOOLTIP (web/js/ui/components/AssistantHelpTooltip.tsx)
// =======================================================================================
//
// The small help affordance beside the "Bedarfsgruppen" heading explaining how to form a
// group (drag one device onto another) — replacing the old permanently-visible hint
// paragraph, which stayed in the reader's way even once its job was done.
//
// Key Principles:
// - TOOLTIP FOR HOVER/FOCUS, POPOVER FOR TOUCH: Base UI's Tooltip opens on hover and
//   keyboard focus, but hover-based tooltips aren't reliably reachable on touch devices (no
//   hover event to trigger them) — `useMediaQuery` picks whichever primitive fits the
//   viewer's actual input capability, never both on the same trigger at once.
//
// =======================================================================================

import { useRef } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import { Popover } from '@base-ui/react/popover';
import { useMediaQuery } from '@base-ui/react/unstable-use-media-query';
import { Button } from '../../components/ui/button.tsx';
import { Icon } from './Icon.tsx';

const HELP_TEXT =
  'Ähnliche Geräte aufeinander ziehen, um eine Bedarfsgruppe mit Alternativen zu bilden';

// The trigger is built inline (not as its own wrapper component) at each `render={...}` call
// site below — Base UI's `render` prop forwards a ref into the given element, which a plain
// function component can't accept without its own `forwardRef` (`Button` already has one).
const TRIGGER_PROPS = {
  type: 'button' as const,
  variant: 'ghost' as const,
  size: 'icon-xs' as const,
  'aria-label': 'Hilfe zu Bedarfsgruppen',
  className: 'assist-help-trigger',
};

/** Hover/keyboard-focus variant, for pointer devices that support hover. Portaled into a local
 *  ref (matching `DateRangePicker`'s own convention) rather than the default `document.body` —
 *  a body-level portal outlives this component's own React root across a fast modal
 *  close/reopen cycle (each open creates a fresh root over the shared `#modal` node), which
 *  can leave a detached popup node behind for the next root's unmount to trip over. */
function HoverHelp() {
  const containerRef = useRef<HTMLSpanElement>(null);
  return (
    <span ref={containerRef}>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button {...TRIGGER_PROPS}>
              <Icon name="help" />
            </Button>
          }
        />
        <Tooltip.Portal container={containerRef}>
          <Tooltip.Positioner sideOffset={6} className="assist-help-positioner">
            <Tooltip.Popup className="assist-help-popup">{HELP_TEXT}</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </span>
  );
}

/** Tap-to-open variant for touch devices, where a hover tooltip would never reliably open. */
function TapHelp() {
  const containerRef = useRef<HTMLSpanElement>(null);
  return (
    <span ref={containerRef}>
      <Popover.Root>
        <Popover.Trigger
          render={
            <Button {...TRIGGER_PROPS}>
              <Icon name="help" />
            </Button>
          }
        />
        <Popover.Portal container={containerRef}>
          <Popover.Positioner sideOffset={6} className="assist-help-positioner">
            <Popover.Popup className="assist-help-popup">{HELP_TEXT}</Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}

/** Beside the "Bedarfsgruppen" heading, visible even before any group exists — so the
 *  grouping feature is discoverable up front, not only once a group has already been formed. */
export function AssistantHelpTooltip() {
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)', { defaultMatches: true });
  return canHover ? <HoverHelp /> : <TapHelp />;
}
