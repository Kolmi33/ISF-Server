import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { useSyncExternalStore } from 'react';
import { de } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import '../../../css/calendar.css';

const compactQuery = '(max-width: 600px)';
function subscribeToViewport(onChange: () => void) {
  const query = window.matchMedia?.(compactQuery);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}
function isCompactViewport() {
  return window.matchMedia?.(compactQuery).matches ?? false;
}

/** shadcn Calendar composition, using DayPicker's keyboard and range-selection behavior. */
export function Calendar(props: DayPickerProps) {
  const compact = useSyncExternalStore(subscribeToViewport, isCompactViewport, () => false);
  return (
    <DayPicker
      locale={de}
      timeZone="UTC"
      weekStartsOn={1}
      showOutsideDays
      navLayout="after"
      {...props}
      numberOfMonths={compact ? 1 : props.numberOfMonths}
      className={`calendar ${props.className ?? ''}`}
    />
  );
}
