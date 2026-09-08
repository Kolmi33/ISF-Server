// =======================================================================================
// SETTINGS MODAL COMPONENT (web/js/ui/components/SettingsModal.tsx)
// =======================================================================================
//
// The settings modal: theme, presence sharing, compact rows, a grid-line thickness slider,
// weekend display, name, and the debug panel toggle. Each control reads/writes its own
// `localStorage` key directly and calls straight into the module that actually owns that
// behavior (`applyTheme`/`connectSSE`/`refreshNow`/`applyDebug`/`dbgOn`/`centerToday`).
//
// Key Principles:
// - ONE ROW SHAPE: every setting is a `SettingRow` — name + explanation on the left, the
//   control on the right — so the list reads as one thing however different the controls
//   are (docs/UI_STYLE_GUIDE.md §12).
//
// =======================================================================================

import { useId, useState, type ReactNode } from 'react';
import { RefreshCw, Settings, UserRound } from 'lucide-react';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { askUserName } from './AskUserNameModal.tsx';
import { store } from '../../store-instance.ts';
import { connectSSE, presenceTick } from '../live-connection.ts';
import { refreshNow } from '../mutate.ts';
import { applyTheme } from '../theme.ts';
import { centerToday } from '../grid-scroll.ts';
import { applyDebug, dbgOn } from '../debug-panel.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { NativeSelect } from '../../components/ui/native-select.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { SectionHeading } from './app/SectionHeading.tsx';
import { applyGridlineWidth, applyGridlineWidthHeader } from '../grid-style-settings.ts';

/** Name + explanation on the left, the control on the right. `htmlFor` makes the whole text
 *  block the control's label, which is what keeps a checkbox row clickable across its width. */
function SettingRow({
  name,
  description,
  htmlFor,
  children,
}: {
  name: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  const Text = htmlFor ? 'label' : 'div';
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:bg-muted">
      <Text htmlFor={htmlFor} className={`min-w-0 flex-1 ${htmlFor ? 'cursor-pointer' : ''}`}>
        <span className="block text-sm font-medium text-foreground">{name}</span>
        {description && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        )}
      </Text>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** A checkbox setting: persists `on`/`off` under `storageKey`, then runs `onApply`. */
function ToggleRow({
  name,
  description,
  storageKey,
  defaultChecked,
  onApply,
}: {
  name: ReactNode;
  description: ReactNode;
  storageKey: string;
  defaultChecked: boolean;
  onApply: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <SettingRow name={name} description={description} htmlFor={id}>
      <Checkbox
        id={id}
        className="size-5 rounded-[6px]"
        defaultChecked={defaultChecked}
        onCheckedChange={(checked) => {
          localStorage.setItem(storageKey, checked ? 'on' : 'off');
          onApply(checked);
        }}
      />
    </SettingRow>
  );
}

function DataSourceRow() {
  return (
    <SettingRow name="Datenquelle" description="Server · zentrale Datenbank · Live-Updates">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          connectSSE();
          void refreshNow(false);
        }}
      >
        <RefreshCw className="size-4" /> Neu verbinden
      </Button>
    </SettingRow>
  );
}

function ThemeRow() {
  const theme = localStorage.getItem('mb_theme') || 'auto';
  return (
    <SettingRow name="Design" description="Hell, dunkel oder der Systemeinstellung folgen">
      <NativeSelect
        aria-label="Design"
        className="h-9 w-[10rem]"
        defaultValue={theme}
        onChange={(event) => {
          localStorage.setItem('mb_theme', event.target.value);
          applyTheme();
          store.notify();
        }}
      >
        <option value="auto">Wie System</option>
        <option value="light">Hell</option>
        <option value="dark">Dunkel</option>
      </NativeSelect>
    </SettingRow>
  );
}

/** The grid's cell/header line thickness in pixels, 0 (invisible) to `GRIDLINE_WIDTH_MAX`
 *  (bold), in `GRIDLINE_WIDTH_STEP`-sized sub-pixel increments — two independent sliders, not
 *  one, since the data grid (td) and the header (th: the "KW X" row + the weekday/date row)
 *  are visually distinct regions a user may want thick/thin differently. Each is a slider, not
 *  a threshold: {@link applyGridlineWidth}/{@link applyGridlineWidthHeader} write straight to
 *  their own `--gridline-width`/`--gridline-width-header` CSS custom property, so no class
 *  toggling or extra CSS state is needed the way `body.compact` needs a class. Every cell stays
 *  exactly where and what it was; only the line between cells changes.
 *  Sub-pixel note: the grid renders these lines as `box-shadow`, not `border-width` (see
 *  `app.css`'s `td.cell`/`th`) — a real fractional-`border-width` value commonly rounds to
 *  fully invisible on a standard-DPI display (a known CSS limitation), which is exactly why
 *  sub-1px steps didn't actually render anything before; `box-shadow` anti-aliases fractional
 *  thickness properly instead. */
