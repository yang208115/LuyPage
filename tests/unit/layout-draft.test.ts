import { describe, expect, it } from 'vitest';
import {
  AppError, DEFAULT_PREFERENCES, MAX_LAYOUT_OPERATIONS, layoutSaveSchema,
  type LayoutIndex, type LayoutOperation,
} from '@luypage/contracts';
import { applyLayoutOperations } from '@luypage/domain';
import {
  beginLayout, layoutChanged, moveInDraft, preferencesInDraft,
  relativePlacement, type LayoutDraft,
} from '../../apps/web/src/layout';

const operationId = 'a461ff14-c0bc-49c9-aa32-8aa78f3c3a40';

function fixture(): LayoutIndex {
  return {
    revision: 19,
    groupOrder: ['work', 'read', 'empty'],
    groups: [
      { groupId: 'work', bookmarkIds: ['a', 'hidden-1', 'b', 'hidden-2', 'c'] },
      { groupId: 'read', bookmarkIds: ['d', 'hidden-3', 'e'] },
      { groupId: 'empty', bookmarkIds: [] },
      { groupId: null, bookmarkIds: ['u'] },
    ],
    pinnedOrder: ['a', 'hidden-3', 'e'],
    preferences: { ...DEFAULT_PREFERENCES, collapsedGroupIds: ['read'] },
  };
}

// BookmarkBoard renders groupOrder, then looks up buckets by ID. Bucket storage order is not UI order.
function visibleLayout(index: LayoutIndex): LayoutIndex {
  return {
    ...index,
    groups: [...index.groupOrder, null].map(groupId => index.groups.find(group => group.groupId === groupId)!),
  };
}

function request(draft: LayoutDraft) {
  return {
    operationId, baseRevision: draft.base.revision,
    operations: draft.operations, preferences: draft.index.preferences, reset: draft.reset,
  };
}

function replay(draft: LayoutDraft): LayoutIndex {
  const input = layoutSaveSchema.parse(request(draft));
  expect(input.reset).toBe(false);
  return applyLayoutOperations(draft.base, input.operations, input.preferences);
}

function expectReplayMatches(draft: LayoutDraft): void {
  expect(visibleLayout(replay(draft))).toEqual(visibleLayout(draft.index));
}

function ids(index: LayoutIndex, groupId: string | null): string[] {
  return index.groups.find(group => group.groupId === groupId)!.bookmarkIds;
}

