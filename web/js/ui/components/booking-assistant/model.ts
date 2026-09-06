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

export const ENTRY_PREFIX = 'entry:';
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

/** Stelle in der Planliste, an der eine Karte eingefügt würde. `null` = es wird gar nicht
 *  eingefügt (gruppieren) oder das Ziel gibt es nicht mehr. */
export function insertIndexOf(plan: PlanEntry[], overId: string, zone: DropZone): number | null {
  if (zone === 'merge') return null;
  const entryId = entryIdOf(overId);
  if (!entryId) return null;
  const index = plan.findIndex((entry) => entry.id === entryId);
  if (index < 0) return null;
  return zone === 'after' ? index + 1 : index;
}
