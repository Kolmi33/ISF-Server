// =======================================================================================
// ICON COMPONENT (web/js/ui/components/Icon.tsx)
// =======================================================================================
//
// A named icon, rendered from the Tabler icon set (Phase 14, revised direction — the shadcn
// preset `b6EWdD0CK8` adopted Tabler as its icon library). The `<Icon name="..."/>` API is
// byte-identical to the SVG-sprite version this replaces — every one of its 20 call sites
// across the app is untouched; only this one file's internals changed.
//
// Key Principles:
// - CSS STILL GOVERNS APPEARANCE, NOT PROPS: the app already has a `.ic` rule (app.css) that
//   sets size/stroke-width/fill/vertical-align, plus several context-scoped overrides
//   (`.aswork-empty .ic`, `#modalReopen .ic`, `.stat-kpi .ic`, …) that depend on the rendered
//   SVG still carrying the `.ic` class. CSS presentation properties (width/height/stroke/
//   stroke-width/fill) always win over an SVG's own attributes, so passing `className="ic"`
//   and nothing else lets every one of those existing rules keep working exactly as before —
//   no need to hand-replicate each context's size as a React prop.
// - EXPLICIT MAP, NOT DYNAMIC LOOKUP: `name` is a plain string (some call sites pass one
//   computed at runtime — see `core/machines.ts`'s category icons, `assistant-checklist.ts`'s
//   favorites star), so the map is keyed by the same strings the old sprite's `#i-<name>`
//   symbol ids used, enumerated from every real call site rather than guessed.
//
// =======================================================================================

import {
  IconBolt,
  IconBuildingFactory,
  IconChartBar,
  IconChevronLeft,
  IconChevronRight,
  IconClipboard,
  IconCompass,
  IconDotsVertical,
  IconFileText,
  IconFolder,
  IconGauge,
  IconHelp,
  IconInfoCircle,
  IconMapPin,
  IconRefresh,
  IconSettings,
  IconStar,
  IconTable,
  IconTool,
  IconTrash,
  IconUser,
  IconX,
  type Icon as TablerIcon,
} from '@tabler/icons-react';

/** Every icon name a real call site passes, mapped to its Tabler equivalent — enumerated from
 *  `web/index.html`'s former `<symbol id="i-*">` set (via `Icon` call sites; the few sprite
 *  ids some non-`Icon` call sites still use directly — search/bug/cal/eye — are untouched,
 *  out of scope for this component). */
const ICONS: Record<string, TablerIcon> = {
  bolt: IconBolt,
  chart: IconChartBar,
  clip: IconClipboard,
  close: IconX,
  compass: IconCompass,
  dots: IconDotsVertical,
  doc: IconFileText,
  factory: IconBuildingFactory,
  folder: IconFolder,
  gauge: IconGauge,
  gear: IconSettings,
  help: IconHelp,
  info: IconInfoCircle,
  next: IconChevronRight,
  pin: IconMapPin,
  prev: IconChevronLeft,
  refresh: IconRefresh,
  star: IconStar,
  table: IconTable,
  trash: IconTrash,
  user: IconUser,
  wrench: IconTool,
};

export interface IconProps {
  name: string;
}

export function Icon({ name }: IconProps) {
  const TablerComponent = ICONS[name];
  if (!TablerComponent) return null;
  return <TablerComponent className="ic" aria-hidden="true" />;
}
