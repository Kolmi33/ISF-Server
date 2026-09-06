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
export function AssistantModal() {
  const [initialRange] = useState(() => ({
    from: startOfDay(new Date()),
    to: addDays(startOfDay(new Date()), 6),
  }));
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
      onSearch={(plan, range, min, max) =>
        searchAssistant(store.get('data')!, plan, range, min, max)
      }
      onBook={bookResult}
      onShowCalendar={showCalendar}
      onClose={closeReactModal}
      onCancel={closeReactModal}
    />
  );
}

export function openAssistant(): void {
  openReactModal(<AssistantModal />);
}
