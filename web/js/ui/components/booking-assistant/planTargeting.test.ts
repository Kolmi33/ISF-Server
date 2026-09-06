import { describe, expect, it } from 'vitest';
import { planSorting, planTargets, zoneOf } from './planTargeting.ts';

const rect = (top: number, height: number) => ({
  top,
  bottom: top + height,
  left: 0,
  right: 200,
  width: 200,
  height,
});
/* Zwei 100px hohe Karten, lückenlos untereinander, dazu die Liste als umschließendes
   Rechteck — genau die Überlappung, an der `over` früher aus der Sortierung fiel. */
const droppableRects = new Map([
  ['entry:one', rect(0, 100)],
  ['entry:two', rect(100, 100)],
  ['plan-list', rect(0, 200)],
]);
const targetsAt = (y: number) =>
  planTargets({
    droppableContainers: [...droppableRects.keys()].map((id) => ({ id })),
    droppableRects,
    pointerCoordinates: { x: 100, y },
  } as unknown as Parameters<typeof planTargets>[0]);

describe('plan drag targeting', () => {
  it('hits exactly one card and reads the zone from the pointer height in it', () => {
    expect(targetsAt(10).map((c) => [c.id, c.data?.['zone']])).toEqual([['entry:one', 'before']]);
    expect(targetsAt(50).map((c) => [c.id, c.data?.['zone']])).toEqual([['entry:one', 'merge']]);
    expect(targetsAt(90).map((c) => [c.id, c.data?.['zone']])).toEqual([['entry:one', 'after']]);
    expect(targetsAt(150).map((c) => [c.id, c.data?.['zone']])).toEqual([['entry:two', 'merge']]);
  });
  it('never targets the surrounding list, and nothing at all outside the cards', () => {
    // Der Zeiger steht auch in `plan-list` — trotzdem gewinnt die Karte, sonst wäre
    // `over` kein Sortable-Eintrag und die Liste spränge.
    expect(targetsAt(150).every((c) => c.id !== 'plan-list')).toBe(true);
    expect(targetsAt(500)).toEqual([]);
  });
  it('falls back to grouping when the zone is missing or unknown', () => {
    expect(zoneOf(null)).toBe('merge');
    expect(zoneOf([])).toBe('merge');
    expect(zoneOf([{ id: 'entry:one' }])).toBe('merge');
    expect(zoneOf([{ id: 'entry:one', data: { zone: 'quatsch' } }])).toBe('merge');
    expect(zoneOf([{ id: 'entry:one', data: { zone: 'after' } }])).toBe('after');
  });
  it('keeps the list still while grouping and whenever no card is targeted', () => {
    const args = {
      activeIndex: 0,
      index: 1,
      overIndex: 1,
      rects: [rect(0, 100), rect(100, 100)],
      activeNodeRect: rect(0, 100),
    };
    // Umsortieren: die Karte darunter rückt um eine Kartenhöhe nach oben.
    expect(planSorting(false)(args)).toMatchObject({ y: -100 });
    // Gruppieren braucht keinen Platz.
    expect(planSorting(true)(args)).toBeNull();
    // Kein Ziel: `verticalListSortingStrategy` würde `-1` wörtlich nehmen und jede Karte
    // oberhalb der gezogenen um eine volle Höhe nach unten schieben.
    expect(planSorting(false)({ ...args, overIndex: -1 })).toBeNull();
  });
});
