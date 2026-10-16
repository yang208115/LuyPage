import { describe, expect, it } from 'vitest';
import { AppError, DEFAULT_PREFERENCES, MAX_LAYOUT_OPERATIONS, type LayoutIndex, type LayoutOperation, type LayoutPreferences } from '@luypage/contracts';
import { applyLayoutOperations } from './index';

function fixture(): LayoutIndex {
  return {
    revision: 17,
    groupOrder: ['work', 'read', 'empty'],
    groups: [
      { groupId: 'work', bookmarkIds: ['a', 'b', 'hidden-1', 'hidden-2', 'c'] },
      { groupId: 'read', bookmarkIds: ['d', 'e'] },
      { groupId: 'empty', bookmarkIds: [] },
      { groupId: null, bookmarkIds: ['u'] },
    ],
    pinnedOrder: ['a', 'd'],
    preferences: { ...DEFAULT_PREFERENCES, collapsedGroupIds: ['read'] },
  };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function ids(index: LayoutIndex, groupId: string | null): string[] {
  return index.groups.find((group) => group.groupId === groupId)!.bookmarkIds;
}

function expectLayoutError(action: () => unknown): void {
  expect(action).toThrow(AppError);
  expect(action).toThrow(expect.objectContaining({ code: 'INVALID_LAYOUT', status: 422 }));
}

describe('applyLayoutOperations', () => {
  it('returns a detached snapshot with unchanged revision and independently copied preferences', () => {
    const index = freezeDeep(fixture());
    const preferences = freezeDeep({ ...DEFAULT_PREFERENCES, collapsedGroupIds: ['work'] });
    const result = applyLayoutOperations(index, [], preferences);
    expect(result.revision).toBe(17);
    expect(result.preferences).toEqual(preferences);
    result.groups[0]!.bookmarkIds.push('new');
    result.groupOrder.reverse();
    result.pinnedOrder.reverse();
    result.preferences.collapsedGroupIds.push('read');
    expect(index).toEqual(fixture());
    expect(preferences.collapsedGroupIds).toEqual(['work']);
  });

  it('applies repeated cross-group moves and later anchors against the current draft', () => {
    const index = freezeDeep(fixture());
    const operations: LayoutOperation[] = freezeDeep([
      { type: 'bookmark', id: 'a', groupId: 'read', placement: { afterId: 'd' } },
      { type: 'bookmark', id: 'b', groupId: 'read', placement: { beforeId: 'a' } },
      { type: 'bookmark', id: 'a', groupId: 'empty', placement: { edge: 'start' } },
      { type: 'bookmark', id: 'a', groupId: null, placement: { beforeId: 'u' } },
      { type: 'bookmark', id: 'b', groupId: 'work', placement: { afterId: 'hidden-1' } },
      { type: 'bookmark', id: 'a', groupId: 'read', placement: { afterId: 'e' } },
    ]);
    const result = applyLayoutOperations(index, operations, index.preferences);
    expect(ids(result, 'work')).toEqual(['hidden-1', 'b', 'hidden-2', 'c']);
    expect(ids(result, 'read')).toEqual(['d', 'e', 'a']);
    expect(ids(result, 'empty')).toEqual([]);
    expect(ids(result, null)).toEqual(['u']);
    expect(result.pinnedOrder).toEqual(['a', 'd']);
    expect(index).toEqual(fixture());
  });

  it('uses the full index for anchors and end placement even when only part of a page is visible', () => {
    const index = fixture();
    const result = applyLayoutOperations(index, [
      { type: 'bookmark', id: 'a', groupId: 'work', placement: { afterId: 'hidden-1' } },
      { type: 'bookmark', id: 'b', groupId: 'work', placement: { edge: 'end' } },
      { type: 'bookmark', id: 'c', groupId: 'work', placement: { beforeId: 'hidden-2' } },
    ], index.preferences);
    expect(ids(result, 'work')).toEqual(['hidden-1', 'a', 'c', 'hidden-2', 'b']);
    expect(result.groups.flatMap((group) => group.bookmarkIds).sort())
      .toEqual(index.groups.flatMap((group) => group.bookmarkIds).sort());
  });

  it('accepts empty and collapsed target groups and moving back into ungrouped', () => {
    const index = fixture();
    const result = applyLayoutOperations(index, [
      { type: 'bookmark', id: 'u', groupId: 'empty', placement: { edge: 'end' } },
      { type: 'bookmark', id: 'a', groupId: 'read', placement: { edge: 'start' } },
      { type: 'bookmark', id: 'b', groupId: null, placement: { edge: 'end' } },
    ], index.preferences);
    expect(ids(result, 'empty')).toEqual(['u']);
    expect(ids(result, 'read')).toEqual(['a', 'd', 'e']);
    expect(ids(result, null)).toEqual(['b']);
    expect(result.preferences.collapsedGroupIds).toEqual(['read']);
  });

  it('sorts user groups and shortcuts independently, keeping the system areas fixed', () => {
    const index = fixture();
    const result = applyLayoutOperations(index, [
      { type: 'group', id: 'empty', placement: { edge: 'start' } },
      { type: 'group', id: 'work', placement: { afterId: 'read' } },
      { type: 'pinned', id: 'd', placement: { beforeId: 'a' } },
    ], index.preferences);
    expect(result.groupOrder).toEqual(['empty', 'read', 'work']);
    expect(result.groups.map((group) => group.groupId)).toEqual(['empty', 'read', 'work', null]);
    expect(result.pinnedOrder).toEqual(['d', 'a']);
    for (const group of index.groups) expect(ids(result, group.groupId)).toEqual(group.bookmarkIds);
  });

  it.each<LayoutOperation>([
    { type: 'bookmark', id: 'missing', groupId: 'work', placement: { edge: 'start' } },
    { type: 'bookmark', id: 'a', groupId: 'missing', placement: { edge: 'end' } },
    { type: 'bookmark', id: 'a', groupId: 'read', placement: { beforeId: 'b' } },
    { type: 'bookmark', id: 'a', groupId: 'read', placement: { afterId: 'missing' } },
    { type: 'bookmark', id: 'a', groupId: 'work', placement: { beforeId: 'a' } },
    { type: 'group', id: 'ungrouped', placement: { edge: 'start' } },
    { type: 'group', id: 'pinned', placement: { edge: 'end' } },
    { type: 'group', id: 'work', placement: { beforeId: 'ungrouped' } },
    { type: 'group', id: 'work', placement: { afterId: 'work' } },
    { type: 'pinned', id: 'b', placement: { edge: 'start' } },
    { type: 'pinned', id: 'a', placement: { beforeId: 'b' } },
    { type: 'pinned', id: 'a', placement: { afterId: 'a' } },
  ])('rejects an invalid action without changing any input: %j', (operation) => {
    const index = freezeDeep(fixture());
    expectLayoutError(() => applyLayoutOperations(index, [operation], index.preferences));
    expect(index).toEqual(fixture());
  });

  it('rejects an anchor moved out of the target by a preceding action, without leaking earlier changes', () => {
    const index = freezeDeep(fixture());
    const preferences = freezeDeep({ ...DEFAULT_PREFERENCES, density: 'compact' as const, collapsedGroupIds: [] });
    const operations: LayoutOperation[] = freezeDeep([
      { type: 'group', id: 'read', placement: { edge: 'start' } },
      { type: 'pinned', id: 'd', placement: { edge: 'start' } },
      { type: 'bookmark', id: 'a', groupId: 'read', placement: { edge: 'end' } },
      { type: 'bookmark', id: 'b', groupId: 'work', placement: { beforeId: 'a' } },
    ]);
    expectLayoutError(() => applyLayoutOperations(index, operations, preferences));
    expect(index).toEqual(fixture());
    expect(preferences.density).toBe('compact');
    expect(operations).toHaveLength(4);
  });

  it.each<{ label: string; corrupt: (index: LayoutIndex) => void }>([
    { label: 'duplicate group order', corrupt: (index) => index.groupOrder.push('work') },
    { label: 'duplicate group rows', corrupt: (index) => index.groups.push({ groupId: 'work', bookmarkIds: [] }) },
    { label: 'duplicate ungrouped', corrupt: (index) => index.groups.push({ groupId: null, bookmarkIds: [] }) },
    { label: 'missing group in order', corrupt: (index) => { index.groupOrder.pop(); } },
    { label: 'missing group row', corrupt: (index) => { index.groups.splice(2, 1); } },
    { label: 'missing ungrouped', corrupt: (index) => { index.groups.pop(); } },
    { label: 'duplicate bookmark in group', corrupt: (index) => index.groups[0]!.bookmarkIds.push('a') },
    { label: 'bookmark in two groups', corrupt: (index) => index.groups[1]!.bookmarkIds.push('a') },
    { label: 'duplicate shortcut', corrupt: (index) => index.pinnedOrder.push('a') },
    { label: 'orphan shortcut', corrupt: (index) => index.pinnedOrder.push('missing') },
    { label: 'stale collapsed group', corrupt: (index) => index.preferences.collapsedGroupIds.push('missing') },
  ])('rejects corrupt index: $label', ({ corrupt }) => {
    const index = fixture();
    corrupt(index);
    const before = structuredClone(index);
    freezeDeep(index);
    expectLayoutError(() => applyLayoutOperations(index, [], DEFAULT_PREFERENCES));
    expect(index).toEqual(before);
  });

  it('rejects malformed runtime inputs and preferences as AppError', () => {
    const index = fixture();
    for (const operation of [
      { type: 'other', id: 'a', placement: { edge: 'end' } },
      { type: 'group', id: null, placement: { edge: 'end' } },
      { type: 'group', id: 'work', placement: { beforeId: 'read', edge: 'end' } },
      { type: 'bookmark', id: 'a', placement: { edge: 'end' } },
    ]) expectLayoutError(() => applyLayoutOperations(index, [operation] as LayoutOperation[], index.preferences));
    for (const preferences of [
      { ...DEFAULT_PREFERENCES, desktopColumns: 8 },
      { ...DEFAULT_PREFERENCES, collapsedGroupIds: ['read', 'read'] },
      { ...DEFAULT_PREFERENCES, collapsedGroupIds: ['missing'] },
      { ...DEFAULT_PREFERENCES, autoIcons: 'true' },
    ]) expectLayoutError(() => applyLayoutOperations(index, [], preferences as LayoutPreferences));
    expectLayoutError(() => applyLayoutOperations(null as unknown as LayoutIndex, [], DEFAULT_PREFERENCES));
  });

  it('enforces the shared action limit even when callers bypass the API schema', () => {
    const index = fixture();
    const operation: LayoutOperation = { type: 'group', id: 'work', placement: { edge: 'end' } };
    const operations = Array.from({ length: MAX_LAYOUT_OPERATIONS + 1 }, () => operation);
    expectLayoutError(() => applyLayoutOperations(index, operations, index.preferences));
    expect(index).toEqual(fixture());
  });

  it('handles a 5,000-bookmark full index without losing unseen members', () => {
    const bookmarks = Array.from({ length: 5_000 }, (_, i) => `b-${i}`);
    const index: LayoutIndex = {
      revision: 0, groupOrder: ['g'], groups: [
        { groupId: 'g', bookmarkIds: bookmarks }, { groupId: null, bookmarkIds: [] },
      ], pinnedOrder: ['b-0', 'b-4999'], preferences: DEFAULT_PREFERENCES,
    };
    const result = applyLayoutOperations(index, [
      { type: 'bookmark', id: 'b-0', groupId: 'g', placement: { afterId: 'b-4998' } },
      { type: 'bookmark', id: 'b-4999', groupId: null, placement: { edge: 'end' } },
    ], DEFAULT_PREFERENCES);
    expect(ids(result, 'g')).toEqual([...bookmarks.slice(1, -1), 'b-0']);
    expect(ids(result, null)).toEqual(['b-4999']);
    expect(result.pinnedOrder).toEqual(index.pinnedOrder);
    expect(bookmarks[0]).toBe('b-0');
  });

  it('accepts an empty workspace and does not reinterpret reset or creation order', () => {
    const index: LayoutIndex = { revision: 0, groupOrder: [], groups: [{ groupId: null, bookmarkIds: [] }], pinnedOrder: [], preferences: DEFAULT_PREFERENCES };
    expect(applyLayoutOperations(index, [], DEFAULT_PREFERENCES)).toEqual(index);
    expect(applyLayoutOperations(fixture(), [], DEFAULT_PREFERENCES).groupOrder).toEqual(fixture().groupOrder);
  });
});
