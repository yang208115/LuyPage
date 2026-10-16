import {
  AppError, normalizeUrl, searchKey, type BatchInput, type BatchResult, type Bookmark, type BookmarkInput,
  type CreateBookmarkInput, type MutationResult, type UpdateBookmarkInput, type VersionInput,
} from '@luypage/contracts';
import { conflict, missing, mutate, statement } from './database';
import { bookmarkDto, findBookmark, type BookmarkRow } from './queries';

export async function validateReferences(db: D1Database, ownerId: string, groupId: string | null, tagIds: string[]): Promise<void> {
  if (groupId !== null && !await statement(db, 'SELECT 1 FROM groups WHERE owner_id = ? AND id = ?', ownerId, groupId).first()) throw missing();
  if (tagIds.length) {
    const found = await statement(db, 'SELECT count(*) AS n FROM tags WHERE owner_id = ? AND id IN (SELECT value FROM json_each(?))', ownerId, JSON.stringify(tagIds)).first<{ n: number }>();
    if (found?.n !== new Set(tagIds).size) throw missing();
  }
}
export async function appendPosition(db: D1Database, ownerId: string, groupId: string | null, pinned = false): Promise<number> {
  const found = await statement(db, pinned
    ? 'SELECT coalesce(max(pinned_position), 0) AS n FROM bookmarks WHERE owner_id = ? AND pinned = 1 AND deleted_at IS NULL'
    : 'SELECT coalesce(max(position), 0) AS n FROM bookmarks WHERE owner_id = ? AND group_id IS ? AND deleted_at IS NULL',
  ownerId, ...(pinned ? [] : [groupId])).first<{ n: number }>();
  const position = (found?.n ?? 0) + 1024;
  if (!Number.isSafeInteger(position)) throw new AppError('ORDER_CAPACITY', '排序空间不足，请恢复默认布局后重试。', 409);
  return position;
}
function tagStatements(db: D1Database, ownerId: string, id: string, tagIds: string[]): D1PreparedStatement[] {
  return [statement(db, 'DELETE FROM bookmark_tags WHERE owner_id = ? AND bookmark_id = ?', ownerId, id),
    statement(db, 'INSERT INTO bookmark_tags (owner_id, bookmark_id, tag_id) SELECT ?, ?, value FROM json_each(?)', ownerId, id, JSON.stringify(tagIds))];
}
async function normalizedInput(db: D1Database, ownerId: string, input: BookmarkInput, currentId?: string) {
  const normalized = normalizeUrl(input.url);
  const duplicate = await statement(db, 'SELECT id, deleted_at FROM bookmarks WHERE owner_id = ? AND normalized_url = ? AND id != ?', ownerId, normalized.normalizedUrl, currentId ?? '').first<{ id: string; deleted_at: string | null }>();
  if (duplicate) throw new AppError(duplicate.deleted_at ? 'URL_IN_TRASH' : 'DUPLICATE_URL', duplicate.deleted_at ? '回收站中已有此网址，请恢复已有收藏。' : '已收藏此网址。', 409, { id: duplicate.id, deletedAt: duplicate.deleted_at });
  await validateReferences(db, ownerId, input.groupId, input.tagIds);
  const title = input.title.trim() || Array.from(normalized.hostname).slice(0, 200).join('');
  return { ...normalized, title, titleKey: searchKey(title), searchKey: searchKey(`${title}\n${normalized.url}\n${input.note}`) };
}

