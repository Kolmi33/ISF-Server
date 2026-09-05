// =======================================================================================
// ASSISTANT PARAMETERS — "Zeitraum & Dauer" (web/js/ui/components/AssistantParameters.tsx)
// =======================================================================================
//
// The date range, minimum duration, eligible-weekday selection, and search action — one
// cohesive card below the two device-selection cards. The search action sits directly
// beside this card's own criteria (not in a page-level footer), with a live selection
// summary alongside it.
//
// =======================================================================================

import { IconLoader2, IconSearch } from '@tabler/icons-react';
import { DateRangePicker } from '../../components/ui/date-range-picker.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Button } from '../../components/ui/button.tsx';
import { closeReactModal } from '../modal.tsx';
import { AssistantWeekdaySelector } from './AssistantWeekdaySelector.tsx';
import type { WeekdayMask } from '../../core/assistant.ts';
import { durationUnitHint } from '../assistant-weekdays.ts';

interface MinDaysFieldProps {
  minDays: number;
  weekdayMask: WeekdayMask;
  onChange: (value: number) => void;
}

/** "Mindestdauer": a compact stepper (decrement disabled at 1) plus direct entry, with its
 *  helper text adapting to the active weekday selection (feature 8). */
function MinDaysField({ minDays, weekdayMask, onChange }: MinDaysFieldProps) {
  return (
    <div className="assist-duration">
      <label htmlFor="assist-days">Mindestdauer</label>
      <div className="assist-duration-input">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Weniger Tage"
          disabled={minDays <= 1}
          onClick={() => onChange(Math.max(1, minDays - 1))}
        >
          –
        </Button>
        <Input
          id="assist-days"
          type="number"
          value={minDays}
          min={1}
          max={30}
          aria-describedby="assist-days-hint"
          onChange={(event) =>
            onChange(Math.max(1, Math.min(30, parseInt(event.target.value) || 1)))
          }
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Mehr Tage"
          onClick={() => onChange(Math.min(30, minDays + 1))}
        >
          +
        </Button>
      </div>
      <span id="assist-days-hint" className="assist-hint">
        {durationUnitHint(weekdayMask)}
      </span>
    </div>
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
      <div className="assist-parameters-separator" />
      <AssistantSearchRow summary={summary} isSearching={isSearching} onSearch={onSearch} />
    </section>
  );
}