describe('client layout draft / server domain contract', () => {
  it('starts with detached base/index snapshots and saves preference-only changes exactly', () => {
    const source = fixture();
    const before = structuredClone(source);
    const initial = beginLayout(source);
    expect(layoutChanged(initial)).toBe(false);
    expect(initial.base).not.toBe(source);
    expect(initial.index).not.toBe(initial.base);
    const draft = preferencesInDraft(initial, { desktopColumns: 6, mobileColumns: 3, density: 'compact', collapsedGroupIds: ['work'] });
    expect(layoutChanged(draft)).toBe(true);
    expectReplayMatches(draft);
    expect(source).toEqual(before);
    expect(initial.index).toEqual(before);
    expect(draft.base).toEqual(before);
  });

  it('replays every accepted single move, including unrendered anchors and system-area boundaries', () => {
    const base = fixture();
    const moves: LayoutOperation[] = [];
    for (const source of base.groups.flatMap(group => group.bookmarkIds)) {
      for (const target of base.groups) {
        for (const edge of ['start', 'end'] as const) moves.push({ type: 'bookmark', id: source, groupId: target.groupId, placement: { edge } });
        for (const anchor of target.bookmarkIds.filter(id => id !== source)) {
          moves.push({ type: 'bookmark', id: source, groupId: target.groupId, placement: { beforeId: anchor } });
          moves.push({ type: 'bookmark', id: source, groupId: target.groupId, placement: { afterId: anchor } });
        }
      }
    }
    for (const type of ['group', 'pinned'] as const) {
      const collection = type === 'group' ? base.groupOrder : base.pinnedOrder;
      for (const id of collection) {
        for (const edge of ['start', 'end'] as const) moves.push({ type, id, placement: { edge } });
        for (const anchor of collection.filter(candidate => candidate !== id)) {
          moves.push({ type, id, placement: { beforeId: anchor } });
          moves.push({ type, id, placement: { afterId: anchor } });
        }
      }
    }
    expect(moves.length).toBeGreaterThan(200);
    for (const operation of moves) {
      const draft = moveInDraft(beginLayout(base), operation);
      expectReplayMatches(draft);
      // A client may omit a no-op; replaying the actual gesture must still yield the same layout.
      expect(visibleLayout(applyLayoutOperations(base, [operation], base.preferences))).toEqual(visibleLayout(draft.index));
    }
    expect(base).toEqual(fixture());
  });

  it('matches after every step of a repeated cross-group sequence with changing anchors', () => {
    const base = fixture();
    let draft = beginLayout(base);
    const moves: LayoutOperation[] = [
      { type: 'bookmark', id: 'a', groupId: 'read', placement: { afterId: 'hidden-3' } },
      { type: 'bookmark', id: 'b', groupId: 'read', placement: { beforeId: 'a' } },
      { type: 'bookmark', id: 'a', groupId: 'empty', placement: { edge: 'end' } },
      { type: 'bookmark', id: 'a', groupId: null, placement: { beforeId: 'u' } },
      { type: 'bookmark', id: 'b', groupId: 'work', placement: { afterId: 'hidden-1' } },
      { type: 'group', id: 'empty', placement: { beforeId: 'work' } },
      { type: 'pinned', id: 'hidden-3', placement: { afterId: 'e' } },
      { type: 'bookmark', id: 'a', groupId: 'read', placement: { afterId: 'e' } },
    ];
    for (const move of moves) {
      const previous = structuredClone(draft);
      const next = moveInDraft(draft, move);
      expect(draft).toEqual(previous);
      expectReplayMatches(next);
      draft = next;
    }
    expect(ids(draft.index, 'work')).toEqual(['hidden-1', 'b', 'hidden-2', 'c']);
    expect(ids(draft.index, 'read')).toEqual(['d', 'hidden-3', 'e', 'a']);
    expect(draft.index.pinnedOrder).toEqual(['a', 'e', 'hidden-3']);
    expect(base).toEqual(fixture());
  });

  it('uses full-index neighbors for keyboard moves even when card details are not loaded', () => {
    const base = fixture();
    const loadedIds = new Set(['a', 'b', 'd']);
    const placement = relativePlacement(ids(base, 'work'), 'a', 'next');
    expect(placement).toEqual({ afterId: 'hidden-1' });
    expect(loadedIds.has('hidden-1')).toBe(false);
    const draft = moveInDraft(beginLayout(base), { type: 'bookmark', id: 'a', groupId: 'work', placement: placement! });
    expectReplayMatches(draft);
    expect(ids(draft.index, 'work')).toEqual(['hidden-1', 'a', 'b', 'hidden-2', 'c']);
    const end = moveInDraft(draft, { type: 'bookmark', id: 'a', groupId: 'work', placement: { edge: 'end' } });
    expectReplayMatches(end);
    expect(ids(end.index, 'work')).toEqual(['hidden-1', 'b', 'hidden-2', 'c', 'a']);
    const shortcut = relativePlacement(base.pinnedOrder, 'a', 'next');
    expect(shortcut).toEqual({ afterId: 'hidden-3' });
    expectReplayMatches(moveInDraft(end, { type: 'pinned', id: 'a', placement: shortcut! }));
  });

  it('returns no keyboard gesture at collection boundaries or for missing IDs', () => {
    for (const direction of ['previous', 'next', 'start', 'end'] as const) {
      expect(relativePlacement([], 'missing', direction)).toBeNull();
      expect(relativePlacement(['only'], 'only', direction)).toBeNull();
    }
    expect(relativePlacement(['a', 'b'], 'a', 'previous')).toBeNull();
    expect(relativePlacement(['a', 'b'], 'b', 'next')).toBeNull();
  });

  it('keeps shortcut order independent from membership and user-group ordering', () => {
    const base = fixture();
    let draft = moveInDraft(beginLayout(base), { type: 'pinned', id: 'a', placement: { edge: 'end' } });
    expect(draft.index.groups).toEqual(base.groups);
    const pinnedOrder = [...draft.index.pinnedOrder];
    draft = moveInDraft(draft, { type: 'bookmark', id: 'a', groupId: 'empty', placement: { edge: 'start' } });
    draft = moveInDraft(draft, { type: 'group', id: 'work', placement: { edge: 'end' } });
    expectReplayMatches(draft);
    expect(draft.index.pinnedOrder).toEqual(pinnedOrder);
    expect(visibleLayout(draft.index).groups.at(-1)?.groupId).toBeNull();
    expect(new Set(draft.index.groups.flatMap(group => group.bookmarkIds)).size).toBe(9);
  });

  it.each<LayoutOperation>([
    { type: 'bookmark', id: 'missing', groupId: 'work', placement: { edge: 'end' } },
    { type: 'bookmark', id: 'a', groupId: 'missing', placement: { edge: 'end' } },
    { type: 'bookmark', id: 'a', groupId: 'read', placement: { beforeId: 'b' } },
    { type: 'bookmark', id: 'a', groupId: 'work', placement: { afterId: 'missing' } },
    { type: 'bookmark', id: 'a', groupId: 'work', placement: { beforeId: 'a' } },
    { type: 'group', id: 'ungrouped', placement: { edge: 'start' } },
    { type: 'group', id: 'work', placement: { beforeId: 'pinned' } },
    { type: 'group', id: 'work', placement: { afterId: 'work' } },
    { type: 'pinned', id: 'b', placement: { edge: 'end' } },
    { type: 'pinned', id: 'a', placement: { afterId: 'b' } },
    { type: 'pinned', id: 'a', placement: { beforeId: 'a' } },
  ])('omits invalid gestures instead of creating a server-rejected draft: %j', operation => {
    const draft = beginLayout(fixture());
    const before = structuredClone(draft);
    const next = moveInDraft(draft, operation);
    expect(next).toBe(draft);
    expect(draft).toEqual(before);
    expectReplayMatches(next);
    expect(() => applyLayoutOperations(draft.base, [operation], draft.index.preferences)).toThrow(AppError);
  });

  it('ignores an anchor that a prior move removed from the target without losing prior accepted changes', () => {
    const initial = beginLayout(fixture());
    const moved = moveInDraft(initial, { type: 'bookmark', id: 'a', groupId: 'read', placement: { edge: 'end' } });
    const rejected: LayoutOperation = { type: 'bookmark', id: 'b', groupId: 'work', placement: { beforeId: 'a' } };
    expect(moveInDraft(moved, rejected)).toBe(moved);
    expectReplayMatches(moved);
    expect(() => applyLayoutOperations(initial.base, [...moved.operations, rejected], moved.index.preferences)).toThrow(AppError);
  });

  it('replays a move to the opposite edge of a 5,000-ID index without loading card details', () => {
    const base: LayoutIndex = {
      revision: 2, groupOrder: [], groups: [{ groupId: null, bookmarkIds: Array.from({ length: 5_000 }, (_, i) => `b-${i}`) }],
      pinnedOrder: [], preferences: structuredClone(DEFAULT_PREFERENCES),
    };
    const draft = moveInDraft(beginLayout(base), { type: 'bookmark', id: 'b-0', groupId: null, placement: { edge: 'end' } });
    expectReplayMatches(draft);
    expect(ids(draft.index, null)).toEqual([...ids(base, null).slice(1), 'b-0']);
  });
});

