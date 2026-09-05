// =======================================================================================
// ASSISTANT PARAMETERS — "Zeitraum & Dauer" (web/js/ui/components/AssistantParameters.tsx)
// =======================================================================================
//
// The date range, minimum duration, eligible-weekday selection, and search action — one
// cohesive card below the two device-selection cards. The search action sits directly
// beside this card's own criteria (not in a page-level footer), with a live selection
// summary alongside it.
//
// Key Principles:
// - FIELD OWNS THE RHYTHM: every labelled control is a `Field` (label → control →
//   description/error), so the two columns share one vertical rhythm instead of each
//   hand-managing its own label margins — which is what let them drift out of alignment.
//
// =======================================================================================

import { IconLoader2, IconSearch } from '@tabler/icons-react';
import { DateRangePicker } from '../../components/ui/date-range-picker.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field, FieldDescription, FieldLabel } from '../../components/ui/field.tsx';
import { NumberInput } from '../../components/ui/number-field.tsx';
import { Separator } from '../../components/ui/separator.tsx';
import { closeReactModal } from '../modal.tsx';
import { AssistantWeekdaySelector } from './AssistantWeekdaySelector.tsx';
import type { WeekdayMask } from '../../core/assistant.ts';
import { durationUnitHint } from '../assistant-weekdays.ts';

const MAX_MIN_DAYS = 30;

/** "Mindestdauer": one segmented number control, with helper text adapting to the active
 *  weekday selection (feature 8). */
function MinDaysField({
  minDays,
  weekdayMask,
  onChange,
}: {
  minDays: number;
  weekdayMask: WeekdayMask;
  onChange: (value: number) => void;
}) {
  return (
    <Field className="assist-duration">
      <FieldLabel>Mindestdauer</FieldLabel>
      <NumberInput
        value={minDays}
        min={1}
        max={MAX_MIN_DAYS}
        onValueChange={onChange}
        decrementLabel="Weniger Tage"
        incrementLabel="Mehr Tage"
      />
      <FieldDescription>{durationUnitHint(weekdayMask)}</FieldDescription>
    </Field>
  );
}

interface AssistantParametersProps {
  from: string;
  to: string;
  minDays: number;
  weekdayMask: WeekdayMask;
  rangeError: string | null;
  weekdayError: string | null;
  summary: string;
  isSearching: boolean;
  onRangeChange: (from: string, to: string) => void;
  onMinDaysChange: (value: number) => void;
  onWeekdayMaskChange: (mask: WeekdayMask) => void;
  onSearch: () => void;
}

/** The search action + live selection summary, directly beside this card's own criteria. */
function AssistantSearchRow({
  summary,
  isSearching,
  onSearch,
}: {
  summary: string;
  isSearching: boolean;
  onSearch: () => void;
}) {
  return (
    <div className="assist-search-row">
      <span className="assist-selection-summary">{summary}</span>
      <div className="assist-actions">
        <Button
          variant="ghost"
          size="lg"
          className="assist-cancel-action"
          onClick={closeReactModal}
        >
          Abbrechen
        </Button>
        <Button
          size="lg"
          className="assist-search-action"
          disabled={isSearching}
          onClick={onSearch}
        >
          {isSearching ? (
            <>
              <IconLoader2 className="animate-spin" size={16} aria-hidden="true" />
              Termine werden gesucht…
            </>
          ) : (
            <>
              <IconSearch size={16} aria-hidden="true" />
              Freie Termine suchen
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/** "Zeitraum & Dauer": date range + duration on the first row, eligible weekdays on the
 *  second, then a separator before the summary/search row. */
export function AssistantParameters({
  from,
  to,
  minDays,
  weekdayMask,
  rangeError,
  weekdayError,
  summary,
  isSearching,
  onRangeChange,
  onMinDaysChange,
  onWeekdayMaskChange,
  onSearch,
}: AssistantParametersProps) {
  return (
    <section className="assist-card assist-parameters" aria-labelledby="assist-parameters-title">
      <h3 className="assist-card-title" id="assist-parameters-title">
        Zeitraum &amp; Dauer
      </h3>
      <p className="assist-card-description">
        Legen Sie fest, wann und wie lange Sie die Geräte benötigen.
      </p>
      <div className="assist-parameter-fields">
        <DateRangePicker from={from} to={to} onChange={onRangeChange} error={rangeError} />
        <MinDaysField minDays={minDays} weekdayMask={weekdayMask} onChange={onMinDaysChange} />
      </div>
      <AssistantWeekdaySelector
        mask={weekdayMask}
        onChange={onWeekdayMaskChange}
        error={weekdayError}
      />
      <Separator className="assist-parameters-separator" />
      <AssistantSearchRow summary={summary} isSearching={isSearching} onSearch={onSearch} />
    </section>
  );
}
