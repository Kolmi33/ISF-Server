// =======================================================================================
// DER PLAN ALS BAUM (web/js/ui/components/booking-assistant/plan-tree.ts)
// =======================================================================================
//
// Ein Plan ist eine Liste von Einträgen; eine Bedarfsgruppe hat selbst wieder Einträge als
// Mitglieder, auch Gruppen. Damit lässt sich "entweder die große Presse oder zwei kleine"
// ausdrücken, was eine flache Geräteliste nicht kann.
//
// Jeder Eintrag — oben wie tief drin — trägt eine eigene ID und ist dadurch für sich zieh-
// und ablegbar. Genau deshalb ist hier alles rekursiv und es gibt keinen Sonderfall
// "Mitglied" mehr: ein Mitglied ist ein Eintrag wie jeder andere.
//
// =======================================================================================

import { type PlanDeviceEntry } from '../../../core/booking-assistant-types.ts';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';

export const ENTRY_PREFIX = 'entry:';
/** Die Listenfläche als Ganzes — Auffangziel für alles, was keine Karte trifft. */
export const PLAN_LIST_ID = 'plan-list';
export const entryDragId = (entryId: string) => `${ENTRY_PREFIX}${entryId}`;

/** Eintrags-ID hinter einer Drag- oder Drop-ID — `''`, wenn es kein Eintrag ist. */
export const entryIdOf = (dragId: string) =>
  dragId.startsWith(ENTRY_PREFIX) ? dragId.slice(ENTRY_PREFIX.length) : '';

/** Alle Geräte unter einem Eintrag, beliebig tief. */
export const deviceIdsOf = (entry: PlanEntry): string[] =>
  entry.kind === 'group' ? entry.members.flatMap(deviceIdsOf) : [entry.deviceId];

/** Der Eintrag mit dieser ID, egal wie tief er liegt. */
export function findEntry(plan: PlanEntry[], id: string): PlanEntry | undefined {
  for (const entry of plan) {
    if (entry.id === id) return entry;
    if (entry.kind === 'group') {
      const hit = findEntry(entry.members, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Enthält `entry` diese ID — als sich selbst oder irgendwo unter sich? Verhindert, dass
 *  eine Gruppe in ihre eigene Untergruppe wandert und der Baum sich zu einem Ring schließt. */
export const entryContains = (entry: PlanEntry, id: string): boolean =>
  entry.id === id || (entry.kind === 'group' && entry.members.some((m) => entryContains(m, id)));

/** Nimmt den Eintrag überall aus dem Baum heraus. Bewusst ohne Normalisierung: die kommt
 *  erst, wenn er an seiner neuen Stelle sitzt, sonst zerfiele eine ausgedünnte Gruppe
 *  zwischendurch und das Ziel wäre verschwunden. */
export function withoutEntry(plan: PlanEntry[], id: string): PlanEntry[] {
  return plan
    .filter((entry) => entry.id !== id)
    .map((entry) =>
      entry.kind === 'group' ? { ...entry, members: withoutEntry(entry.members, id) } : entry,
    );
}

/** Setzt `moving` als Geschwister von `targetId` ein — auf der Ebene, auf der das Ziel liegt. */
export function insertBeside(
  plan: PlanEntry[],
  targetId: string,
  side: 'before' | 'after',
  moving: PlanEntry,
): PlanEntry[] {
  const index = plan.findIndex((entry) => entry.id === targetId);
  if (index >= 0) {
    const next = [...plan];
    next.splice(side === 'after' ? index + 1 : index, 0, moving);
    return next;
  }
  return plan.map((entry) =>
    entry.kind === 'group'
      ? { ...entry, members: insertBeside(entry.members, targetId, side, moving) }
      : entry,
  );
}

/** Macht `moving` zum Mitglied von `targetId`: aus einem Gerät wird eine neue Bedarfsgruppe
 *  aus beiden, eine bestehende Gruppe bekommt es hinten angehängt. Ist `moving` selbst eine
 *  Gruppe, entsteht genau dadurch die Gruppe in der Gruppe. */
export function addMember(plan: PlanEntry[], targetId: string, moving: PlanEntry): PlanEntry[] {
  return plan.map<PlanEntry>((entry) => {
    if (entry.id !== targetId)
      return entry.kind === 'group'
        ? { ...entry, members: addMember(entry.members, targetId, moving) }
        : entry;
    if (entry.kind === 'group') return { ...entry, members: [...entry.members, moving] };
    return { kind: 'group', id: entry.id, members: [entry, moving], requiredCount: 1 };
  });
}

/** Ersetzt die Gruppe durch ihre Mitglieder — an Ort und Stelle, auf ihrer Ebene. */
export function dissolveEntry(plan: PlanEntry[], id: string): PlanEntry[] {
  return plan.flatMap<PlanEntry>((entry) => {
    if (entry.id === id) return entry.kind === 'group' ? entry.members : [entry];
    return entry.kind === 'group'
      ? [{ ...entry, members: dissolveEntry(entry.members, id) }]
      : [entry];
  });
}

/** Eine Gruppe ohne Mitglieder verschwindet; eine mit einem einzigen ist keine Wahl mehr und
 *  wird durch dieses Mitglied ersetzt. Nach jeder Plan-Änderung aufrufen. */
export function normalizePlan(plan: PlanEntry[]): PlanEntry[] {
  return plan.flatMap<PlanEntry>((entry) => {
    if (entry.kind === 'device') return [entry];
    const members = normalizePlan(entry.members);
    if (members.length === 0) return [];
    if (members.length === 1) return members;
    return [{ ...entry, members, requiredCount: Math.min(entry.requiredCount, members.length) }];
  });
}

let entryCounter = 0;
export const createDeviceEntry = (deviceId: string): PlanDeviceEntry => ({
  kind: 'device',
  id: `entry-${++entryCounter}-${Date.now().toString(36)}`,
  deviceId,
});
