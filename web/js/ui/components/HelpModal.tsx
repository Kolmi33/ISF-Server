// =======================================================================================
// HELP MODAL COMPONENT (web/js/ui/components/HelpModal.tsx)
// =======================================================================================
//
// The legend/help modal: static German reference copy explaining the grid's colors,
// mouse/keyboard shortcuts, booking rules, the Assistant, and the admin/data model — split
// into one small component per section to stay under the function-length budget.
//
// Key Principles:
// - THE LEGEND MUST MATCH THE GRID, NOT THIS DIALOG: the coloured dots below are the only
//   place inside `ui-scope` that reaches for `--dot-free`/`--dot-busy`/`--warn`. They are
//   quoting the grid's own palette (app.css/theme.css), so they must not be restated in this
//   dialog's semantic tokens — a green dot here has to be the same green the grid paints.
//
// =======================================================================================

import { useId, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Factory,
  HelpCircle,
  Table2,
  UserRound,
  Wrench,
  Zap,
} from 'lucide-react';
import { cn } from 'cn';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { Button } from '../../components/ui/app-button.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { SectionHeading } from './app/SectionHeading.tsx';

/** Opens the legend/help modal. */
export function openHelp(): void {
  openReactModal(<HelpModal />);
}

/** An icon sitting inside a sentence: the scope resets `svg` to `display:block`, so a
 *  mid-prose icon has to opt back into the text baseline. */
function Inline({ children }: { children: ReactNode }) {
  return <span className="inline-flex align-[-3px] [&_svg]:size-4">{children}</span>;
}

/** One grid-status dot, quoting the grid's own colour (see this file's header note). */
function Dot({ variant }: { variant: 'free' | 'busy' | 'unavail' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mr-1 inline-block size-2 rounded-full align-middle',
        variant === 'free' && 'bg-[var(--dot-free)]',
        variant === 'busy' && 'bg-[var(--dot-busy)]',
        variant === 'unavail' && 'border-2 border-muted-foreground bg-transparent',
      )}
    />
  );
}

function Prose({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm leading-relaxed text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
      {children}
    </p>
  );
}

