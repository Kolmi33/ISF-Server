// @vitest-environment jsdom
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssistantState } from './useAssistantState.ts';
import { normalizePlan, parseDragId, formatDate, formatDateLong, rangeLengthOf } from './model.ts';
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
  it('reorders onto the target slot and extracts group members into independent entries', () => {
    const { result, add, drop } = setup();
    add('a');
    add('b');
    add('c');
    const [a, b, c] = result.current.plan;
    // Umsortieren nimmt den Platz der Zielkarte ein — genau die Lücke, die die Liste zeigt.
    drop(`entry:${a!.id}`, `entry:${c!.id}`, 'after');
    expect(result.current.plan.map((e) => e.id)).toEqual([b!.id, c!.id, a!.id]);
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    drop(`member:${b!.id}:a`, `entry:${c!.id}`, 'after');
    expect(result.current.plan.map((e) => e.kind === 'device' && e.deviceId)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
  it('moves members between groups and leaves self/cancel/unknown drops unchanged', () => {
    const { result, add, drop } = setup();
    ['a', 'b', 'c', 'd'].forEach(add);
    const [a, b, c, d] = result.current.plan;
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    drop(`entry:${c!.id}`, `entry:${d!.id}`, 'merge');
    const before = result.current.plan;
    drop('unknown', `entry:${d!.id}`);
    drop(`entry:${b!.id}`, null);
    drop('entry:missing', `entry:${d!.id}`);
    drop(`entry:${b!.id}`, `entry:${b!.id}`);
    drop(`entry:${b!.id}`, `entry:${b!.id}`, 'merge');
    drop(`member:${b!.id}:a`, `entry:${b!.id}`, 'merge');
    drop(`entry:${b!.id}`, 'entry:missing');
    expect(result.current.plan).toEqual(before);
    drop(`member:${b!.id}:a`, `entry:${d!.id}`, 'merge');
    expect(result.current.plan[1]).toMatchObject({ deviceIds: ['d', 'c', 'a'] });
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
    // Auf sich selbst gruppieren passiert nicht — dann auch kein Ring.
    over(`entry:${a!.id}`, `entry:${a!.id}`, 'merge');
    expect(result.current.mergeTargetId).toBeNull();
    over(`entry:${a!.id}`, `entry:${b!.id}`, 'before');
    expect(result.current.mergeTargetId).toBeNull();
    over(`entry:${a!.id}`, null, 'merge');
    expect(result.current.mergeTargetId).toBeNull();
    act(() => result.current.cancelDrag());
    expect(result.current.draggedEntry).toBeUndefined();
  });
  it('marks the slot a group member would drop into, but not while whole cards move', () => {
    const { result, add, drop, over } = setup();
    ['a', 'b', 'c'].forEach(add);
    const [a, b, c] = result.current.plan;
    drop(`entry:${a!.id}`, `entry:${b!.id}`, 'merge');
    const group = result.current.plan[0]!;
    const member = `member:${group.id}:a`;
    over(member, `entry:${c!.id}`, 'before');
    expect(result.current.dropIndex).toBe(1);
    // Hinter der letzten Karte: die Marke sitzt an deren Unterkante.
    over(member, `entry:${c!.id}`, 'after');
    expect(result.current.dropIndex).toBe(2);
    // Gruppieren statt einfügen — dafür steht der Ring, keine Linie.
    over(member, `entry:${c!.id}`, 'merge');
    expect(result.current.dropIndex).toBeNull();
    expect(result.current.mergeTargetId).toBe(c!.id);
    // Verschwundene Zielkarte: keine Linie, der Drop hängt das Gerät hinten an.
    over(member, 'entry:weg', 'before');
    expect(result.current.dropIndex).toBeNull();
    // Ganze Karten zeigen keine Linie, die Lücke der Liste sagt es schon.
    over(`entry:${c!.id}`, `entry:${group.id}`, 'before');
    expect(result.current.dropIndex).toBeNull();
    drop(member, 'entry:weg', 'before');
    expect(result.current.plan.map((e) => e.kind === 'device' && e.deviceId)).toEqual([
      'b',
      'c',
      'a',
    ]);
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
