// @vitest-environment jsdom
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssistantState } from './useAssistantState.ts';
import { normalizePlan, parseDragId, formatDate, formatDateLong, rangeLengthOf } from './model.ts';
import { pickRangeDay } from './model.ts';
import type { PlanEntry } from '../../../core/booking-assistant-types.ts';
import type { DropZone } from './model.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function setup() {
  const onSearch = vi.fn().mockReturnValue([]);
  const hook = renderHook(() =>
    useAssistantState({
      catalog: [],
      onSearch,
      onShowCalendar: vi.fn(),
      initialRange: { from: new Date(2026, 8, 7), to: new Date(2026, 8, 13) },
    }),
  );
  const add = (id: string) => act(() => hook.result.current.toggleDevice(id));
  /* Die Zone reist wie im Betrieb in der Kollision mit — `planTargets` hängt sie dort an. */
  const event = (id: string, over: string | null, zone: DropZone) => ({
    active: { id },
    over: over ? { id: over } : null,
    collisions: over ? [{ id: over, data: { zone } }] : null,
  });
  const drop = (id: string, over: string | null, zone: DropZone = 'before') =>
    act(() => hook.result.current.handleDragEnd(event(id, over, zone) as any));
  const over = (id: string, target: string | null, zone: DropZone = 'before') =>
    act(() => hook.result.current.handleDragOver(event(id, target, zone) as any));
  return { ...hook, add, drop, over, onSearch };
}
describe('supplied plan and criteria state', () => {
  it('merges center drops, edits required count, removes members and normalizes singletons', () => {
    const { result, add, drop } = setup();
    add('a');
    add('b');
    add('c');
    const [a, b, c] = result.current.plan;
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    expect(result.current.plan[0]).toEqual({
      kind: 'group',
      id: b!.id,
      deviceIds: ['b', 'a'],
      requiredCount: 1,
    });
    drop(`entry:${c!.id}`, `entry:${b!.id}`, 'merge');
    act(() => result.current.setRequiredCount(b!.id, 3));
    act(() => result.current.removeMember(b!.id, 'c'));
    expect(result.current.plan[0]).toMatchObject({ requiredCount: 2 });
    add('a');
    expect(result.current.plan).toEqual([{ kind: 'device', id: b!.id, deviceId: 'b' }]);
    act(() => result.current.removeEntry(b!.id));
    expect(result.current.plan).toEqual([]);
  });
  it('reorders into the marked gap and extracts group members into independent entries', () => {
    const { result, add, drop } = setup();
    add('a');
    add('b');
    add('c');
    const [a, b, c] = result.current.plan;
    // Die Fuge zählt in der Liste *mit* der gezogenen Karte: hinter c ist Fuge 3.
    drop(`entry:${a!.id}`, `entry:${c!.id}`, 'after');
    expect(result.current.plan.map((e) => e.id)).toEqual([b!.id, c!.id, a!.id]);
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'before');
    expect(result.current.plan.map((e) => e.id)).toEqual([a!.id, b!.id, c!.id]);
    // Die Fugen direkt über und unter der Karte sind ihr eigener Platz: nichts passiert.
    drop(`entry:${b!.id}`, `entry:${b!.id}`, 'before');
    drop(`entry:${b!.id}`, `entry:${b!.id}`, 'after');
    drop(`entry:${b!.id}`, `entry:${c!.id}`, 'before');
    expect(result.current.plan.map((e) => e.id)).toEqual([a!.id, b!.id, c!.id]);
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    drop(`member:${b!.id}:a`, `entry:${c!.id}`, 'after');
    expect(result.current.plan.map((e) => e.kind === 'device' && e.deviceId)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
  it('groups onto a card and into an existing Bedarfsgruppe, leaving no-op drops alone', () => {
    const { result, add, drop } = setup();
    ['a', 'b', 'c', 'd'].forEach(add);
    const [a, b, c, d] = result.current.plan;
    // Karte auf Karte → neue Bedarfsgruppe aus beiden.
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    expect(result.current.plan[0]).toMatchObject({ kind: 'group', deviceIds: ['b', 'a'] });
    // Karte auf eine bestehende Gruppe → das Gerät wandert hinein, die Gruppe bleibt.
    drop(`entry:${c!.id}`, `entry:${b!.id}`, 'merge');
    expect(result.current.plan[0]).toMatchObject({ deviceIds: ['b', 'a', 'c'], requiredCount: 1 });
    expect(result.current.plan.map((e) => e.id)).toEqual([b!.id, d!.id]);
    const before = result.current.plan;
    drop('unknown', `entry:${d!.id}`);
    drop(`entry:${b!.id}`, null);
    drop('entry:missing', `entry:${d!.id}`);
    drop(`entry:${b!.id}`, `entry:${b!.id}`, 'merge');
    drop(`member:${b!.id}:a`, `entry:${b!.id}`, 'merge');
    drop(`entry:${b!.id}`, 'entry:missing');
    expect(result.current.plan).toEqual(before);
    // Gruppe auf Karte → alle ihre Geräte wandern hinüber, die Gruppe verschwindet.
    drop(`entry:${b!.id}`, `entry:${d!.id}`, 'merge');
    expect(result.current.plan).toEqual([
      { kind: 'group', id: d!.id, deviceIds: ['d', 'b', 'a', 'c'], requiredCount: 1 },
    ]);
  });
  it('dissolves a group back into single cards instead of dropping its machines', () => {
    const { result, add, drop } = setup();
    ['a', 'b', 'c'].forEach(add);
    const [a, b, c] = result.current.plan;
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    expect(result.current.plan[0]).toMatchObject({ kind: 'group', deviceIds: ['b', 'a'] });
    act(() => result.current.dissolveGroup(b!.id));
    // Beide Geräte bleiben im Plan, an der Stelle der Gruppe und in ihrer Reihenfolge.
    expect(result.current.plan.map((e) => e.kind === 'device' && e.deviceId)).toEqual([
      'b',
      'a',
      'c',
    ]);
    // Einzelkarten und unbekannte IDs lässt das Auflösen unberührt.
    const before = result.current.plan;
    act(() => result.current.dissolveGroup(c!.id));
    act(() => result.current.dissolveGroup('gibtsnicht'));
    expect(result.current.plan).toEqual(before);
  });
  it('drops a member out into the free area below the cards, without aiming at a gap', () => {
    const { result, add, drop, over } = setup();
    add('a');
    add('b');
    const [a, b] = result.current.plan;
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    const group = result.current.plan[0]!;
    expect(result.current.plan).toHaveLength(1);
    // Die Gruppe ist die einzige Karte — ohne die Auffangfläche gäbe es kein Ziel.
    over(`member:${group.id}:a`, 'plan-list');
    expect(result.current.dropIndex).toBe(1);
    drop(`member:${group.id}:a`, 'plan-list');
    expect(result.current.plan).toEqual([
      { kind: 'device', id: group.id, deviceId: 'b' },
      { kind: 'device', id: expect.any(String), deviceId: 'a' },
    ]);
    // Für ganze Karten ist die Fläche schlicht die letzte Fuge: die letzte liegt schon dort.
    over(`entry:${group.id}`, 'plan-list');
    expect(result.current.dropIndex).toBe(2);
    const last = result.current.plan[1]!;
    over(`entry:${last.id}`, 'plan-list');
    expect(result.current.dropIndex).toBeNull();
    drop(`entry:${group.id}`, 'plan-list');
    expect(result.current.plan.map((e) => e.kind === 'device' && e.deviceId)).toEqual(['a', 'b']);
  });
  it('moves members between groups and back out into their own card', () => {
    const { result, add, drop } = setup();
    ['a', 'b', 'c', 'd'].forEach(add);
    const [a, b, c, d] = result.current.plan;
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    drop(`entry:${c!.id}`, `entry:${d!.id}`, 'merge');
    drop(`member:${b!.id}:a`, `entry:${d!.id}`, 'merge');
    expect(result.current.plan[1]).toMatchObject({ deviceIds: ['d', 'c', 'a'] });
    // Die Quellgruppe hatte nur noch b übrig und ist an Ort und Stelle Karte geworden.
    expect(result.current.plan[0]).toMatchObject({ kind: 'device', deviceId: 'b' });
    drop(`member:${d!.id}:a`, `entry:${b!.id}`, 'before');
    expect(result.current.plan[0]).toMatchObject({ kind: 'device', deviceId: 'a' });
  });
  it('tracks drag overlays and target highlights', () => {
    const { result, add, over } = setup();
    add('a');
    add('b');
    const [a, b] = result.current.plan;
    act(() => result.current.handleDragStart({ active: { id: `entry:${a!.id}` } } as any));
    expect(result.current.draggedEntry?.id).toBe(a!.id);
    over(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    expect(result.current.mergeTargetId).toBe(b!.id);
    expect(result.current.dropIndex).toBeNull();
    // Auf sich selbst gruppieren passiert nicht — dann auch kein Ring.
    over(`entry:${a!.id}`, `entry:${a!.id}`, 'merge');
    expect(result.current.mergeTargetId).toBeNull();
    over(`entry:${a!.id}`, null, 'merge');
    expect(result.current.mergeTargetId).toBeNull();
    act(() => result.current.cancelDrag());
    expect(result.current.draggedEntry).toBeUndefined();
  });
  it('marks the gap a drop would land in, and nothing when the card is already there', () => {
    const { result, add, drop, over } = setup();
    ['a', 'b', 'c'].forEach(add);
    const [a, b, c] = result.current.plan;
    // Ganze Karte: die Marke steht in der Fuge, in der die Karte landet …
    over(`entry:${a!.id}`, `entry:${c!.id}`, 'after');
    expect(result.current.dropIndex).toBe(3);
    expect(result.current.mergeTargetId).toBeNull();
    // … aber nicht an ihrem eigenen Platz, denn dort ändert ein Drop nichts.
    over(`entry:${a!.id}`, `entry:${a!.id}`, 'before');
    expect(result.current.dropIndex).toBeNull();
    over(`entry:${a!.id}`, `entry:${a!.id}`, 'after');
    expect(result.current.dropIndex).toBeNull();
    over(`entry:${a!.id}`, `entry:${b!.id}`, 'before');
    expect(result.current.dropIndex).toBeNull();
    // Gruppenmitglied: hier zählt jede Fuge, auch die neben der eigenen Gruppe.
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    const group = result.current.plan[0]!;
    const member = `member:${group.id}:a`;
    over(member, `entry:${c!.id}`, 'before');
    expect(result.current.dropIndex).toBe(1);
    over(member, `entry:${c!.id}`, 'after');
    expect(result.current.dropIndex).toBe(2);
    over(member, `entry:${c!.id}`, 'merge');
    expect(result.current.dropIndex).toBeNull();
    expect(result.current.mergeTargetId).toBe(c!.id);
    // Verschwundene Zielkarte: keine Marke und beim Ablegen keine Änderung.
    over(member, 'entry:weg', 'before');
    expect(result.current.dropIndex).toBeNull();
    const before = result.current.plan;
    drop(member, 'entry:weg', 'before');
    expect(result.current.plan).toEqual(before);
    expect(result.current.dropIndex).toBeNull();
  });
  it('couples min/max, retains partial ranges, applies range bounds and expires hints', () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => result.current.changeMinDays(5));
    act(() => result.current.changeMaxDays(3));
    expect(result.current.minDays).toBe(3);
    act(() => result.current.changeMinDays(6));
    expect(result.current.maxDays).toBe(6);
    act(() => result.current.applyRange({ from: new Date(2026, 8, 7), to: undefined }));
    expect(result.current.maxDays).toBe(6);
    act(() => result.current.applyRange({ from: new Date(2026, 8, 7), to: new Date(2026, 8, 8) }));
    expect(result.current.maxDays).toBe(2);
    expect(result.current.minDays).toBe(2);
    act(() => result.current.flagLimit('upper'));
    expect(result.current.limitHint?.message).toContain('2 Tage');
    act(() => vi.advanceTimersByTime(2800));
    expect(result.current.limitHint).toBeNull();
    act(() => result.current.flagLimit('lower'));
    expect(result.current.limitHint?.message).toContain('1 Tag');
  });
  it('freezes result selections and handles real search failures', () => {
    document.body.innerHTML = '<div id="toast"></div>';
    const { result, onSearch, add } = setup();
    add('a');
    onSearch.mockReturnValue([
      { id: 'one', selectedDays: 1 },
      { id: 'two', selectedDays: 1 },
    ]);
    act(() => result.current.runSearch());
    expect(onSearch.mock.calls[0]![0]).toEqual(result.current.plan);
    act(() => result.current.changeResultDays('one', 3));
    expect(result.current.results.map((w) => w.selectedDays)).toEqual([3, 1]);
    onSearch.mockImplementation(() => {
      throw new Error('Serverdaten fehlen');
    });
    act(() => result.current.runSearch());
    expect(document.getElementById('toast')!.textContent).toContain('Serverdaten fehlen');
    onSearch.mockImplementation(() => {
      throw 'Fehler';
    });
    act(() => result.current.runSearch());
    expect(document.getElementById('toast')!.textContent).toContain('Suche');
  });
  it('builds a range from two clicks and starts over on a finished one', () => {
    const empty = { from: undefined, to: undefined };
    const first = new Date(2026, 8, 10);
    const later = new Date(2026, 8, 20);
    expect(pickRangeDay(empty, first)).toEqual({ from: first, to: undefined });
    expect(pickRangeDay({ from: first, to: undefined }, later)).toEqual({ from: first, to: later });
    // Rückwärts geklickt: die beiden tauschen, statt ein negatives Fenster zu ergeben.
    expect(pickRangeDay({ from: later, to: undefined }, first)).toEqual({ from: first, to: later });
    // Derselbe Tag zweimal ist ein Ein-Tages-Fenster.
    expect(pickRangeDay({ from: first, to: undefined }, first)).toEqual({ from: first, to: first });
    // Auf einen fertigen Zeitraum folgt ein neuer Start — sonst wäre er unveränderbar.
    expect(pickRangeDay({ from: first, to: later }, later)).toEqual({ from: later, to: undefined });
  });
  it('keeps supplied date formatting and removes empty groups', () => {
    expect(formatDate()).toBe('TT.MM.JJJJ');
    expect(formatDate(new Date(2026, 8, 7))).toBe('07.09.2026');
    expect(formatDateLong(new Date(2026, 8, 7))).toContain('07.09.2026');
    expect(rangeLengthOf({ from: undefined, to: undefined })).toBe(90);
    expect(parseDragId('invalid')).toBeNull();
    expect(parseDragId('member:g:a')).toEqual({ type: 'member', entryId: 'g', deviceId: 'a' });
    expect(
      normalizePlan([{ kind: 'group', id: 'g', deviceIds: [], requiredCount: 1 }] as PlanEntry[]),
    ).toEqual([]);
  });
});
