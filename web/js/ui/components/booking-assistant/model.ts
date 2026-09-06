import { differenceInCalendarDays } from 'date-fns';
import { format } from 'date-fns';
import { startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
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
