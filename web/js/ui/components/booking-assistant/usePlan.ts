import * as React from 'react';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { deviceIdsOf } from './model.ts';
import { normalizePlan } from './model.ts';
import { createDeviceEntry } from './model.ts';

export function usePlan() {
  const [plan, setPlan] = React.useState<PlanEntry[]>([]);
  const toggleDevice = (deviceId: string) => {
    setPlan((current) => {
      const present = current.some((entry) => deviceIdsOf(entry).includes(deviceId));
      if (!present) return [...current, createDeviceEntry(deviceId)];
      return normalizePlan(
        current
          .map((entry) =>
            entry.kind === 'group'
              ? { ...entry, deviceIds: entry.deviceIds.filter((id) => id !== deviceId) }
              : entry,
          )
          .filter((entry) => entry.kind === 'group' || entry.deviceId !== deviceId),
      );
    });
  };

  const removeEntry = (entryId: string) =>
    setPlan((current) => current.filter((entry) => entry.id !== entryId));

  const removeMember = (entryId: string, deviceId: string) =>
    setPlan((current) =>
      normalizePlan(
        current.map((entry) =>
          entry.id === entryId && entry.kind === 'group'
            ? { ...entry, deviceIds: entry.deviceIds.filter((id) => id !== deviceId) }
            : entry,
        ),
      ),
    );

  const setRequiredCount = (entryId: string, value: number) =>
    setPlan((current) =>
      current.map((entry) =>
        entry.id === entryId && entry.kind === 'group' ? { ...entry, requiredCount: value } : entry,
      ),
    );

  return { plan, setPlan, toggleDevice, removeEntry, removeMember, setRequiredCount };
}
