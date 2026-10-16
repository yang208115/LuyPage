import { AppError, searchKey, type Bookmark, type BookmarkPage, type BookmarkQuery, type Bootstrap, type Group, type LayoutIndex, type Tag } from '@luypage/contracts';
import { preferencesOf, statement, type SqlValue, type State } from './database';

export interface BookmarkRow {
  id: string; owner_id: string; url: string; normalized_url: string; title: string; title_key: string; note: string;
  search_key: string; group_id: string | null; pinned: number; position: number; pinned_position: number;
  icon_type: 'auto' | 'builtin'; icon_key: string | null; created_at: string; updated_at: string; deleted_at: string | null;
  version: number; tag_ids: string;
}
export const bookmarkColumns = `b.*, (SELECT json_group_array(tag_id) FROM
  (SELECT tag_id FROM bookmark_tags WHERE owner_id = b.owner_id AND bookmark_id = b.id ORDER BY tag_id)) AS tag_ids`;
export function bookmarkDto(row: BookmarkRow): Bookmark {
  return { id: row.id, url: row.url, title: row.title, note: row.note, groupId: row.group_id,
    tagIds: JSON.parse(row.tag_ids) as string[], pinned: Boolean(row.pinned), icon: { type: row.icon_type, key: row.icon_key },
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, version: row.version };
}
export async function findBookmark(db: D1Database, ownerId: string, id: string): Promise<BookmarkRow | null> {
  return statement(db, `SELECT ${bookmarkColumns} FROM bookmarks b WHERE b.owner_id = ? AND b.id = ?`, ownerId, id).first<BookmarkRow>();
}
export interface GroupRow { id: string; name: string; position: number; created_at: string; version: number; count: number }
export interface TagRow { id: string; name: string; version: number; count: number }
export const groupsQuery = `SELECT g.*, (SELECT count(*) FROM bookmarks b WHERE b.owner_id = g.owner_id AND b.group_id = g.id AND b.deleted_at IS NULL) AS count
  FROM groups g WHERE g.owner_id = ? ORDER BY g.position, g.id`;
export const tagsQuery = `SELECT t.*, (SELECT count(*) FROM bookmark_tags bt JOIN bookmarks b ON b.owner_id = bt.owner_id AND b.id = bt.bookmark_id
  WHERE bt.owner_id = t.owner_id AND bt.tag_id = t.id AND b.deleted_at IS NULL) AS count FROM tags t WHERE t.owner_id = ? ORDER BY t.name_key, t.id`;
export const groupDto = (row: GroupRow): Group => ({ id: row.id, name: row.name, count: row.count, createdAt: row.created_at, version: row.version });
export const tagDto = (row: TagRow): Tag => ({ id: row.id, name: row.name, count: row.count, version: row.version });

export async function getBootstrap(db: D1Database, ownerId: string): Promise<Bootstrap> {
  const results = await db.batch([
    statement(db, 'SELECT data_revision, preferences FROM workspace_state WHERE owner_id = ?', ownerId),
    statement(db, groupsQuery, ownerId), statement(db, tagsQuery, ownerId),
    statement(db, `SELECT count(CASE WHEN deleted_at IS NULL THEN 1 END) AS active,
      count(deleted_at) AS trash, count(CASE WHEN deleted_at IS NULL AND pinned = 1 THEN 1 END) AS pinned,
      count(CASE WHEN deleted_at IS NULL AND group_id IS NULL THEN 1 END) AS ungrouped FROM bookmarks WHERE owner_id = ?`, ownerId),
  ]);
  const state = results[0]!.results[0] as unknown as State;
  return { revision: state.data_revision, preferences: preferencesOf(state),
    groups: (results[1]!.results as unknown as GroupRow[]).map(groupDto), tags: (results[2]!.results as unknown as TagRow[]).map(tagDto),
    counts: results[3]!.results[0] as unknown as Bootstrap['counts'], capabilities: { transfers: true, automaticIcons: true } };
}

export interface LayoutBookmark { id: string; group_id: string | null; position: number; pinned: number; pinned_position: number; created_at: string; version: number }
export interface LayoutSnapshot { index: LayoutIndex; bookmarks: LayoutBookmark[]; groups: GroupRow[] }
export async function getLayoutSnapshot(db: D1Database, ownerId: string): Promise<LayoutSnapshot> {
  const results = await db.batch([
    statement(db, 'SELECT data_revision, preferences FROM workspace_state WHERE owner_id = ?', ownerId),
    statement(db, 'SELECT id, name, position, created_at, version FROM groups WHERE owner_id = ? ORDER BY position, id', ownerId),
    statement(db, `SELECT id, group_id, position, pinned, pinned_position, created_at, version FROM bookmarks
      WHERE owner_id = ? AND deleted_at IS NULL ORDER BY position, id`, ownerId),
  ]);
  const state = results[0]!.results[0] as unknown as State;
  const groups = results[1]!.results as unknown as GroupRow[];
  const bookmarks = results[2]!.results as unknown as LayoutBookmark[];
  const buckets = new Map<string | null, string[]>([...groups.map(g => [g.id, []] as [string, string[]]), [null, []]]);
  for (const bookmark of bookmarks) buckets.get(bookmark.group_id)!.push(bookmark.id);
  return { groups, bookmarks, index: { revision: state.data_revision, groupOrder: groups.map(g => g.id),
    groups: Array.from(buckets, ([groupId, bookmarkIds]) => ({ groupId, bookmarkIds })),
    pinnedOrder: bookmarks.filter(b => b.pinned).sort((a, b) => a.pinned_position - b.pinned_position || (a.id < b.id ? -1 : 1)).map(b => b.id),
    preferences: preferencesOf(state) } };
}
export async function getLayoutIndex(db: D1Database, ownerId: string): Promise<LayoutIndex> {
  return (await getLayoutSnapshot(db, ownerId)).index;
}

