// @vitest-environment jsdom
import { act, render, renderHook, cleanup, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssistantState } from './useAssistantState.ts';
import { formatDate, formatDateLong, rangeLengthOf, pickRangeDay } from './model.ts';
import { deviceIdsOf, normalizePlan } from './plan-tree.ts';
import type { PlanEntry } from '../../../core/booking-assistant-types.ts';
import type { DropZone } from './plan-drop.ts';
import { DeviceProvider } from './DeviceProvider.tsx';
import { PlanCard } from './PlanCards.tsx';

/** Alle Geräte unter einem Eintrag, in Reihenfolge. */
const devicesOf = (entry: PlanEntry) => deviceIdsOf(entry);
/** Die ID des Mitglieds, das dieses Gerät ist. */
const memberIdOf = (entry: PlanEntry, deviceId: string): string => {
  if (entry.kind === 'device') return entry.deviceId === deviceId ? entry.id : '';
  return entry.members.map((m) => memberIdOf(m, deviceId)).find(Boolean) ?? '';
};
/** Every drag/drop identity in an entry, including the group itself. */
const entryIdsOf = (entry: PlanEntry): string[] =>
  entry.kind === 'group' ? [entry.id, ...entry.members.flatMap(entryIdsOf)] : [entry.id];

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
  const dropId = (id: string) => (id === 'plan-list' ? id : `entry:${id}`);
  const event = (id: string, over: string | null, zone: DropZone) => ({
    active: { id: `entry:${id}` },
    over: over ? { id: dropId(over) } : null,
    collisions: over ? [{ id: dropId(over), data: { zone } }] : null,
  });
  const drop = (id: string, over: string | null, zone: DropZone = 'before') =>
    act(() => hook.result.current.handleDragEnd(event(id, over, zone) as any));
  const over = (id: string, target: string | null, zone: DropZone = 'before') =>
    act(() => hook.result.current.handleDragOver(event(id, target, zone) as any));
  return { ...hook, add, drop, over, onSearch };
}
describe('supplied plan and criteria state', () => {
  it('numbers a top-level group beside its dissolve action, without numbering its members', () => {
    const group: PlanEntry = {
      kind: 'group',
      id: 'group',
      requiredCount: 1,
      members: [
        { kind: 'device', id: 'first', deviceId: 'a' },
        { kind: 'device', id: 'second', deviceId: 'b' },
      ],
    };
    render(
      <DeviceProvider
        catalog={[
          {
            id: 'machines',
            label: 'Maschinen',
            devices: [
              { id: 'a', name: 'A', code: 'A', lab: 'Halle' },
              { id: 'b', name: 'B', code: 'B', lab: 'Halle' },
            ],
          },
        ]}
      >
        <DndContext>
          <ul>
            <PlanCard
              entry={group}
              position="03"
              onRemoveEntry={vi.fn()}
              onDissolveGroup={vi.fn()}
              onRequiredCountChange={vi.fn()}
            />
          </ul>
        </DndContext>
      </DeviceProvider>,
    );
    const position = screen.getByLabelText('Position 03');
    expect(position.nextElementSibling).toBe(
      screen.getByRole('button', { name: 'Bedarfsgruppe auflösen' }),
    );
    expect(screen.getAllByLabelText(/^Position/)).toHaveLength(1);
  });

  it('groups two cards, edits the count, removes a member and collapses the leftover', () => {
    const { result, add, drop } = setup();
    ['a', 'b', 'c'].forEach(add);
    const [a, b, c] = result.current.plan;
    drop(a!.id, b!.id, 'merge');
    const group = result.current.plan[0]!;
    expect(group).toMatchObject({ kind: 'group', requiredCount: 1 });
    // The group and its members must register as distinct dnd-kit targets. Reusing the
    // target device ID for the wrapper renders two drop markers and leaves a stale target
    // behind when the wrapper is dissolved.
    expect(new Set(entryIdsOf(group)).size).toBe(entryIdsOf(group).length);
    expect(memberIdOf(group, 'b')).toBe(b!.id);
    expect(devicesOf(group)).toEqual(['b', 'a']);
    drop(c!.id, group.id, 'merge');
    act(() => result.current.setRequiredCount(group.id, 3));
    expect(result.current.plan[0]).toMatchObject({ requiredCount: 3 });
    // Ein Mitglied ist ein Eintrag wie jeder andere: dieselbe Aktion nimmt es heraus.
    act(() => result.current.removeEntry(memberIdOf(result.current.plan[0]!, 'c')));
    expect(result.current.plan[0]).toMatchObject({ requiredCount: 2 });
    // Das Häkchen im Katalog findet das Gerät auch tief in einer Gruppe.
    add('a');
    expect(result.current.plan).toEqual([
      { kind: 'device', id: expect.any(String), deviceId: 'b' },
    ]);
    act(() => result.current.removeEntry(result.current.plan[0]!.id));
    expect(result.current.plan).toEqual([]);
  });
  it('nests a group inside a group and refuses to swallow itself', () => {
    const { result, add, drop, over } = setup();
    ['a', 'b', 'c', 'd'].forEach(add);
    const [a, b, c, d] = result.current.plan;
    drop(a!.id, b!.id, 'merge');
    drop(c!.id, d!.id, 'merge');
    const [outer, inner] = result.current.plan.map((entry) => entry.id);
    // Gruppe auf Gruppe: die gezogene wird Mitglied, statt sich in ihr aufzulösen.
    drop(inner!, outer!, 'merge');
    expect(result.current.plan).toHaveLength(1);
    const nested = result.current.plan[0]!;
    expect(nested).toMatchObject({ kind: 'group', requiredCount: 1 });
    expect(nested.kind === 'group' && nested.members.map((m) => m.kind)).toEqual([
      'device',
      'device',
      'group',
    ]);
    expect(devicesOf(nested)).toEqual(['b', 'a', 'd', 'c']);
    // Eine Gruppe kann weder in sich selbst noch in ihre eigene Untergruppe wandern.
    const before = result.current.plan;
    over(nested.id, nested.id, 'merge');
    expect(result.current.preview).toBeNull();
    over(nested.id, inner!, 'merge');
    expect(result.current.preview).toBeNull();
    drop(nested.id, inner!, 'merge');
    drop(nested.id, nested.id, 'merge');
    expect(result.current.plan).toEqual(before);
    // Die Untergruppe lässt sich wieder herausziehen.
    drop(inner!, nested.id, 'after');
    expect(result.current.plan.map((e) => e.id)).toEqual([nested.id, inner!]);
  });
  it('dissolves a group in place, at any depth, keeping its machines', () => {
    const { result, add, drop } = setup();
    ['a', 'b', 'c', 'd'].forEach(add);
    const [a, b, c, d] = result.current.plan;
    drop(a!.id, b!.id, 'merge');
    drop(c!.id, d!.id, 'merge');
    const [outer, inner] = result.current.plan.map((entry) => entry.id);
    drop(inner!, outer!, 'merge');
    // Die innere Gruppe auflösen: ihre Geräte bleiben Mitglieder der äußeren.
    act(() => result.current.dissolveGroup(inner!));
    const group = result.current.plan[0]!;
    expect(group.kind === 'group' && group.members.every((m) => m.kind === 'device')).toBe(true);
    expect(devicesOf(group)).toEqual(['b', 'a', 'd', 'c']);
    // Die äußere auflösen: vier einzelne Karten, in derselben Reihenfolge.
    act(() => result.current.dissolveGroup(group.id));
    expect(result.current.plan.map((e) => e.kind === 'device' && e.deviceId)).toEqual([
      'b',
      'a',
      'd',
      'c',
    ]);
  });
  it('reorders into the marked gap and lifts a member out into its own card', () => {
    const { result, add, drop } = setup();
    ['a', 'b', 'c'].forEach(add);
    const [a, b, c] = result.current.plan;
    drop(a!.id, c!.id, 'after');
    expect(result.current.plan.map((e) => e.id)).toEqual([b!.id, c!.id, a!.id]);
    drop(a!.id, b!.id, 'before');
    expect(result.current.plan.map((e) => e.id)).toEqual([a!.id, b!.id, c!.id]);
    // Die Fugen unmittelbar vor und hinter der Karte sind ihr eigener Platz.
    drop(b!.id, b!.id, 'before');
    drop(b!.id, b!.id, 'after');
    drop(b!.id, c!.id, 'before');
    expect(result.current.plan.map((e) => e.id)).toEqual([a!.id, b!.id, c!.id]);
    drop(a!.id, b!.id, 'merge');
    const group = result.current.plan[0]!;
    drop(memberIdOf(group, 'a'), c!.id, 'after');
    expect(result.current.plan.map((e) => e.kind === 'device' && e.deviceId)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
  it('drops a member out into the free area below the cards, without aiming at a gap', () => {
    const { result, add, drop, over } = setup();
    add('a');
    add('b');
    const [a, b] = result.current.plan;
    drop(a!.id, b!.id, 'merge');
    const group = result.current.plan[0]!;
    expect(result.current.plan).toHaveLength(1);
    // Die Gruppe ist die einzige Karte — ohne die Auffangfläche gäbe es kein Ziel.
    const member = memberIdOf(group, 'a');
    over(member, 'plan-list');
    expect(result.current.preview).toEqual({ kind: 'append' });
    drop(member, 'plan-list');
    expect(result.current.plan.map((e) => e.kind === 'device' && e.deviceId)).toEqual(['b', 'a']);
    // Für ganze Karten ist die Fläche die letzte Fuge: die letzte liegt schon dort.
    over(result.current.plan[1]!.id, 'plan-list');
    expect(result.current.preview).toBeNull();
    drop(result.current.plan[0]!.id, 'plan-list');
    expect(result.current.plan.map((e) => e.kind === 'device' && e.deviceId)).toEqual(['a', 'b']);
  });
  it('moves a member straight into another group', () => {
    const { result, add, drop } = setup();
    ['a', 'b', 'c', 'd'].forEach(add);
    const [a, b, c, d] = result.current.plan;
    drop(a!.id, b!.id, 'merge');
    drop(c!.id, d!.id, 'merge');
    const [first, second] = result.current.plan;
    drop(memberIdOf(first!, 'a'), second!.id, 'merge');
    expect(devicesOf(result.current.plan[1]!)).toEqual(['d', 'c', 'a']);
    // Die Quellgruppe hatte nur noch b übrig und ist an Ort und Stelle Karte geworden.
    expect(result.current.plan[0]).toMatchObject({ kind: 'device', deviceId: 'b' });
  });
  it('tracks the dragged entry and the two announcements a drop can make', () => {
    const { result, add, over, drop } = setup();
    add('a');
    add('b');
    const [a, b] = result.current.plan;
    act(() => result.current.handleDragStart({ active: { id: `entry:${a!.id}` } } as any));
    expect(result.current.draggedEntry?.id).toBe(a!.id);
    over(a!.id, b!.id, 'merge');
    expect(result.current.mergeTargetId).toBe(b!.id);
    over(a!.id, b!.id, 'after');
    expect(result.current.preview).toEqual({ kind: 'insert', targetId: b!.id, side: 'after' });
    expect(result.current.mergeTargetId).toBeNull();
    // Auf sich selbst gruppieren passiert nicht — dann auch kein Ring.
    over(a!.id, a!.id, 'merge');
    expect(result.current.preview).toBeNull();
    over(a!.id, null, 'merge');
    expect(result.current.preview).toBeNull();
    // Ein verschwundenes Ziel meldet nichts und ändert beim Ablegen nichts.
    over(a!.id, 'weg', 'before');
    expect(result.current.preview).toBeNull();
    const before = result.current.plan;
    drop(a!.id, 'weg', 'before');
    expect(result.current.plan).toEqual(before);
    act(() => result.current.cancelDrag());
    expect(result.current.draggedEntry).toBeUndefined();
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
    // Eine Gruppe ohne Mitglieder verschwindet, eine mit einem einzigen wird zu diesem.
    expect(normalizePlan([{ kind: 'group', id: 'g', members: [], requiredCount: 1 }])).toEqual([]);
    const only: PlanEntry = { kind: 'device', id: 'x', deviceId: 'a' };
    expect(normalizePlan([{ kind: 'group', id: 'g', members: [only], requiredCount: 1 }])).toEqual([
      only,
    ]);
  });
});