export async function createBookmark(db: D1Database, ownerId: string, input: CreateBookmarkInput): Promise<MutationResult<Bookmark>> {
  return mutate(db, ownerId, input.operationId, ['bookmark.create', input], async state => {
    const normalized = await normalizedInput(db, ownerId, input);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = await appendPosition(db, ownerId, input.groupId);
    const pinnedPosition = input.pinned ? await appendPosition(db, ownerId, null, true) : 0;
    const bookmark: Bookmark = { id, url: normalized.url, title: normalized.title, note: input.note, groupId: input.groupId,
      tagIds: [...input.tagIds].sort(), pinned: input.pinned, icon: input.icon, createdAt: now, updatedAt: now, deletedAt: null, version: 1 };
    return { result: { data: bookmark, revision: state.data_revision + 1 }, statements: [
      statement(db, `INSERT INTO bookmarks (owner_id, id, url, normalized_url, title, title_key, note, search_key, group_id,
        pinned, position, pinned_position, icon_type, icon_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ownerId, id, normalized.url, normalized.normalizedUrl, normalized.title, normalized.titleKey, input.note, normalized.searchKey,
      input.groupId, Number(input.pinned), position, pinnedPosition, input.icon.type, input.icon.key, now, now),
      ...tagStatements(db, ownerId, id, input.tagIds),
    ] };
  });
}

export async function updateBookmark(db: D1Database, ownerId: string, id: string, input: UpdateBookmarkInput): Promise<MutationResult<Bookmark>> {
  return mutate(db, ownerId, input.operationId, ['bookmark.update', id, input], async state => {
    const row = await findBookmark(db, ownerId, id);
    if (!row || row.deleted_at) throw missing();
    if (row.version !== input.version) throw conflict();
    const normalized = await normalizedInput(db, ownerId, input, id);
    const position = row.group_id === input.groupId ? row.position : await appendPosition(db, ownerId, input.groupId);
    const pinnedPosition = input.pinned && !row.pinned ? await appendPosition(db, ownerId, null, true) : row.pinned_position;
    const now = new Date().toISOString();
    const bookmark: Bookmark = { ...bookmarkDto(row), url: normalized.url, title: normalized.title, note: input.note,
      groupId: input.groupId, tagIds: [...input.tagIds].sort(), pinned: input.pinned, icon: input.icon, version: row.version + 1, updatedAt: now };
    return { result: { data: bookmark, revision: state.data_revision + 1 }, statements: [
      statement(db, `UPDATE bookmarks SET url = ?, normalized_url = ?, title = ?, title_key = ?, note = ?, search_key = ?,
        group_id = ?, pinned = ?, position = ?, pinned_position = ?, icon_type = ?, icon_key = ?, updated_at = ?, version = version + 1
        WHERE owner_id = ? AND id = ?`, normalized.url, normalized.normalizedUrl, normalized.title, normalized.titleKey, input.note,
      normalized.searchKey, input.groupId, Number(input.pinned), position, pinnedPosition, input.icon.type, input.icon.key, now, ownerId, id),
      ...tagStatements(db, ownerId, id, input.tagIds),
    ] };
  });
}

export async function changeBookmarkState(db: D1Database, ownerId: string, id: string, input: VersionInput, action: 'trash' | 'restore' | 'delete'): Promise<MutationResult<Bookmark | null>> {
  return mutate<MutationResult<Bookmark | null>>(db, ownerId, input.operationId, [`bookmark.${action}`, id, input], async state => {
    const row = await findBookmark(db, ownerId, id);
    if (!row || (action === 'trash' ? row.deleted_at !== null : row.deleted_at === null)) throw missing();
    if (row.version !== input.version) throw conflict();
    if (action === 'delete') return { result: { data: null, revision: state.data_revision + 1 }, statements: [statement(db, 'DELETE FROM bookmarks WHERE owner_id = ? AND id = ?', ownerId, id)] };
    const now = new Date().toISOString();
    const deletedAt = action === 'trash' ? now : null;
    const position = action === 'restore' ? await appendPosition(db, ownerId, row.group_id) : row.position;
    const pinnedPosition = action === 'restore' && row.pinned ? await appendPosition(db, ownerId, null, true) : row.pinned_position;
    return { result: { data: { ...bookmarkDto(row), deletedAt, updatedAt: now, version: row.version + 1 }, revision: state.data_revision + 1 },
      statements: [statement(db, 'UPDATE bookmarks SET deleted_at = ?, updated_at = ?, position = ?, pinned_position = ?, version = version + 1 WHERE owner_id = ? AND id = ?', deletedAt, now, position, pinnedPosition, ownerId, id)] };
  });
}

export async function batchBookmarks(db: D1Database, ownerId: string, input: BatchInput): Promise<BatchResult> {
  if (input.items.length > 5000) throw new AppError('VALIDATION_ERROR', '单次最多处理 5000 条收藏。');
  return mutate(db, ownerId, input.operationId, ['bookmark.batch', input], async () => {
    const needsTags = input.action === 'addTags' || input.action === 'removeTags';
    if (input.action === 'move' && input.groupId === undefined) throw new AppError('VALIDATION_ERROR', '请选择目标分组。');
    if (needsTags && !input.tagIds?.length) throw new AppError('VALIDATION_ERROR', '请选择标签。');
    let referenceError: AppError | undefined;
    try { await validateReferences(db, ownerId, input.action === 'move' ? input.groupId! : null, needsTags ? input.tagIds! : []); }
    catch (e) { if (!(e instanceof AppError)) throw e; referenceError = e; }
    // This bounded selection retrieves only the selected records and their labels.
    const selected = await statement(db, `SELECT b.id, b.version, b.deleted_at, b.group_id, b.position, b.pinned, b.pinned_position,
      (SELECT json_group_array(tag_id) FROM bookmark_tags WHERE owner_id = b.owner_id AND bookmark_id = b.id) AS tag_ids
      FROM bookmarks b WHERE b.owner_id = ? AND b.id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`, ownerId, JSON.stringify(input.items)).all<Pick<BookmarkRow, 'id' | 'version' | 'deleted_at' | 'group_id' | 'position' | 'pinned' | 'pinned_position' | 'tag_ids'>>();
    const rows = new Map(selected.results.map(row => [row.id, row]));
    const items: BatchResult['items'] = [];
    const changes: { id: string; groupId: string | null; position: number; pinnedPosition: number; deletedAt: string | null; tagIds: string[] }[] = [];
    const nextPositions = new Map<string | null, number>();
    let nextPinned = 0;
    const now = new Date().toISOString();
    for (const item of input.items) {
      const row = rows.get(item.id);
      let error = referenceError;
      if (!row || (input.action === 'restore' || input.action === 'delete' ? row.deleted_at === null : row.deleted_at !== null)) error = missing();
      else if (row.version !== item.version) error = conflict();
      if (error || !row) { items.push({ id: item.id, success: false, code: error!.code, message: error!.message }); continue; }
      const oldTags = JSON.parse(row.tag_ids) as string[];
      const tagIds = input.action === 'addTags' ? [...new Set([...oldTags, ...input.tagIds!])] : input.action === 'removeTags' ? oldTags.filter(id => !input.tagIds!.includes(id)) : oldTags;
      if (tagIds.length > 20) { items.push({ id: item.id, success: false, code: 'TAG_LIMIT', message: '每条收藏最多 20 个标签。' }); continue; }
      const groupId = input.action === 'move' ? input.groupId! : row.group_id;
      let position = row.position;
      if ((input.action === 'move' && groupId !== row.group_id) || input.action === 'restore') {
        const next = nextPositions.get(groupId) ?? await appendPosition(db, ownerId, groupId);
        position = next; nextPositions.set(groupId, next + 1024);
      }
      let pinnedPosition = row.pinned_position;
      if (input.action === 'restore' && row.pinned) {
        nextPinned ||= await appendPosition(db, ownerId, null, true);
        pinnedPosition = nextPinned; nextPinned += 1024;
      }
      changes.push({ id: item.id, groupId, position, pinnedPosition, deletedAt: input.action === 'trash' ? now : input.action === 'restore' ? null : row.deleted_at, tagIds });
      items.push({ id: item.id, success: true });
    }
    const statements: D1PreparedStatement[] = [];
    // Chunk JSON parameters, keeping the entire operation in one atomic batch.
    for (let i = 0; i < changes.length; i += 100) {
      const chunk = changes.slice(i, i + 100);
      const json = JSON.stringify(chunk);
      if (input.action === 'delete') {
        statements.push(statement(db, `DELETE FROM bookmarks WHERE owner_id = ? AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`, ownerId, json));
      } else {
        statements.push(statement(db, `WITH changes AS (SELECT value FROM json_each(?)) UPDATE bookmarks SET
          group_id = json_extract(c.value, '$.groupId'), position = json_extract(c.value, '$.position'),
          pinned_position = json_extract(c.value, '$.pinnedPosition'), deleted_at = json_extract(c.value, '$.deletedAt'),
          version = version + 1, updated_at = ? FROM changes c WHERE owner_id = ? AND id = json_extract(c.value, '$.id')`, json, now, ownerId));
        if (needsTags) statements.push(
          statement(db, `DELETE FROM bookmark_tags WHERE owner_id = ? AND bookmark_id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`, ownerId, json),
          statement(db, `INSERT INTO bookmark_tags (owner_id, bookmark_id, tag_id)
            SELECT ?, json_extract(c.value, '$.id'), t.value FROM json_each(?) c, json_each(c.value, '$.tagIds') t`, ownerId, json));
      }
    }
    return { statements, result: { items, succeeded: changes.length, failed: items.length - changes.length } };
  });
}
