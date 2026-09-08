import { useState } from 'react';
import { addDays, startOfDay, format } from 'date-fns';
import { mondayOfDate, parseIsoDateString } from '../../../../shared/dates.ts';
import type { AvailabilityWindow } from '../../core/booking-assistant-types.ts';
import { store } from '../../store-instance.ts';
import {
  assistantBooking,
  assistantCatalog,
  searchAssistant,
} from '../booking-assistant-adapter.ts';
import { closeReactModal, collapseReactModal, openReactModal } from '../modal.tsx';
import { orderedMachines } from '../grid.ts';
import { clearSelection } from '../grid-interaction.ts';
import { gotoDate, prependWeek, resetView } from '../grid-scroll.ts';
import { toast } from '../toast.ts';
import { openBookingForm } from './BookingForm.tsx';
import { saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';
import { BuchungsAssistent } from './booking-assistant/BuchungsAssistent.tsx';
import { createDeviceEntry } from './booking-assistant/plan-tree.ts';

export interface AssistantPreset {
  machineIds: readonly string[];
  workdays: number;
}

function nextMonday(): Date {
  const tomorrow = addDays(startOfDay(new Date()), 1);
  return addDays(tomorrow, (8 - tomorrow.getDay()) % 7);
}

function endOfWorkdayRange(from: Date, workdays: number): Date {
  let result = from;
  let remaining = Math.max(1, workdays) - 1;
  while (remaining > 0) {
    result = addDays(result, 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) remaining -= 1;
  }
  return result;
}

function showCalendar(result: AvailabilityWindow): void {
  const firstDate = format(result.start, 'yyyy-MM-dd');
  collapseReactModal();
  store.state.machSel = new Set(result.devices.map((device) => device.deviceId));
  saveFilters();
  updateMachBtn();
  store.state.startMonday = mondayOfDate(parseIsoDateString(firstDate));
  resetView();
  store.notify();
  prependWeek();
  clearSelection();
  gotoDate(firstDate);
}

function bookResult(result: AvailabilityWindow): void {
  try {
    if (store.get('readOnly')) throw new Error('Buchungen sind im Lesemodus nicht möglich.');
    const booking = assistantBooking(store.get('data')!, result);
    openBookingForm(booking.ids, booking.from, booking.to, booking.dates);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Die Buchung konnte nicht vorbereitet werden.');
  }
}

/** Thin host adapter: the supplied frontend owns its presentation and interaction state. */
export function AssistantModal({ preset }: { preset?: AssistantPreset }) {
  const [initialRange] = useState(() => {
    if (!preset) return { from: startOfDay(new Date()), to: addDays(startOfDay(new Date()), 6) };
    const from = nextMonday();
    return { from, to: endOfWorkdayRange(from, preset.workdays) };
  });
  const [initialPlan] = useState(() =>
    preset?.machineIds.map((machineId) => createDeviceEntry(machineId)),
  );
  const [catalog] = useState(() =>
    assistantCatalog(
      orderedMachines(store.get('data')!.machines, store.get('favs')),
      store.get('favs'),
    ),
  );
  return (
    <BuchungsAssistent
      catalog={catalog}
      initialRange={initialRange}
      initialPlan={initialPlan}
      initialDuration={preset?.workdays}
      onSearch={(plan, range, min, max) =>
        searchAssistant(store.get('data')!, plan, range, min, max)
      }
      onBook={bookResult}
      onShowCalendar={showCalendar}
      onCancel={closeReactModal}
    />
  );
}

export function openAssistant(): void {
  openReactModal(<AssistantModal />, { sticky: true });
}
