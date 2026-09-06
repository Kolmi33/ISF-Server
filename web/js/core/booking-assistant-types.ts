export interface Device {
  id: string;
  /** Anzeigename, z. B. "BERGER 5070A" */
  name: string;
  /** Inventarkürzel, wird in Monospace gesetzt */
  code: string;
  /** Standort, z. B. "Labor 2" */
  lab: string;
  /** Freitext-Notiz aus der Maschinenverwaltung (`Machine.info`) */
  info?: string;
}

export interface CatalogCategory {
  id: string;
  label: string;
  /** Favoriten bekommen einen Stern in der Kopfzeile */
  starred?: boolean;
  /** Oberkategorie ("Maschinen", "Messtechnik"), unter der die Kategorie eingeklappt liegt.
   *  Ohne Angabe steht die Kategorie selbst auf oberster Ebene — so die Favoriten. */
  section?: { id: string; label: string };
  devices: Device[];
}

/** Ein einzelnes, konkret gefordertes Gerät. */
export interface PlanDeviceEntry {
  kind: 'device';
  /** Stabile ID des Plan-Eintrags (NICHT die Geräte-ID — Karten sind umsortierbar) */
  id: string;
  deviceId: string;
}

/** Bedarfsgruppe: austauschbare Alternativen, von denen `requiredCount` gebraucht werden.
 *
 *  Eine Alternative ist ein Gerät ODER wieder eine Bedarfsgruppe. Damit lässt sich auch
 *  "entweder die große Presse oder zwei kleine" ausdrücken, was mit einer flachen Liste
 *  von Geräten nicht geht. Der Plan ist dadurch ein Baum; jeder Eintrag trägt eine eigene
 *  ID und ist für sich zieh- und ablegbar. */
export interface PlanGroupEntry {
  kind: 'group';
  id: string;
  members: PlanEntry[];
  /** 1 … members.length */
  requiredCount: number;
}

export type PlanEntry = PlanDeviceEntry | PlanGroupEntry;

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

/** Ein Gerät, das die Suche für einen Treffer konkret eingeplant hat. */
export interface ResolvedDevice {
  deviceId: string;
  /** true = stammt aus einer Bedarfsgruppe, wurde also stellvertretend gewählt */
  fromGroup: boolean;
}

export interface AvailabilityWindow {
  id: string;
  start: Date;
  /** Bei `openEnded` bedeutungslos. */
  end: Date;
  /** Fenster läuft über das Suchende hinaus weiter ("durchgehend frei") */
  openEnded: boolean;
  /** Länge des angebotenen Slots in Tagen, bereits auf das Suchmaximum begrenzt */
  spanDays: number;
  /** Untere/obere Grenze der wählbaren Buchungslänge in diesem Fenster */
  minSelectableDays: number;
  maxSelectableDays: number;
  /** Aktuell gewählte Buchungslänge */
  selectedDays: number;
  devices: ResolvedDevice[];
}
