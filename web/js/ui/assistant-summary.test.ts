import { describe, it, expect } from 'vitest';
import type { AssistContainer } from '../core/assistant.ts';
import { describeSelectionSummary } from './assistant-summary.ts';

const dev = (uid: string, id: string) => ({ uid, type: 'dev' as const, id });
const grp = (uid: string, children: AssistContainer['children']) => ({
  uid,
  type: 'grp' as const,
  need: 1,
  children,
});

describe('describeSelectionSummary', () => {
  it('reads as "Keine Auswahl" for an empty tree', () => {
    expect(describeSelectionSummary({ children: [] })).toBe('Keine Auswahl');
  });

  it('singularizes a single loose device', () => {
    expect(describeSelectionSummary({ children: [dev('a', 'A')] })).toBe('1 Einzelgerät');
  });

  it('pluralizes multiple loose devices', () => {
    expect(describeSelectionSummary({ children: [dev('a', 'A'), dev('b', 'B')] })).toBe(
      '2 Einzelgeräte',
    );
  });

  it('singularizes a single group', () => {
    expect(describeSelectionSummary({ children: [grp('g', [dev('a', 'A'), dev('b', 'B')])] })).toBe(
      '1 Bedarfsgruppe',
    );
  });

  it('combines devices and groups with the correct plural forms', () => {
    const tree: AssistContainer = {
      children: [
        dev('a', 'A'),
        dev('b', 'B'),
        dev('c', 'C'),
        grp('g', [dev('d', 'D'), dev('e', 'E')]),
      ],
    };
    expect(describeSelectionSummary(tree)).toBe('3 Einzelgeräte · 1 Bedarfsgruppe');
  });

  it('only counts TOP-LEVEL groups, not devices nested inside them', () => {
    const tree: AssistContainer = {
      children: [
        grp('g1', [dev('a', 'A'), dev('b', 'B')]),
        grp('g2', [dev('c', 'C'), dev('d', 'D')]),
      ],
    };
    expect(describeSelectionSummary(tree)).toBe('2 Bedarfsgruppen');
  });
});
