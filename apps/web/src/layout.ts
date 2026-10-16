import { MAX_LAYOUT_OPERATIONS, type LayoutIndex, type LayoutOperation, type LayoutPreferences, type Placement } from '@luypage/contracts';

export interface LayoutDraft {
  base: LayoutIndex;
  index: LayoutIndex;
  operations: LayoutOperation[];
  reset: boolean;
}
export const beginLayout = (index: LayoutIndex): LayoutDraft => ({ base: structuredClone(index), index: structuredClone(index), operations: [], reset: false });
export function layoutChanged(draft: LayoutDraft | null): boolean {
  return !!draft && (draft.reset || draft.operations.length > 0 || JSON.stringify(draft.base.preferences) !== JSON.stringify(draft.index.preferences));
}

function insert(list: string[], id: string, placement: Placement): string[] {
  const result = list.filter(item => item !== id);
  if ('edge' in placement) result.splice(placement.edge === 'start' ? 0 : result.length, 0, id);
  else {
    const anchor = 'beforeId' in placement ? placement.beforeId : placement.afterId;
    const position = result.indexOf(anchor);
    if (position < 0) return list;
    result.splice(position + ('afterId' in placement ? 1 : 0), 0, id);
  }
  return result;
}

// Local preview only. Server writes always use relative operations against base.revision.
export function moveInDraft(draft: LayoutDraft, operation: LayoutOperation): LayoutDraft {
  if (draft.reset || draft.operations.length >= MAX_LAYOUT_OPERATIONS) return draft;
  const index = structuredClone(draft.index);
  if (operation.type === 'group') {
    if (!index.groupOrder.includes(operation.id)) return draft;
    index.groupOrder = insert(index.groupOrder, operation.id, operation.placement);
  } else if (operation.type === 'pinned') {
    if (!index.pinnedOrder.includes(operation.id)) return draft;
    index.pinnedOrder = insert(index.pinnedOrder, operation.id, operation.placement);
  } else {
    const target = index.groups.find(group => group.groupId === operation.groupId);
    if (!target || !index.groups.some(group => group.bookmarkIds.includes(operation.id))) return draft;
    if ('beforeId' in operation.placement && !target.bookmarkIds.includes(operation.placement.beforeId)) return draft;
    if ('afterId' in operation.placement && !target.bookmarkIds.includes(operation.placement.afterId)) return draft;
    const next = insert(target.bookmarkIds, operation.id, operation.placement);
    for (const group of index.groups) group.bookmarkIds = group === target ? next : group.bookmarkIds.filter(id => id !== operation.id);
  }
  if (JSON.stringify(index) === JSON.stringify(draft.index)) return draft;
  return { ...draft, index, operations: [...draft.operations, operation] };
}

export type MoveDirection = 'previous' | 'next' | 'start' | 'end';
export function relativePlacement(ids: string[], id: string, direction: MoveDirection): Placement | null {
  const at = ids.indexOf(id);
  if (at < 0) return null;
  if (direction === 'start') return at > 0 ? { edge: 'start' } : null;
  if (direction === 'end') return at < ids.length - 1 ? { edge: 'end' } : null;
  const adjacent = ids[at + (direction === 'previous' ? -1 : 1)];
  return adjacent ? direction === 'previous' ? { beforeId: adjacent } : { afterId: adjacent } : null;
}

export function preferencesInDraft(draft: LayoutDraft, preferences: Partial<LayoutPreferences>): LayoutDraft {
  if (draft.reset) return draft;
  return { ...draft, index: { ...draft.index, preferences: { ...draft.index.preferences, ...preferences } } };
}
