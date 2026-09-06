export interface Device {
  id: string;
  /** Anzeigename, z. B. "BERGER 5070A" */
  name: string;
  /** Inventarkürzel, wird in Monospace gesetzt */
  code: string;
  /** Standort, z. B. "Labor 2" */
  lab: string;
}

export interface CatalogCategory {
  id: string;
  label: string;
  /** Favoriten bekommen einen Stern in der Kopfzeile */
  starred?: boolean;
  devices: Device[];
}

/** Ein einzelnes, konkret gefordertes Gerät. */
export interface PlanDeviceEntry {
  kind: 'device';
  /** Stabile ID des Plan-Eintrags (NICHT die Geräte-ID — Karten sind umsortierbar) */
  id: string;
  deviceId: string;
}

/** Bedarfsgruppe: austauschbare Alternativen, von denen `requiredCount` gebraucht werden. */
export interface PlanGroupEntry {
  kind: 'group';
  id: string;
  deviceIds: string[];
  /** 1 … deviceIds.length */
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
  /** Länge des freien Fensters in Tagen */
  spanDays: number;
  /** Untere/obere Grenze der wählbaren Buchungslänge in diesem Fenster */
  minSelectableDays: number;
  maxSelectableDays: number;
  /** Aktuell gewählte Buchungslänge */
  selectedDays: number;
  devices: ResolvedDevice[];
}
