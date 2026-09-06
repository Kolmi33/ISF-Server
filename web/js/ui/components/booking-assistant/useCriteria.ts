import * as React from 'react';
import { type DateRange } from '../../../core/booking-assistant-types.ts';
import { countDays } from './model.ts';
import { rangeLengthOf } from './model.ts';
import { type LimitEdge } from './NumberField.tsx';

export function useCriteria(initialRange: DateRange) {
  const [range, setRange] = React.useState(initialRange);
  const [minDays, setMinDays] = React.useState(1);
  const [maxDays, setMaxDays] = React.useState(() => rangeLengthOf(initialRange));
  const [limitHint, setLimitHint] = React.useState<{ seq: number; message: string } | null>(null);
  const rangeLength = rangeLengthOf(range);
  const limitSeq = React.useRef(0);
  const limitTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const flagLimit = (edge: LimitEdge) => {
    limitSeq.current += 1;
    setLimitHint({
      seq: limitSeq.current,
      message:
        edge === 'upper'
          ? `Der gewählte Zeitraum umfasst nur ${rangeLength} Tage.`
          : 'Weniger als 1 Tag ist nicht buchbar.',
    });
    clearTimeout(limitTimer.current);
    limitTimer.current = setTimeout(() => setLimitHint(null), 2800);
  };
  React.useEffect(() => () => clearTimeout(limitTimer.current), []);

  const changeMinDays = (value: number) => {
    setMinDays(value);
    if (value > maxDays) setMaxDays(value);
  };
  const changeMaxDays = (value: number) => {
    setMaxDays(value);
    if (value < minDays) setMinDays(value);
  };

  /** Eine Buchung kann nie länger sein als der gewählte Zeitraum. */
  const applyRange = (next: DateRange) => {
    setRange(next);
    if (!next.from || !next.to) return;
    const length = countDays(next.from, next.to);
    setMinDays((v) => Math.min(v, length));
    setMaxDays((v) => Math.min(v, length));
  };

  return {
    range,
    minDays,
    maxDays,
    limitHint,
    rangeLength,
    flagLimit,
    changeMinDays,
    changeMaxDays,
    applyRange,
  };
}
