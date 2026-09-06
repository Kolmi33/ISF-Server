import * as React from 'react';
import { addDays } from 'date-fns';
import { startOfDay } from 'date-fns';
import { type CatalogCategory } from '../../../core/booking-assistant-types.ts';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { type DateRange } from '../../../core/booking-assistant-types.ts';
import { type AvailabilityWindow } from '../../../core/booking-assistant-types.ts';
import { deviceIdsOf } from './model.ts';
import { usePlan } from './usePlan.ts';
import { usePlanDrag } from './usePlanDrag.ts';
import { useCriteria } from './useCriteria.ts';
import { useCatalog } from './useCatalog.ts';
import { toast } from '../../toast.ts';

export interface BuchungsAssistentProps {
  catalog: CatalogCategory[];
  onSearch: (
    plan: PlanEntry[],
    range: DateRange,
    minDays: number,
    maxDays: number,
  ) => AvailabilityWindow[];
  onShowCalendar: (window: AvailabilityWindow) => void;
  initialRange?: DateRange;
  /** frühester buchbarer Tag; Default: heute */
  today?: Date;
  onClose?: () => void;
  onCancel?: () => void;
  onBook?: (window: AvailabilityWindow) => void;
}

export function useAssistantState(props: BuchungsAssistentProps) {
  const {
    catalog,
    initialRange = { from: startOfDay(new Date()), to: addDays(startOfDay(new Date()), 6) },
    today = startOfDay(new Date()),
  } = props;
  const planState = usePlan();
  const catalogState = useCatalog(catalog);
  const criteria = useCriteria(initialRange);
  const drag = usePlanDrag(planState.plan, planState.setPlan);
  const [view, setView] = React.useState<'select' | 'results'>('select');
  const [results, setResults] = React.useState<AvailabilityWindow[]>([]);
  const runSearch = () => {
    try {
      setResults(
        props.onSearch(planState.plan, criteria.range, criteria.minDays, criteria.maxDays),
      );
      setView('results');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Die Suche konnte nicht ausgeführt werden.');
    }
  };
  const changeResultDays = (windowId: string, days: number) =>
    setResults((current) =>
      current.map((w) => (w.id === windowId ? { ...w, selectedDays: days } : w)),
    );

  return {
    ...props,
    today,
    ...planState,
    ...catalogState,
    ...criteria,
    ...drag,
    view,
    setView,
    results,
    runSearch,
    changeResultDays,
    selectedDeviceIds: planState.plan.flatMap(deviceIdsOf),
  };
}
export type AssistantState = ReturnType<typeof useAssistantState>;