interface Cursor { revision: number; query: string; key: [number, number, string | number, number, string] }
function encodeCursor(cursor: Cursor): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor))));
}
function decodeCursor(value: string): Cursor {
  try {
    if (value.length > 32768) throw new Error('cursor too long');
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value), c => c.charCodeAt(0))));
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid cursor');
    const c = parsed as Cursor;
    if (!Number.isSafeInteger(c.revision) || c.revision < 0 || typeof c.query !== 'string' || !Array.isArray(c.key) || c.key.length !== 5 ||
      typeof c.key[0] !== 'number' || typeof c.key[1] !== 'number' || !['number', 'string'].includes(typeof c.key[2]) || typeof c.key[3] !== 'number' || typeof c.key[4] !== 'string') throw new Error('invalid cursor');
    return c;
  } catch { throw new AppError('INVALID_CURSOR', '分页游标无效，请重新加载列表。', 422); }
}

export async function listBookmarks(db: D1Database, ownerId: string, query: BookmarkQuery = {}, trash = false): Promise<BookmarkPage> {
  const limit = query.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AppError('VALIDATION_ERROR', '每页数量必须为 1–100。');
  const sort = query.sort ?? 'manual';
  if (!['manual', 'created', 'updated', 'title'].includes(sort)) throw new AppError('VALIDATION_ERROR', '排序方式无效。');
  const words = searchKey(query.q ?? '').trim().split(/\s+/u).filter(Boolean);
  if (words.length > 50 || (query.q?.length ?? 0) > 2000 || (query.tagIds?.length ?? 0) > 20) throw new AppError('VALIDATION_ERROR', '筛选条件过长。');
  const tagIds = [...new Set(query.tagIds ?? [])].sort();
  const fingerprint = JSON.stringify([ownerId, trash, words, query.groupId ?? null, tagIds, query.pinned ?? null, sort]);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor && cursor.query !== fingerprint) throw new AppError('INVALID_CURSOR', '筛选条件已变化，请重新加载列表。', 422);
  const where = ['b.owner_id = ?', `b.deleted_at IS ${trash ? 'NOT ' : ''}NULL`];
  const args: SqlValue[] = [ownerId];
  if (query.groupId !== undefined) { where.push('b.group_id IS ?'); args.push(query.groupId === 'ungrouped' ? null : query.groupId); }
  if (query.pinned !== undefined) { where.push('b.pinned = ?'); args.push(Number(query.pinned)); }
  if (tagIds.length) {
    where.push(`NOT EXISTS (SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS
      (SELECT 1 FROM bookmark_tags bt WHERE bt.owner_id = b.owner_id AND bt.bookmark_id = b.id AND bt.tag_id = wanted.value))`);
    args.push(JSON.stringify(tagIds));
  }
  if (words.length) {
    where.push(`NOT EXISTS (SELECT 1 FROM json_each(?) word WHERE instr(b.search_key, word.value) = 0 AND NOT EXISTS
      (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.owner_id = bt.owner_id AND t.id = bt.tag_id
       WHERE bt.owner_id = b.owner_id AND bt.bookmark_id = b.id AND instr(t.name_key, word.value) > 0))`);
    args.push(JSON.stringify(words));
  }
  const pinnedOrder = sort === 'manual' && query.pinned === true;
  const k1 = sort === 'manual' && !pinnedOrder ? '(b.group_id IS NULL)' : '0';
  const k2 = pinnedOrder ? 'b.pinned_position' : sort === 'manual' ? 'coalesce(g.position, 0)' : sort === 'title' ? 'b.title_key' : sort === 'created' ? '-julianday(b.created_at)' : '-julianday(b.updated_at)';
  const k3 = sort === 'manual' && !pinnedOrder ? 'b.position' : '0';
  const cte = `WITH filtered AS (SELECT ${bookmarkColumns}, -b.pinned AS k0, ${k1} AS k1, ${k2} AS k2, ${k3} AS k3
    FROM bookmarks b LEFT JOIN groups g ON g.owner_id = b.owner_id AND g.id = b.group_id WHERE ${where.join(' AND ')})`;
  const results = await db.batch([
    statement(db, 'SELECT data_revision FROM workspace_state WHERE owner_id = ?', ownerId),
    statement(db, `SELECT count(*) AS total FROM bookmarks b WHERE ${where.join(' AND ')}`, ...args),
    statement(db, `${cte} SELECT * FROM filtered ${cursor ? 'WHERE (k0, k1, k2, k3, id) > (?, ?, ?, ?, ?)' : ''}
      ORDER BY k0, k1, k2, k3, id LIMIT ?`, ...args, ...(cursor?.key ?? []), limit + 1),
  ]);
  const revision = (results[0]!.results[0] as { data_revision: number }).data_revision;
  if (cursor && cursor.revision !== revision) throw new AppError('CURSOR_STALE', '列表已更新，请从第一页重新加载。', 409, { revision });
  const rows = results[2]!.results as unknown as (BookmarkRow & { k0: number; k1: number; k2: string | number; k3: number })[];
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return { items: visible.map(bookmarkDto), total: (results[1]!.results[0] as { total: number }).total, revision,
    nextCursor: rows.length > limit && last ? encodeCursor({ revision, query: fingerprint, key: [last.k0, last.k1, last.k2, last.k3, last.id] }) : null };
}
