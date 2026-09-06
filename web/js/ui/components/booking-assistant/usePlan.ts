import * as React from 'react';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { createDeviceEntry } from './plan-tree.ts';
import { dissolveEntry } from './plan-tree.ts';
import { groupAlternatives as groupPlanAlternatives } from './plan-tree.ts';
import { normalizePlan } from './plan-tree.ts';
import { withoutEntry } from './plan-tree.ts';

/** Der Eintrag, der genau dieses eine Gerät ist — egal wie tief er in Bedarfsgruppen steckt. */
const deviceEntryOf = (plan: PlanEntry[], deviceId: string): PlanEntry | undefined =>
  plan.flatMap(flatten).find((entry) => entry.kind === 'device' && entry.deviceId === deviceId);

const flatten = (entry: PlanEntry): PlanEntry[] =>
  entry.kind === 'group' ? [entry, ...entry.members.flatMap(flatten)] : [entry];

export function usePlan() {
  const [plan, setPlan] = React.useState<PlanEntry[]>([]);

  /** Das Häkchen im Katalog: aus dem Plan nehmen, wo immer das Gerät steckt, sonst hinten an. */
  const toggleDevice = (deviceId: string) =>
    setPlan((current) => {
      const present = deviceEntryOf(current, deviceId);
      if (!present) return [...current, createDeviceEntry(deviceId)];
      return normalizePlan(withoutEntry(current, present.id));
    });

  /** Nimmt den Eintrag aus dem Plan — eine Karte, eine Untergruppe oder ein einzelnes
   *  Gerät in einer Bedarfsgruppe; im Baum ist das alles dasselbe. */
  const removeEntry = (entryId: string) =>
    setPlan((current) => normalizePlan(withoutEntry(current, entryId)));

  /** Löst die Bedarfsgruppe auf, ohne etwas aus dem Plan zu werfen: ihre Mitglieder stehen
   *  danach einzeln an derselben Stelle und in derselben Reihenfolge. Nur die
   *  Austauschbarkeit ist weg — wer ein Gerät loswerden will, nimmt dessen eigene Karte. */
  const dissolveGroup = (entryId: string) =>
    setPlan((current) => normalizePlan(dissolveEntry(current, entryId)));

  const setRequiredCount = (entryId: string, value: number) =>
    setPlan((current) => withRequiredCount(current, entryId, value));

  const groupAlternatives = (entryId: string, alternativeIds: string[]) =>
    setPlan((current) => groupPlanAlternatives(current, entryId, alternativeIds));

  return {
    plan,
    setPlan,
    toggleDevice,
    removeEntry,
    dissolveGroup,
    setRequiredCount,
    groupAlternatives,
  };
}

function withRequiredCount(plan: PlanEntry[], entryId: string, value: number): PlanEntry[] {
  return plan.map<PlanEntry>((entry) => {
    if (entry.kind !== 'group') return entry;
    if (entry.id === entryId) return { ...entry, requiredCount: value };
    return { ...entry, members: withRequiredCount(entry.members, entryId, value) };
  });
}
