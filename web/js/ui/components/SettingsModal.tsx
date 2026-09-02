// The settings modal (Phase 7 slice B9). Faithful port of legacy `openSettings()`. Every
// control still reads/writes its exact original localStorage key and calls the same
// still-legacy globals (applyTheme, connectSSE, refreshNow, applyDebug, dbgOn, centerToday)
// for the side effects that aren't modal-related — those stay in legacy.js for now.

import { Icon } from './Icon.tsx';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { askUserName } from './AskUserNameModal.tsx';
import { store } from '../../store-instance.ts';

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
          window.connectSSE();
          window.refreshNow(false);
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
          window.applyTheme();
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
            window.presenceTick();
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
            window.centerToday();
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
          defaultChecked={window.dbgOn()}
          onChange={(event) => {
            localStorage.setItem('mb_debug', event.target.checked ? 'on' : 'off');
            window.applyDebug();
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

/** Open the settings modal. Faithful port of legacy `openSettings()`. */
export function openSettings(): void {
  openReactModal(<SettingsModal />);
}