function LegendSection() {
  return (
    <>
      <SectionHeading label="Farben &amp; Markierungen im Raster" />
      <Prose>
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
        <Dot variant="free" /> heute frei · <Dot variant="busy" /> heute belegt ·{' '}
        <Inline>
          <Zap className="text-[var(--warn)]" />
        </Inline>{' '}
        Wartung /{' '}
        <Inline>
          <Zap className="text-[var(--dot-busy)]" />
        </Inline>{' '}
        defekt · <Dot variant="unavail" /> heute nicht verfügbar (vor dem Maschinennamen).
        <br />
        <b className="text-[var(--star)]">★</b> = Favorit (erscheint oben in „★ Favoriten"), ☆ zum
        Anheften.
        <br />
        <Inline>
          <ChevronRight />
        </Inline>{' '}
        springt zum nächsten freien Termin der Maschine (mehrfach drückbar),{' '}
        <Inline>
          <ChevronLeft />
        </Inline>{' '}
        wieder zurück bis heute.
      </Prose>
    </>
  );
}

function MouseAndKeyboardSection() {
  return (
    <>
      <SectionHeading label="Maus" />
      <Prose>
        <b>Klick</b> = Zelle auswählen · <b>Doppelklick</b> = Buchen bzw. Buchung öffnen ·{' '}
        <b>Ziehen</b> = Bereich markieren (am Rand scrollt es automatisch weiter) ·{' '}
        <b>Shift+Klick</b> = Auswahl bis zur Zelle aufspannen · Loslassen öffnet das
        Buchen/Löschen-Menü.
      </Prose>
      <SectionHeading label="Tastatur" />
      <Prose>
        <b>Pfeiltasten</b> = Zelle bewegen · <b>Shift+Pfeile</b> = Auswahl erweitern · <b>Enter</b>{' '}
        = Buchen/Menü öffnen · <b>Esc</b> = Auswahl/Dialog schließen.
      </Prose>
    </>
  );
}

function BookingAndAssistantSection() {
  return (
    <>
      <SectionHeading label="Buchen" />
      <Prose>
        Beim Buchen wird der <b>gesamte Zeitraum inkl. Wochenenden</b> gebucht und als{' '}
        <b>Buchungsgruppe</b> zusammengefasst (gemeinsam löschbar über das Zellen-Detail). Das Feld{' '}
        <b>Notiz</b> dient zugleich als Gruppentitel. Gesperrte Tage (Wartung/defekt) und nicht
        verfügbare Wochentage werden übersprungen.
      </Prose>
      <SectionHeading
        label={
          <>
            <Inline>
              <Compass />
            </Inline>{' '}
            Buchungsassistent
          </>
        }
      />
      <Prose>
        Geräte in der Liste anhaken – sie erscheinen unter „Ausgewählte Geräte". Standard:{' '}
        <b>alle</b> müssen gleichzeitig frei sein. Gleichwertige Geräte per <b>Drag &amp; Drop</b>{' '}
        aufeinander ziehen bildet eine <b>Bedarfsgruppe</b>; über die Zahl legst du fest, wie viele
        davon frei sein müssen („N von …"). Gruppen lassen sich verschachteln. Ergebnisse springen
        ins Raster (Assistent klappt dabei nur ein – Tab links zum Wiederaufklappen); ist nach der
        letzten Buchung alles frei, sind die Tage offen wählbar.
      </Prose>
    </>
  );
}

function ListsAndStatsSection() {
  return (
    <>
      <SectionHeading
        label={
          <>
            <Inline>
              <Table2 />
            </Inline>{' '}
            Buchungslisten &amp; Statistik
          </>
        }
      />
      <Prose>
        <b>Alle Buchungen</b>: filtern nach Person/Maschine/Bereich/Zeitraum und sortieren (Termin,
        zuletzt gebucht, Bereich, Maschine, Person); je Eintrag steht auch, wann gebucht wurde.{' '}
        <b>Statistik</b>: Zeitraum standardmäßig ab 1. Januar; drei Tabs{' '}
        <b>
          <Inline>
            <Factory />
          </Inline>{' '}
          Ressourcen
        </b>
        ,{' '}
        <b>
          <Inline>
            <UserRound />
          </Inline>{' '}
          Personen
        </b>{' '}
        und{' '}
        <b>
          <Inline>
            <Zap />
          </Inline>{' '}
          Wartung
        </b>{' '}
        (Anzahl der Wartungs-/Ausfall-Instanzen und gesperrte Tage je Maschine).
      </Prose>
    </>
  );
}

function AdminAndDataSection() {
  return (
    <>
      <SectionHeading
        label={
          <>
            <Inline>
              <Wrench />
            </Inline>{' '}
            Verwalten
          </>
        }
      />
      <Prose>
        Maschinen/Messtechnik anlegen &amp; bearbeiten (sortierbar: manuell, alphabetisch, nach
        Bereich). Pro Gerät: <b>verfügbare Wochentage</b> (nicht gewählte sind im Plan ausgegraut
        &amp; nicht buchbar) und beliebig viele <b>Wartungs-/Ausfall-Slots</b> („in
        Wartung"/„defekt" mit Zeitraum). Diese überlagern Buchungen (grau schraffiert), verhindern
        neue Buchungen und sind nur hier lösch-/änderbar.
      </Prose>
      <SectionHeading label="Daten" />
      <Prose>
        Der Plan aktualisiert sich automatisch. Jede Buchung/Löschung lässt sich 9 Sekunden lang
        rückgängig machen. Tägliche Backups liegen als buchungen_backup_JJJJ-MM-TT.json im
        Datenordner.
      </Prose>
    </>
  );
}

export function HelpModal() {
  const titleId = useId();
  return (
    <AppDialog size="lg" labelledBy={titleId}>
      <AppDialogHeader
        icon={<HelpCircle className="size-6" />}
        title="Legende & Bedienung"
        titleId={titleId}
        subtitle="Farben, Kürzel und Regeln des Buchungsplans"
      />
      <AppDialogBody className="max-h-[70vh]">
        <ScrollArea className="-mr-3 min-h-0 flex-1 pr-3">
          <div className="flex flex-col gap-2 [&>div:not(:first-child)]:mt-4">
            <LegendSection />
            <MouseAndKeyboardSection />
            <BookingAndAssistantSection />
            <ListsAndStatsSection />
            <AdminAndDataSection />
          </div>
        </ScrollArea>
      </AppDialogBody>
      <AppDialogFooter>
        <Button size="lg" className="ml-auto" onClick={closeReactModal}>
          Alles klar
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}
