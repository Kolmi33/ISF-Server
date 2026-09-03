// =======================================================================================
// SETTINGS MODAL COMPONENT (web/js/ui/components/SettingsModal.tsx)
// =======================================================================================
//
// The settings modal: theme, presence sharing, compact rows, a grid-line thickness slider,
// weekend display, name, and the debug panel toggle. Each control reads/writes its own
// `localStorage` key directly and calls straight into the module that actually owns that
// behavior (`applyTheme`/`connectSSE`/`refreshNow`/`applyDebug`/`dbgOn`/`centerToday`).
//
// =======================================================================================

import { useState } from 'react';
import { Icon } from './Icon.tsx';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { askUserName } from './AskUserNameModal.tsx';
import { store } from '../../store-instance.ts';
import { connectSSE, presenceTick } from '../live-connection.ts';
import { refreshNow } from '../mutate.ts';
import { applyTheme } from '../theme.ts';
import { centerToday } from '../grid-scroll.ts';
import { applyDebug, dbgOn } from '../debug-panel.ts';

function DataSourceRow() {
  return (
    <div className="formrow">
      <label>Datenquelle</label>
      <div style={{ flex: 1 }}>
        <b>Server</b>{' '}
        <span className="hint" style={{ margin: 0 }}>
          (zentrale Datenbank · Live-Updates)
        </span>
      </div>
      <button
        className="btn"
        onClick={() => {
          connectSSE();
          void refreshNow(false);
        }}
      >
        <Icon name="refresh" /> Neu verbinden
      </button>
    </div>
  );
}

function ThemeRow() {
  const theme = localStorage.getItem('mb_theme') || 'auto';
  return (
    <div className="formrow">
      <label>Design</label>
      <select
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
      </select>
    </div>
  );
}

function PresenceRow() {
  const presence = localStorage.getItem('mb_presence') !== 'off';
  return (
    <div className="formrow">
      <label>Anwesenheit</label>
      <label style={{ minWidth: 'auto' }}>
        <input
          type="checkbox"
          defaultChecked={presence}
          onChange={(event) => {
            localStorage.setItem('mb_presence', event.target.checked ? 'on' : 'off');
            void presenceTick();
          }}
        />{' '}
        meinen Namen als „aktiv" teilen
      </label>
    </div>
  );
}

function CompactRow() {
  const compact = localStorage.getItem('mb_compact') === 'on';
  return (
    <div className="formrow">
      <label>Ansicht</label>
      <label style={{ minWidth: 'auto' }}>
        <input
          type="checkbox"
          defaultChecked={compact}
          onChange={(event) => {
            localStorage.setItem('mb_compact', event.target.checked ? 'on' : 'off');
            document.body.classList.toggle('compact', event.target.checked);
          }}
        />{' '}
        kompakte Zeilen (mehr Maschinen sichtbar)
      </label>
    </div>
  );
}

/** The grid's cell/header border widths in pixels, 0 (invisible) to `GRIDLINE_WIDTH_MAX` (bold),
 *  in `GRIDLINE_WIDTH_STEP`-sized increments (sub-pixel — CSS border widths accept fractional
 *  px just fine) — two independent sliders, not one, since the data grid (td) and the header
 *  (th: the "KW X" row + the weekday/date row) are visually distinct regions a user may want
 *  thick/thin differently. Each is a slider, not a threshold: {@link applyGridlineWidth}/
 *  {@link applyGridlineWidthHeader} write straight to their own `--gridline-width`/
 *  `--gridline-width-header` CSS custom property (`app.css`), which `td`'s/`th`'s own
 *  border-width already reads from, so no class toggling or extra CSS state is needed the way
 *  `body.compact` needs a class. Every cell stays exactly where and what it was; only the line
 *  between cells changes. */
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
export function applyGridlineWidth(px: number): void {
  document.documentElement.style.setProperty('--gridline-width', `${px}px`);
}

/** Same as {@link applyGridlineWidth}, for the header (th) rows' own independent width. */
export function applyGridlineWidthHeader(px: number): void {
  document.documentElement.style.setProperty('--gridline-width-header', `${px}px`);
}

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
    <div className="formrow">
      <label>{label}</label>
      <input
        type="range"
        min={0}
        max={GRIDLINE_WIDTH_MAX}
        step={GRIDLINE_WIDTH_STEP}
        value={width}
        aria-label={ariaLabel}
        onChange={(event) => {
          const px = clampGridlineWidth(parseFloat(event.target.value));
          setWidth(px);
          localStorage.setItem(storageKey, String(px));
          apply(px);
        }}
      />
      <span className="hint" style={{ margin: 0, minWidth: '3.5em' }}>
        {width === 0 ? 'aus' : `${width}px`}
      </span>
    </div>
  );
}

function GridLinesRow() {
  return (
    <>
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
    </>
  );
}

function WeekendsRow() {
  const weekends = localStorage.getItem('mb_weekends') === 'on';
  return (
    <div className="formrow">
      <label>Wochenenden</label>
      <label style={{ minWidth: 'auto' }}>
        <input
          type="checkbox"
          defaultChecked={weekends}
          onChange={(event) => {
            localStorage.setItem('mb_weekends', event.target.checked ? 'on' : 'off');
            store.set({ extraWeeks: 0 });
            centerToday();
          }}
        />{' '}
        Samstag &amp; Sonntag anzeigen (grau markiert)
      </label>
    </div>
  );
}

function NameRow() {
  return (
    <div className="formrow">
      <label>Name</label>
      <div style={{ flex: 1 }}>
        <b>{store.get('user') || '–'}</b>
      </div>
      <button className="btn" onClick={() => askUserName(false)}>
        <Icon name="user" /> Ändern…
      </button>
    </div>
  );
}

function DebugRow() {
  return (
    <div className="formrow">
      <label>Debug</label>
      <label style={{ minWidth: 'auto' }}>
        <input
          type="checkbox"
          defaultChecked={dbgOn()}
          onChange={(event) => {
            localStorage.setItem('mb_debug', event.target.checked ? 'on' : 'off');
            applyDebug();
          }}
        />{' '}
        Debug-Panel anzeigen (protokolliert Schreiben, Updates, Nutzer, Fehler)
      </label>
    </div>
  );
}

export function SettingsModal() {
  return (
    <>
      <h2>
        <Icon name="gear" /> Einstellungen
      </h2>
      <DataSourceRow />
      <ThemeRow />
      <PresenceRow />
      <CompactRow />
      <GridLinesRow />
      <WeekendsRow />
      <NameRow />
      <DebugRow />
      <div className="modal-actions">
        <button className="btn primary" onClick={closeReactModal}>
          Fertig
        </button>
      </div>
    </>
  );
}

/** Opens the settings modal. */
export function openSettings(): void {
  openReactModal(<SettingsModal />);
}