// These are ordinary regression assertions, not snapshots of broken behavior or expected failures.
// They intentionally expose draft states that currently cannot be saved as previewed.
describe('draft saveability regressions', () => {
  it('does not accept a gesture that makes the pending request exceed the shared action limit', () => {
    const base = fixture();
    const operations: LayoutOperation[] = Array.from({ length: MAX_LAYOUT_OPERATIONS }, (_, i) => ({
      type: 'pinned', id: 'a', placement: { edge: i % 2 === 0 ? 'end' : 'start' },
    }));
    const full: LayoutDraft = { base, index: applyLayoutOperations(base, operations, base.preferences), operations, reset: false };
    expect(layoutSaveSchema.safeParse(request(full)).success).toBe(true);
    const next = moveInDraft(full, { type: 'pinned', id: 'a', placement: { edge: 'end' } });
    expect(layoutSaveSchema.safeParse(request(next)).success).toBe(true);
    expectReplayMatches(next);
  });
});

function resetFixture(): LayoutDraft {
  const base: LayoutIndex = {
    revision: 7, groupOrder: ['g'], groups: [
      { groupId: 'g', bookmarkIds: ['new', 'old', 'middle', 'unloaded'] },
      { groupId: null, bookmarkIds: [] },
    ], pinnedOrder: ['new', 'old', 'unloaded'],
    preferences: { ...DEFAULT_PREFERENCES, autoIcons: true, collapsedGroupIds: ['g'] },
  };
  // Model the complete /api/layout/default-preview DTO, including IDs with unloaded details.
  // No local createdAt inference and no persistence mocking or database integration is involved.
  const preview: LayoutIndex = {
    revision: base.revision, groupOrder: ['g'], groups: [
      { groupId: 'g', bookmarkIds: ['old', 'middle', 'new', 'unloaded'] },
      { groupId: null, bookmarkIds: [] },
    ], pinnedOrder: ['old', 'new', 'unloaded'],
    preferences: { ...DEFAULT_PREFERENCES, collapsedGroupIds: [], autoIcons: true },
  };
  return { base, index: preview, operations: [], reset: true };
}

