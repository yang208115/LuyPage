import { AppError, homepageLayoutSchema, type HomepageLayout, type HomepageLayoutSaveInput, type MutationResult } from '@luypage/contracts';
import { tilesOverlap } from '@luypage/domain';
import { mutate, statement } from './database';

export async function saveHomepageLayout(db: D1Database, ownerId: string, input: HomepageLayoutSaveInput): Promise<MutationResult<HomepageLayout>> {
  return mutate(db, ownerId, input.operationId, ['homepage.layout', input], async state => {
    const results = await db.batch([
      statement(db, 'SELECT homepage_layout FROM workspace_state WHERE owner_id = ?', ownerId),
      statement(db, 'SELECT id FROM groups WHERE owner_id = ?', ownerId),
      statement(db, 'SELECT id FROM bookmarks WHERE owner_id = ? AND pinned = 1 AND deleted_at IS NULL', ownerId),
    ]);
    const layout = homepageLayoutSchema.parse(JSON.parse((results[0]!.results[0] as { homepage_layout: string }).homepage_layout));
    const allowed = new Set(['search', 'clock', 'calendar', 'weather', 'favorites', 'ungrouped', ...results[1]!.results.map(row => `folder:${(row as { id: string }).id}`)]);
    const pins = new Set(results[2]!.results.map(row => (row as { id: string }).id));
    const { items, pinnedOrder } = input.profile;
    if (items.some(item => !allowed.has(item.id)) || pinnedOrder.some(id => !pins.has(id))) throw new AppError('INVALID_LAYOUT_REFERENCE', '部分组件或常用网站已变化，请读取最新布局后重试。', 409);
    if (['search', 'clock', 'calendar', 'favorites'].some(id => !items.some(item => item.id === id))) throw new AppError('VALIDATION_ERROR', '布局缺少必要组件。', 422);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      if (tilesOverlap(items[i]!, items[j]!)) throw new AppError('VALIDATION_ERROR', '主页组件不能重叠。', 422);
    }
    const existing = layout[input.device];
    let profile = input.profile.pinnedSlots === undefined && existing?.pinnedSlots && JSON.stringify(existing.pinnedOrder) === JSON.stringify(pinnedOrder)
      ? { ...input.profile, pinnedSlots: existing.pinnedSlots } : input.profile;
    if (profile.pinnedSizes === undefined && existing?.pinnedSizes) {
      const ids = new Set(pinnedOrder);
      profile = { ...profile, pinnedSizes: Object.fromEntries(Object.entries(existing.pinnedSizes).filter(([id]) => ids.has(id))) };
    }
    const next: HomepageLayout = { ...layout, [input.device]: profile };
    return { statements: [statement(db, 'UPDATE workspace_state SET homepage_layout = ? WHERE owner_id = ?', JSON.stringify(next), ownerId)], result: { data: next, revision: state.data_revision + 1 } };
  }, input.baseRevision);
}
