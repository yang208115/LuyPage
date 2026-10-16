import { z } from 'zod';
import {
  AppError, idSchema, layoutOperationsSchema, layoutPreferencesSchema,
  type LayoutIndex, type LayoutOperation, type LayoutPreferences, type Placement,
} from '@luypage/contracts';

const layoutIndexSchema = z.object({
  revision: z.number().int().nonnegative(),
  groupOrder: z.array(idSchema),
  groups: z.array(z.object({ groupId: idSchema.nullable(), bookmarkIds: z.array(idSchema) })),
  pinnedOrder: z.array(idSchema),
  preferences: layoutPreferencesSchema,
});

function invalidLayout(message: string, details?: unknown): never {
  throw new AppError('INVALID_LAYOUT', message, 422, details);
}

function unique(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) invalidLayout(`${label}包含重复标识`);
}

function insertionIndex(ids: string[], id: string, placement: Placement): number {
  if ('edge' in placement) return placement.edge === 'start' ? 0 : ids.length;
  const anchor = 'beforeId' in placement ? placement.beforeId : placement.afterId;
  if (anchor === id) invalidLayout('移动项不能以自身作为锚点');
  const position = ids.indexOf(anchor);
  if (position < 0) invalidLayout('锚点不属于目标集合或已失效');
  return position + ('afterId' in placement ? 1 : 0);
}

function moveWithin(ids: string[], id: string, placement: Placement): void {
  const source = ids.indexOf(id);
  if (source < 0) invalidLayout('移动项不属于目标集合或已失效');
  ids.splice(source, 1);
  ids.splice(insertionIndex(ids, id, placement), 0, id);
}

/** Apply a complete layout draft; revision checks/increments and reset ordering belong to persistence. */
export function applyLayoutOperations(
  index: LayoutIndex,
  operations: LayoutOperation[],
  preferences: LayoutPreferences,
): LayoutIndex {
  const snapshot = layoutIndexSchema.safeParse(index);
  const actions = layoutOperationsSchema.safeParse(operations);
  const settings = layoutPreferencesSchema.safeParse(preferences);
  if (!snapshot.success) invalidLayout('布局索引格式无效', snapshot.error.issues);
  if (!actions.success) invalidLayout('布局操作格式无效', actions.error.issues);
  if (!settings.success) invalidLayout('布局偏好格式无效', settings.error.issues);

  // Zod returns fresh nested arrays/objects, so even a later invalid action cannot mutate callers.
  const result: LayoutIndex = snapshot.data;
  unique(result.groupOrder, '分组顺序');
  unique(result.pinnedOrder, '常用顺序');
  const groups = new Map<string | null, LayoutIndex['groups'][number]>();
  const membership = new Map<string, LayoutIndex['groups'][number]>();
  for (const group of result.groups) {
    if (groups.has(group.groupId)) invalidLayout('分组索引包含重复标识');
    groups.set(group.groupId, group);
    for (const id of group.bookmarkIds) {
      if (membership.has(id)) invalidLayout('收藏不能重复出现或属于多个分组');
      membership.set(id, group);
    }
  }
  if (!groups.has(null)) invalidLayout('完整布局索引必须包含未分组区域');
  if (groups.size !== result.groupOrder.length + 1 || result.groupOrder.some((id) => !groups.has(id))) {
    invalidLayout('分组顺序必须与完整分组索引一致');
  }
  if (result.pinnedOrder.some((id) => !membership.has(id))) invalidLayout('常用区包含失效收藏');
  for (const prefs of [result.preferences, settings.data]) {
    if (prefs.collapsedGroupIds.some((id) => !groups.has(id))) invalidLayout('折叠偏好包含失效分组');
  }

  for (const operation of actions.data) {
    switch (operation.type) {
      case 'group':
        moveWithin(result.groupOrder, operation.id, operation.placement);
        break;
      case 'pinned':
        // Moving a shortcut does not change group membership or set/unset pinned state.
        moveWithin(result.pinnedOrder, operation.id, operation.placement);
        break;
      case 'bookmark': {
        const source = membership.get(operation.id);
        const target = groups.get(operation.groupId);
        if (!source) invalidLayout('收藏不存在于完整布局索引');
        if (!target) invalidLayout('目标分组不存在');
        source.bookmarkIds.splice(source.bookmarkIds.indexOf(operation.id), 1);
        target.bookmarkIds.splice(insertionIndex(target.bookmarkIds, operation.id, operation.placement), 0, operation.id);
        membership.set(operation.id, target);
        break;
      }
    }
  }

  result.preferences = settings.data;
  result.groups = [...result.groupOrder.map((id) => groups.get(id)!), groups.get(null)!];
  return result;
}