const GRIDLINE_WIDTH_DEFAULT = 1;
const GRIDLINE_WIDTH_MAX = 4;
const GRIDLINE_WIDTH_STEP = 0.25;

function clampGridlineWidth(value: number): number {
  return Number.isFinite(value)
    ? Math.min(Math.max(value, 0), GRIDLINE_WIDTH_MAX)
    : GRIDLINE_WIDTH_DEFAULT;
}

function readGridlineWidth(storageKey: string): number {
  return clampGridlineWidth(parseFloat(localStorage.getItem(storageKey) || ''));
}

/** Applies the data-grid (td) gridline width both live (the CSS variable) and persisted
 *  (`localStorage`) — the one function both `GridLinesRow`'s live slider and `app.ts`'s
 *  boot-time restore call, so the two can never drift out of sync on what "applying" means. */
/** One gridline-thickness slider row, parameterized by which region it controls — used twice
 *  below (data grid vs. header) so the two stay in lockstep on every behavior except which
 *  storage key/CSS variable they touch. */
function GridlineSliderRow({
  label,
  ariaLabel,
  storageKey,
  apply,
}: {
  label: string;
  ariaLabel: string;
  storageKey: string;
  apply: (px: number) => void;
}) {
  const [width, setWidth] = useState(() => readGridlineWidth(storageKey));
  return (
    <SettingRow name={label} description="Stärke der Trennlinien im Buchungsraster">
      <input
        type="range"
        min={0}
        max={GRIDLINE_WIDTH_MAX}
        step={GRIDLINE_WIDTH_STEP}
        value={width}
        aria-label={ariaLabel}
        className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-border accent-primary"
        onChange={(event) => {
          const px = clampGridlineWidth(parseFloat(event.target.value));
          setWidth(px);
          localStorage.setItem(storageKey, String(px));
          apply(px);
        }}
      />
      <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
        {width === 0 ? 'aus' : `${width}px`}
      </span>
    </SettingRow>
  );
}

function NameRow() {
  return (
    <SettingRow name="Name" description="Unter diesem Namen erscheinen deine Buchungen">
      <span className="text-sm font-medium text-foreground">{store.get('user') || '–'}</span>
      <Button variant="outline" size="sm" onClick={() => askUserName(false)}>
        <UserRound className="size-4" /> Ändern…
      </Button>
    </SettingRow>
  );
}

/** Every setting, in one list — split out of `SettingsModal` purely to stay under the
 *  function-length budget. */
function SettingsList() {
  return (
    <div className="flex flex-col gap-1">
      <DataSourceRow />
      <ThemeRow />
      <ToggleRow
        name="Anwesenheit"
        description={`meinen Namen als „aktiv" teilen`}
        storageKey="mb_presence"
        defaultChecked={localStorage.getItem('mb_presence') !== 'off'}
        onApply={() => void presenceTick()}
      />
      <ToggleRow
        name="Ansicht"
        description="kompakte Zeilen (mehr Maschinen sichtbar)"
        storageKey="mb_compact"
        defaultChecked={localStorage.getItem('mb_compact') === 'on'}
        onApply={(checked) => document.body.classList.toggle('compact', checked)}
      />
      <GridlineSliderRow
        label="Raster (Tabelle)"
        ariaLabel="Rasterlinien-Stärke"
        storageKey="mb_gridline_width"
        apply={applyGridlineWidth}
      />
      <GridlineSliderRow
        label="Raster (Kopfzeile)"
        ariaLabel="Rasterlinien-Stärke (Kopfzeile)"
        storageKey="mb_gridline_width_header"
        apply={applyGridlineWidthHeader}
      />
      <ToggleRow
        name="Wochenenden"
        description="Samstag & Sonntag anzeigen (grau markiert)"
        storageKey="mb_weekends"
        defaultChecked={localStorage.getItem('mb_weekends') === 'on'}
        onApply={() => {
          store.set({ extraWeeks: 0 });
          centerToday();
        }}
      />
      <NameRow />
      <ToggleRow
        name="Debug"
        description="Debug-Panel anzeigen (protokolliert Schreiben, Updates, Nutzer, Fehler)"
        storageKey="mb_debug"
        defaultChecked={dbgOn()}
        onApply={applyDebug}
      />
    </div>
  );
}

export function SettingsModal() {
  const titleId = useId();
  return (
    <AppDialog size="md" labelledBy={titleId}>
      <AppDialogHeader
        icon={<Settings className="size-6" />}
        title="Einstellungen"
        titleId={titleId}
        subtitle="Gilt nur auf diesem Gerät"
      />
      <AppDialogBody className="max-h-[65vh]">
        <SectionHeading label="Allgemein" />
        <ScrollArea className="-mr-3 min-h-0 flex-1 pr-3">
          <SettingsList />
        </ScrollArea>
      </AppDialogBody>
      <AppDialogFooter>
        <Button size="lg" className="ml-auto" onClick={closeReactModal}>
          Fertig
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}

/** Opens the settings modal. */
export function openSettings(): void {
  openReactModal(<SettingsModal />);
}
