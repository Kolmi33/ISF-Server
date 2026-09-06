import { differenceInCalendarDays } from 'date-fns';
import { format } from 'date-fns';
import { startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { type PlanDeviceEntry } from '../../../core/booking-assistant-types.ts';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { type DateRange } from '../../../core/booking-assistant-types.ts';

export const formatDate = (d?: Date) => (d ? format(d, 'dd.MM.yyyy') : 'TT.MM.JJJJ');
/** Mo., 18.09.2026 */
export const formatDateLong = (d: Date) => format(d, 'EE, dd.MM.yyyy', { locale: de });

/** Inklusive Tageszählung: 18.09. → 24.09. sind 7 Tage. */
export const countDays = (from: Date, to: Date) =>
  differenceInCalendarDays(startOfDay(to), startOfDay(from)) + 1;

export const rangeLengthOf = (r: DateRange, fallback = 90) =>
  r.from && r.to ? countDays(r.from, r.to) : fallback;

/** Zwei Klicks ergeben einen Zeitraum: der erste setzt den Start, der zweite das Ende — wer
 *  früher klickt, dreht beide um. Auf einen fertigen Zeitraum folgt wieder ein Start.
 *
 *  Genau das ist der Unterschied zur eingebauten Auswahl von react-day-picker: die zieht bei
 *  einem fertigen Zeitraum nur das Ende nach und verschiebt den Start ausschließlich, wenn
 *  man *vor* ihn klickt. Da hier alles vor heute gesperrt ist und der Start anfangs auf
 *  heute steht, gab es keinen solchen Tag — der Startpunkt ließ sich nicht mehr ändern. Die
 *  Fußzeile des Kalenders ("Startdatum wählen" → "Enddatum wählen") beschreibt ohnehin
 *  diesen Zwei-Klick-Ablauf. */
export function pickRangeDay(current: DateRange, day: Date): DateRange {
  if (!current.from || current.to) return { from: day, to: undefined };
  return differenceInCalendarDays(day, current.from) < 0
    ? { from: day, to: current.from }
    : { from: current.from, to: day };
}

export const ENTRY_PREFIX = 'entry:';
/** Die Listenfläche als Ganzes — Auffangziel für alles, was keine Karte trifft. */
export const PLAN_LIST_ID = 'plan-list';
export const entryDragId = (entryId: string) => `${ENTRY_PREFIX}${entryId}`;
export const memberDragId = (entryId: string, deviceId: string) => `member:${entryId}:${deviceId}`;

export type DragSource =
  { type: 'entry'; entryId: string } | { type: 'member'; entryId: string; deviceId: string };

export function parseDragId(id: string): DragSource | null {
  const [prefix, entryId, deviceId] = id.split(':');
  if (prefix === 'entry' && entryId) return { type: 'entry', entryId };
  if (prefix === 'member' && entryId && deviceId) return { type: 'member', entryId, deviceId };
  return null;
}

export const deviceIdsOf = (entry: PlanEntry) =>
  entry.kind === 'group' ? entry.deviceIds : [entry.deviceId];

/** Gruppen mit 0 Mitgliedern verschwinden, mit 1 Mitglied werden sie wieder
 *  zur normalen Karte. Nach jeder Plan-Mutation aufrufen. */
export function normalizePlan(plan: PlanEntry[]): PlanEntry[] {
  return plan.flatMap<PlanEntry>((entry) => {
    if (entry.kind === 'device') return [entry];
    if (entry.deviceIds.length === 0) return [];
    if (entry.deviceIds.length === 1)
      return [{ kind: 'device', id: entry.id, deviceId: entry.deviceIds[0]! }];
    return [
      {
        ...entry,
        requiredCount: Math.min(entry.requiredCount, entry.deviceIds.length),
      },
    ];
  });
}

let entryCounter = 0;
export const createDeviceEntry = (deviceId: string): PlanDeviceEntry => ({
  kind: 'device',
  id: `entry-${++entryCounter}-${Date.now().toString(36)}`,
  deviceId,
});

/** Wohin ein Zug innerhalb der getroffenen Karte zielt: auf sie drauf (gruppieren) oder in
 *  die Fuge davor bzw. dahinter (einfügen). */
export type DropZone = 'before' | 'merge' | 'after';

/** Karten-ID hinter einer Ziel-ID — `''`, wenn das Ziel keine Karte ist. */
export const entryIdOf = (overId: string) =>
  overId.startsWith(ENTRY_PREFIX) ? overId.slice(ENTRY_PREFIX.length) : '';

/** Was ein Ablegen an dieser Stelle bewirken würde. `index` zählt in der Liste *mit* der
 *  gezogenen Karte — genau die Fuge, in der die grüne Linie steht. `null` = der Zug ändert
 *  nichts, dann zeigt die Liste auch keine Marke. */
export type DropPlan = { kind: 'merge'; targetId: string } | { kind: 'insert'; index: number };

/** Die eine Auslegung eines Zuges: Anzeige während des Ziehens und Änderung beim Loslassen
 *  fragen dieselbe Funktion, damit die Marke nicht etwas anderes verspricht als passiert. */
export function planDrop(
  plan: PlanEntry[],
  source: DragSource,
  overId: string,
  zone: DropZone,
): DropPlan | null {
  /* Die freie Fläche unter den Karten ist einfach die letzte Fuge — dort loslassen heißt
     "raus damit", ohne eine Fuge treffen zu müssen. Eine Zone hat sie nicht. */
  if (overId === PLAN_LIST_ID) return insertInto(plan, source, plan.length);
  const targetId = entryIdOf(overId);
  const targetIndex = targetId ? plan.findIndex((entry) => entry.id === targetId) : -1;
  if (targetIndex < 0) return null;
  /* Auf die eigene Karte bzw. zurück in die eigene Bedarfsgruppe: nichts zu tun. */
  if (zone === 'merge') return targetId === source.entryId ? null : { kind: 'merge', targetId };
  return insertInto(plan, source, zone === 'after' ? targetIndex + 1 : targetIndex);
}

/** Eine ganze Karte an ihrem eigenen Platz zu lassen ist keine Änderung; ein Gerät aus einer
 *  Bedarfsgruppe zu lösen dagegen immer, auch direkt neben seiner Gruppe. */
function insertInto(plan: PlanEntry[], source: DragSource, index: number): DropPlan | null {
  if (source.type === 'member') return { kind: 'insert', index };
  const from = plan.findIndex((entry) => entry.id === source.entryId);
  if (from < 0 || index === from || index === from + 1) return null;
  return { kind: 'insert', index };
}

/** Setzt die Karte an `from` in die Fuge `insertAt` um, die in der Liste *mit* dieser Karte
 *  gezählt ist: nach dem Herausnehmen rutschen alle Fugen dahinter um eins vor. */
export function moveEntryTo(plan: PlanEntry[], from: number, insertAt: number): PlanEntry[] {
  const next = [...plan];
  const [moving] = next.splice(from, 1);
  next.splice(insertAt > from ? insertAt - 1 : insertAt, 0, moving!);
  return next;
}
