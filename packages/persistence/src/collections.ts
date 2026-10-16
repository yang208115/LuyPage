import { AppError, nameKey, type Group, type MutationResult, type NameInput, type Tag, type VersionInput } from '@luypage/contracts';
import { conflict, missing, mutate, preferencesOf, statement } from './database';
import { groupDto, groupsQuery, tagDto, tagsQuery, type GroupRow, type TagRow } from './queries';

type Collection = 'groups' | 'tags';
export async function saveCollection(db: D1Database, ownerId: string, collection: Collection, input: NameInput, id?: string): Promise<MutationResult<Group | Tag>> {
  return mutate(db, ownerId, input.operationId, [collection, id ?? 'create', input], async state => {
    const name = input.name.trim();
    const key = nameKey(name);
    const existing = id ? await statement(db, collection === 'groups' ? groupsQuery.replace('ORDER BY g.position, g.id', 'AND g.id = ?') : tagsQuery.replace('ORDER BY t.name_key, t.id', 'AND t.id = ?'), ownerId, id).first<GroupRow & TagRow>() : null;
    if (id && !existing) throw missing();
    if (existing && existing.version !== input.version) throw conflict();
    const duplicate = await statement(db, `SELECT id FROM ${collection} WHERE owner_id = ? AND name_key = ? AND id != ?`, ownerId, key, id ?? '').first();
    if (duplicate) throw new AppError('DUPLICATE_NAME', '已有同名分组或标签。', 409);
    if (existing) {
      const dto = collection === 'groups' ? groupDto(existing) : tagDto(existing);
      return { result: { data: { ...dto, name, version: existing.version + 1 }, revision: state.data_revision + 1 }, statements: [
        statement(db, `UPDATE ${collection} SET name = ?, name_key = ?, version = version + 1 WHERE owner_id = ? AND id = ?`, name, key, ownerId, existing.id),
      ] };
    }
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    const common: Tag = { id: newId, name, count: 0, version: 1 };
    return { result: { data: collection === 'groups' ? { ...common, createdAt: now } : common, revision: state.data_revision + 1 }, statements: [collection === 'groups'
      ? statement(db, `INSERT INTO groups (owner_id, id, name, name_key, position, created_at)
        SELECT ?, ?, ?, ?, coalesce(max(position), 0) + 1024, ? FROM groups WHERE owner_id = ?`, ownerId, newId, name, key, now, ownerId)
      : statement(db, 'INSERT INTO tags (owner_id, id, name, name_key, created_at) VALUES (?, ?, ?, ?, ?)', ownerId, newId, name, key, now),
    ] };
  });
}

export async function deleteCollection(db: D1Database, ownerId: string, collection: Collection, id: string, input: VersionInput): Promise<MutationResult<null>> {
  return mutate(db, ownerId, input.operationId, [collection, 'delete', id, input], async state => {
    const row = await statement(db, `SELECT version FROM ${collection} WHERE owner_id = ? AND id = ?`, ownerId, id).first<{ version: number }>();
    if (!row) throw missing();
    if (row.version !== input.version) throw conflict();
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    if (collection === 'groups') {
      // Append both active and trashed members without touching existing ungrouped
      // rows; all membership changes invalidate outstanding bookmark editors.
      statements.push(statement(db, `WITH moved AS (SELECT id, row_number() OVER (ORDER BY position, id) AS n FROM bookmarks WHERE owner_id = ? AND group_id = ?),
        tail AS (SELECT coalesce(max(position), 0) AS n FROM bookmarks WHERE owner_id = ? AND group_id IS NULL)
        UPDATE bookmarks SET group_id = NULL, position = (SELECT n FROM tail) + moved.n * 1024,
        version = version + 1, updated_at = ? FROM moved WHERE owner_id = ? AND bookmarks.id = moved.id`, ownerId, id, ownerId, now, ownerId));
      const preferences = preferencesOf(state);
      preferences.collapsedGroupIds = preferences.collapsedGroupIds.filter(groupId => groupId !== id);
      statements.push(statement(db, 'UPDATE workspace_state SET preferences = ? WHERE owner_id = ?', JSON.stringify(preferences), ownerId));
    } else {
      statements.push(statement(db, `UPDATE bookmarks SET version = version + 1, updated_at = ? WHERE owner_id = ? AND id IN
        (SELECT bookmark_id FROM bookmark_tags WHERE owner_id = ? AND tag_id = ?)`, now, ownerId, ownerId, id));
    }
    statements.push(statement(db, `DELETE FROM ${collection} WHERE owner_id = ? AND id = ?`, ownerId, id));
    return { statements, result: { data: null, revision: state.data_revision + 1 } };
  });
}

export async function collectionImpact(db: D1Database, ownerId: string, collection: Collection, id: string): Promise<{ active: number; trash: number; total: number }> {
  const results = await db.batch([
    statement(db, `SELECT 1 FROM ${collection} WHERE owner_id = ? AND id = ?`, ownerId, id),
    statement(db, `SELECT count(*) AS total, count(deleted_at) AS trash FROM bookmarks WHERE owner_id = ? AND ${collection === 'groups'
      ? 'group_id = ?' : 'id IN (SELECT bookmark_id FROM bookmark_tags WHERE owner_id = ? AND tag_id = ?)'}`, ownerId, ...(collection === 'groups' ? [id] : [ownerId, id])),
  ]);
  if (!results[0]!.results.length) throw missing();
  const row = results[1]!.results[0] as { total: number; trash: number };
  return { active: row.total - row.trash, trash: row.trash, total: row.total };
}
