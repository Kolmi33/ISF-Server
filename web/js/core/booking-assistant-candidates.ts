import type { PlanEntry } from './booking-assistant-types.ts';

export type AvailabilitySet = readonly boolean[];

/** One fixed machine combination and its shared availability on the evaluated workday axis. */
export interface Candidate {
  machineIds: string[];
  availability: AvailabilitySet;
}

function hasMinimumRun(
  availability: AvailabilitySet,
  minDays: number,
  lastStartIndex: number,
): boolean {
  let runLength = 0;
  for (let index = 0; index < availability.length; index++) {
    runLength = availability[index] ? runLength + 1 : 0;
    if (runLength >= minDays && index - runLength + 1 <= lastStartIndex) return true;
  }
  return false;
}

const intersectAvailability = (left: AvailabilitySet, right: AvailabilitySet): boolean[] =>
  left.map((available, index) => available && !!right[index]);

/** All ways to choose exactly `requiredCount` direct members of an N-of-M group. */
function memberSelections(memberCount: number, requiredCount: number): number[][] {
  const selections: number[][] = [];
  const visit = (next: number, selected: number[]): void => {
    if (selected.length === requiredCount) {
      selections.push(selected);
      return;
    }
    for (let index = next; index <= memberCount - (requiredCount - selected.length); index++)
      visit(index + 1, [...selected, index]);
  };
  visit(0, []);
  return selections;
}

function deduplicateCandidates(candidates: Candidate[]): Candidate[] {
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const machineIds = [...candidate.machineIds].sort();
    const key = machineIds.join('\u0000');
    if (!unique.has(key)) unique.set(key, { machineIds, availability: candidate.availability });
  }
  return [...unique.values()];
}

function combineCandidateLists(
  lists: Candidate[][],
  dayCount: number,
  minDays: number,
  lastStartIndex: number,
): Candidate[] {
  let combined: Candidate[] = [
    { machineIds: [], availability: Array<boolean>(dayCount).fill(true) },
  ];
  for (const list of lists) {
    const next: Candidate[] = [];
    for (const left of combined)
      for (const right of list) {
        const availability = intersectAvailability(left.availability, right.availability);
        if (hasMinimumRun(availability, minDays, lastStartIndex))
          next.push({ machineIds: [...left.machineIds, ...right.machineIds], availability });
      }
    combined = deduplicateCandidates(next);
    if (!combined.length) break;
  }
  return combined;
}

interface CandidateContext {
  availabilityByMachine: ReadonlyMap<string, AvailabilitySet>;
  dayCount: number;
  minDays: number;
  lastStartIndex: number;
  cache: WeakMap<PlanEntry, Candidate[]>;
}

/** Recursively expands one node. OR/N-of-M nodes return every valid fixed combination. */
function candidatesOf(entry: PlanEntry, context: CandidateContext): Candidate[] {
  const cached = context.cache.get(entry);
  if (cached) return cached;
  let candidates: Candidate[];
  if (entry.kind === 'device') {
    const availability = context.availabilityByMachine.get(entry.deviceId) ?? [];
    candidates = hasMinimumRun(availability, context.minDays, context.lastStartIndex)
      ? [{ machineIds: [entry.deviceId], availability }]
      : [];
  } else {
    const members = entry.members.map((member) => candidatesOf(member, context));
    candidates = memberSelections(entry.members.length, entry.requiredCount).flatMap((selection) =>
      combineCandidateLists(
        selection.map((index) => members[index]!),
        context.dayCount,
        context.minDays,
        context.lastStartIndex,
      ),
    );
    candidates = deduplicateCandidates(candidates);
  }
  context.cache.set(entry, candidates);
  return candidates;
}

/** Resolve all top-level AND entries after recursively expanding their OR/N-of-M subtrees. */
export function buildPlanCandidates(
  plan: PlanEntry[],
  availabilityByMachine: ReadonlyMap<string, AvailabilitySet>,
  dayCount: number,
  minDays: number,
  lastStartIndex: number,
): Candidate[] {
  const context: CandidateContext = {
    availabilityByMachine,
    dayCount,
    minDays,
    lastStartIndex,
    cache: new WeakMap(),
  };
  return combineCandidateLists(
    plan.map((entry) => candidatesOf(entry, context)),
    dayCount,
    minDays,
    lastStartIndex,
  );
}
