// The legend/help modal (Phase 7 slice B9). Static content, no state — a faithful JSX port
// of legacy `openHelp()`'s template string (E1: exact German copy, unchanged), split into
// one small component per section to stay under the 60-line function budget. The only real
// behavior is the close button, which now calls the real React modal bridge instead of the
// inline `onclick="closeModal()"` attribute the original used.

import { Icon } from './Icon.tsx';
import { closeReactModal, openReactModal } from '../modal.tsx';

/** Open the legend/help modal. Faithful port of legacy `openHelp()`. */
export function openHelp(): void {
  openReactModal(<HelpModal />);
}

const HINT_STYLE = { fontSize: 13, lineHeight: 1.7 };

function LegendSection() {
  return (
    <>
      <div className="statgrp">Farben &amp; Markierungen im Raster</div>
      <div className="hint" style={HINT_STYLE}>
        <b>Farbige Zelle</b> = Buchung; die Farbe ergibt sich aus dem Namen der Person (immer
        gleich).
        <br />
        <b>Blauer Rahmen</b> = deine eigene Buchung.
        <br />
        <b>Oranger Rahmen</b> = Tastatur-Fokus.
        <br />
        <b>Blaue Tönung</b> = aktuelle Markierung (Ziehen/Shift).
        <br />
        <b>Schraffierte Zelle</b> = Maschine gesperrt (Wartung/defekt, ggf. zeitlich begrenzt).
        <br />
        <b>Ausgegraute Zelle</b> = an diesem Wochentag nicht verfügbar (nicht buchbar).
        <br />
        <span className="dot free"></span> heute frei · <span className="dot busy"></span> heute
        belegt ·{' '}
        <span className="statdot maint">
          <Icon name="bolt" />
        </span>{' '}
        Wartung /{' '}
        <span className="statdot broken">
          <Icon name="bolt" />
        </span>{' '}
        defekt · <span className="dot unavail"></span> heute nicht verfügbar (vor dem
        Maschinennamen).
        <br />
        <b style={{ color: 'var(--star)' }}>★</b> = Favorit (erscheint oben in „★ Favoriten"), ☆ zum
        Anheften.
        <br />
        <Icon name="next" /> springt zum nächsten freien Termin der Maschine (mehrfach drückbar),{' '}
        <Icon name="prev" /> wieder zurück bis heute.
      </div>
    </>
  );
}

function MouseAndKeyboardSection() {
  return (
    <>
      <div className="statgrp">Maus</div>
      <div className="hint" style={HINT_STYLE}>
        <b>Klick</b> = Zelle auswählen · <b>Doppelklick</b> = Buchen bzw. Buchung öffnen ·{' '}
        <b>Ziehen</b> = Bereich markieren (am Rand scrollt es automatisch weiter) ·{' '}
        <b>Shift+Klick</b> = Auswahl bis zur Zelle aufspannen · Loslassen öffnet das
        Buchen/Löschen-Menü.
      </div>
      <div className="statgrp">Tastatur</div>
      <div className="hint" style={HINT_STYLE}>
        <b>Pfeiltasten</b> = Zelle bewegen · <b>Shift+Pfeile</b> = Auswahl erweitern · <b>Enter</b>{' '}
        = Buchen/Menü öffnen · <b>Esc</b> = Auswahl/Dialog schließen.
      </div>
    </>
  );
}

function BookingAndAssistantSection() {
  return (
    <>
      <div className="statgrp">Buchen</div>
      <div className="hint" style={HINT_STYLE}>
        Beim Buchen wird der <b>gesamte Zeitraum inkl. Wochenenden</b> gebucht und als{' '}
        <b>Buchungsgruppe</b> zusammengefasst (gemeinsam löschbar über das Zellen-Detail). Das Feld{' '}
        <b>Notiz</b> dient zugleich als Gruppentitel. Gesperrte Tage (Wartung/defekt) und nicht
        verfügbare Wochentage werden übersprungen.
      </div>
      <div className="statgrp">
        <Icon name="compass" /> Buchungsassistent
      </div>
      <div className="hint" style={HINT_STYLE}>
        Geräte in der Liste anhaken – sie erscheinen unter „Ausgewählte Geräte". Standard:{' '}
        <b>alle</b> müssen gleichzeitig frei sein. Gleichwertige Geräte per <b>Drag &amp; Drop</b>{' '}
        aufeinander ziehen bildet eine <b>Bedarfsgruppe</b>; über die Zahl legst du fest, wie viele
        davon frei sein müssen („N von …"). Gruppen lassen sich verschachteln. Ergebnisse springen
        ins Raster (Assistent klappt dabei nur ein – Tab links zum Wiederaufklappen); ist nach der
        letzten Buchung alles frei, sind die Tage offen wählbar.
      </div>
    </>
  );
}

function ListsAndStatsSection() {
  return (
    <>
      <div className="statgrp">
        <Icon name="table" /> Buchungslisten &amp; Statistik
      </div>
      <div className="hint" style={HINT_STYLE}>
        <b>Alle Buchungen</b>: filtern nach Person/Maschine/Bereich/Zeitraum und sortieren (Termin,
        zuletzt gebucht, Bereich, Maschine, Person); je Eintrag steht auch, wann gebucht wurde.{' '}
        <b>Statistik</b>: Zeitraum standardmäßig ab 1. Januar; drei Tabs{' '}
        <b>
          <Icon name="factory" /> Ressourcen
        </b>
        ,{' '}
        <b>
          <Icon name="user" /> Personen
        </b>{' '}
        und{' '}
        <b>
          <Icon name="bolt" /> Wartung
        </b>{' '}
        (Anzahl der Wartungs-/Ausfall-Instanzen und gesperrte Tage je Maschine).
      </div>
    </>
  );
}

function AdminAndDataSection() {
  return (
    <>
      <div className="statgrp">
        <Icon name="wrench" /> Verwalten
      </div>
      <div className="hint" style={HINT_STYLE}>
        Maschinen/Messtechnik anlegen &amp; bearbeiten (sortierbar: manuell, alphabetisch, nach
        Bereich). Pro Gerät: <b>verfügbare Wochentage</b> (nicht gewählte sind im Plan ausgegraut
        &amp; nicht buchbar) und beliebig viele <b>Wartungs-/Ausfall-Slots</b> („in
        Wartung"/„defekt" mit Zeitraum). Diese überlagern Buchungen (grau schraffiert), verhindern
        neue Buchungen und sind nur hier lösch-/änderbar.
      </div>
      <div className="statgrp">Daten</div>
      <div className="hint" style={HINT_STYLE}>
        Der Plan aktualisiert sich automatisch. Jede Buchung/Löschung lässt sich 9 Sekunden lang
        rückgängig machen. Tägliche Backups liegen als buchungen_backup_JJJJ-MM-TT.json im
        Datenordner.
      </div>
    </>
  );
}

export function HelpModal() {
  return (
    <>
      <h2>
        <Icon name="help" /> Legende &amp; Bedienung
      </h2>
      <LegendSection />
      <MouseAndKeyboardSection />
      <BookingAndAssistantSection />
      <ListsAndStatsSection />
      <AdminAndDataSection />
      <div className="modal-actions">
        <button className="btn primary" onClick={closeReactModal}>
          Alles klar
        </button>
      </div>
    </>
  );
}