describe('reset preview contract (creation ordering is owned by the backend)', () => {
  it('keeps a pending reset dirty even with no ordinary moves and allows cancellation to the original base', () => {
    const reset = resetFixture();
    expect(reset.operations).toEqual([]);
    expect(layoutChanged(reset)).toBe(true);
    expect(layoutSaveSchema.parse(request(reset)).preferences.autoIcons).toBe(true);
    const cancelled = beginLayout(reset.base);
    expect(layoutChanged(cancelled)).toBe(false);
    expect(ids(cancelled.index, 'g')).toEqual(['new', 'old', 'middle', 'unloaded']);
    expectReplayMatches(cancelled);
  });

  it('keeps a reset draft saveable when the user tries to move a card afterwards', () => {
    const reset = resetFixture();
    expect(layoutSaveSchema.safeParse(request(reset)).success).toBe(true);
    const moved = moveInDraft(reset, { type: 'bookmark', id: 'old', groupId: 'g', placement: { edge: 'end' } });
    expect(layoutSaveSchema.safeParse(request(moved)).success).toBe(true);
    if (!moved.reset) expectReplayMatches(moved);
  });

  it('does not preview changed preferences that the reset save branch will ignore', () => {
    const reset = resetFixture();
    const edited = preferencesInDraft(reset, { desktopColumns: 6, density: 'compact' });
    expect(layoutSaveSchema.safeParse(request(edited)).success).toBe(true);
    if (edited.reset) {
      // saveLayout's reset branch fixes these two values, regardless of input.preferences.
      expect(edited.index.preferences.desktopColumns).toBe(DEFAULT_PREFERENCES.desktopColumns);
      expect(edited.index.preferences.density).toBe(DEFAULT_PREFERENCES.density);
    } else expectReplayMatches(edited);
  });
});
