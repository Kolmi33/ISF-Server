import { DateRangePicker } from '../../components/ui/date-range-picker.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Button } from '../../components/ui/button.tsx';
import { closeReactModal } from '../modal.tsx';

interface AssistantParametersProps {
  from: string;
  to: string;
  minDays: number;
  onRangeChange: (from: string, to: string) => void;
  onMinDaysChange: (value: number) => void;
}

/** Shared final step below both device-selection cards. */
export function AssistantParameters({
  from,
  to,
  minDays,
  onRangeChange,
  onMinDaysChange,
}: AssistantParametersProps) {
  return (
    <section className="assist-card assist-parameters" aria-labelledby="assist-parameters-title">
      <h3 className="assist-card-title" id="assist-parameters-title">
        Auswahl Zeitraum und gewünschter Buchungstage
      </h3>
      <div className="assist-parameter-fields">
        <DateRangePicker from={from} to={to} onChange={onRangeChange} />
        <div className="assist-duration">
          <label htmlFor="assist-days">Mind. Tage am Stück</label>
          <div className="assist-duration-input">
            <Input
              id="assist-days"
              type="number"
              value={minDays}
              min={1}
              max={30}
              aria-describedby="assist-days-hint"
              onChange={(event) =>
                onMinDaysChange(Math.max(1, Math.min(30, parseInt(event.target.value) || 1)))
              }
            />
            <span id="assist-days-hint" className="assist-hint">
              Arbeitstage (Mo-Fr)
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export interface AssistantActionsProps {
  onSearch: () => void;
}

/** Page-level actions for the complete filter zone, rather than one parameter card. */
export function AssistantActions({ onSearch }: AssistantActionsProps) {
  return (
    <div className="assist-actions assist-global-actions">
      <Button variant="ghost" size="lg" className="assist-cancel-action" onClick={closeReactModal}>
        Abbrechen
      </Button>
      <Button size="lg" className="assist-search-action" onClick={onSearch}>
        Freie Termine suchen
      </Button>
    </div>
  );
}
