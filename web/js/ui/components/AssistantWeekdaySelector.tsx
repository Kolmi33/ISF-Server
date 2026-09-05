// =======================================================================================
// ASSISTANT WEEKDAY SELECTOR (web/js/ui/components/AssistantWeekdaySelector.tsx)
// =======================================================================================
//
// "Buchbare Wochentage": which calendar weekdays the search treats as eligible at all. A
// Base UI ToggleGroup (multiple selection) of the seven weekdays, plus two presets that just
// set the same underlying mask — not a separate mode, so presets and individual toggles can
// never disagree about the current selection.
//
// Key Principles:
// - PRESENTATION ONLY: the mask itself, and what days it makes "adjacent" for run
//   continuity, are `core/assistant.ts`'s `WeekdayMask` — this component only turns it into
//   toggle-button state and back (`ui/assistant-weekdays.ts`).
//
// =======================================================================================

import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import type { WeekdayMask } from '../../core/assistant.ts';
import { WEEKDAYS_MON_FRI, WEEKDAYS_ALL } from '../../core/assistant.ts';
import {
  WEEKDAY_OPTIONS,
  selectedWeekdayIndices,
  maskFromSelectedIndices,
} from '../assistant-weekdays.ts';
import { Button } from '../../components/ui/button.tsx';

export interface AssistantWeekdaySelectorProps {
  mask: WeekdayMask;
  onChange: (mask: WeekdayMask) => void;
  error: string | null;
}

/** The two compact preset shortcuts — set the mask directly, so they always stay in sync
 *  with whatever the individual toggles currently show (no separate "preset mode" to fall
 *  out of sync with). */
function WeekdayPresets({ onChange }: { onChange: (mask: WeekdayMask) => void }) {
  return (
    <div className="assist-weekday-presets">
      <Button type="button" variant="outline" size="xs" onClick={() => onChange(WEEKDAYS_MON_FRI)}>
        Mo–Fr
      </Button>
      <Button type="button" variant="outline" size="xs" onClick={() => onChange(WEEKDAYS_ALL)}>
        Alle Tage
      </Button>
    </div>
  );
}

export function AssistantWeekdaySelector({ mask, onChange, error }: AssistantWeekdaySelectorProps) {
  const value = selectedWeekdayIndices(mask).map(String);
  return (
    <div className="assist-weekdays">
      <div className="assist-weekdays-head">
        <label id="assist-weekdays-label">Buchbare Wochentage</label>
        <WeekdayPresets onChange={onChange} />
      </div>
      <ToggleGroup
        multiple
        aria-labelledby="assist-weekdays-label"
        aria-describedby={error ? 'assist-weekdays-error' : 'assist-weekdays-hint'}
        aria-invalid={!!error}
        value={value}
        onValueChange={(next) => onChange(maskFromSelectedIndices(next.map(Number)))}
        className="assist-weekday-toggles"
      >
        {WEEKDAY_OPTIONS.map((day) => (
          <Toggle
            key={day.index}
            value={String(day.index)}
            aria-label={day.full}
            className="assist-weekday-toggle"
          >
            {day.short}
          </Toggle>
        ))}
      </ToggleGroup>
      {error ? (
        <span id="assist-weekdays-error" className="assist-field-error" role="alert">
          {error}
        </span>
      ) : (
        <span id="assist-weekdays-hint" className="assist-hint">
          Nur ausgewählte Wochentage werden bei der Suche berücksichtigt.
        </span>
      )}
    </div>
  );
}
