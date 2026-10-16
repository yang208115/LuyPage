import { AppError, MAX_TRANSFER_BOOKMARKS, MAX_TRANSFER_BYTES, nameKey, normalizeUrl, searchKey, type ImportResult, type TransferDocument } from '@luypage/contracts';
import { mutate, statement } from './database';
import { bookmarkColumns, bookmarkDto, type BookmarkRow } from './queries';

export async function importBookmarks(db: D1Database, ownerId: string, operationId: string, document: TransferDocument): Promise<ImportResult> {
  const groupKeys = [...new Set([...document.groups, ...document.bookmarks.flatMap(item => item.group ? [item.group] : [])].map(nameKey))];
  const tagKeys = [...new Set([...document.tags, ...document.bookmarks.flatMap(item => item.tags)].map(nameKey))];
  const urls = document.bookmarks.map(item => normalizeUrl(item.url).normalizedUrl);
  return mutate(db, ownerId, operationId, ['import', document], async state => {
    const snapshot = await db.batch<Record<string, string | number | null>>([
      statement(db, 'SELECT id, name_key FROM groups WHERE owner_id = ? AND name_key IN (SELECT value FROM json_each(?))', ownerId, JSON.stringify(groupKeys)),
      statement(db, 'SELECT id, name_key FROM tags WHERE owner_id = ? AND name_key IN (SELECT value FROM json_each(?))', ownerId, JSON.stringify(tagKeys)),
      statement(db, 'SELECT group_id, max(position) AS position, max(pinned_position) AS pinned_position FROM bookmarks WHERE owner_id = ? GROUP BY group_id', ownerId),
      statement(db, 'SELECT coalesce(max(position), 0) AS position FROM groups WHERE owner_id = ?', ownerId),
      ...Array.from({ length: Math.ceil(urls.length / 100) }, (_, index) => statement(db, 'SELECT normalized_url FROM bookmarks WHERE owner_id = ? AND normalized_url IN (SELECT value FROM json_each(?))', ownerId, JSON.stringify(urls.slice(index * 100, index * 100 + 100)))),
    ]);
    const groups = new Map(snapshot[0]!.results.map(row => [String(row.name_key), String(row.id)]));
    const tags = new Map(snapshot[1]!.results.map(row => [String(row.name_key), String(row.id)]));
    const existing = new Set(snapshot.slice(4).flatMap(result => result.results.map(row => String(row.normalized_url))));
    const positions = new Map<string | null, number>();
    let groupPosition = Number(snapshot[3]!.results[0]!.position);
    let pinnedPosition = 0;
    for (const row of snapshot[2]!.results) {
      const group = row.group_id === null ? null : String(row.group_id);
      positions.set(group, Math.max(positions.get(group) ?? 0, Number(row.position)));
      pinnedPosition = Math.max(pinnedPosition, Number(row.pinned_position));
    }
    const now = new Date().toISOString();
    const newGroups: { id: string; name: string; key: string; position: number }[] = [];
    const newTags: { id: string; name: string; key: string }[] = [];
    function collection(name: string, kind: 'groups' | 'tags'): string {
      const key = nameKey(name); const map = kind === 'groups' ? groups : tags;
      const found = map.get(key); if (found) return found;
      const id = crypto.randomUUID(); map.set(key, id);
      if (kind === 'groups') newGroups.push({ id, name, key, position: groupPosition += 1024 });
      else newTags.push({ id, name, key });
      return id;
    }
    for (const name of document.groups) collection(name, 'groups');
    for (const name of document.tags) collection(name, 'tags');
    const additions = [];
    let skipped = 0;
    for (const item of document.bookmarks) {
      const normalized = normalizeUrl(item.url);
      if (existing.has(normalized.normalizedUrl)) { skipped++; continue; }
      existing.add(normalized.normalizedUrl);
      const groupId = item.group ? collection(item.group, 'groups') : null;
      const tagIds = [...new Set(item.tags.map(name => collection(name, 'tags')))];
      const position = (positions.get(groupId) ?? 0) + 1024;
      positions.set(groupId, position);
      const title = item.title || Array.from(normalized.hostname).slice(0, 200).join('');
      additions.push({ ...item, id: crypto.randomUUID(), url: normalized.url, normalizedUrl: normalized.normalizedUrl,
        title, titleKey: searchKey(title), searchKey: searchKey(`${title}\n${normalized.url}\n${item.note}`),
        groupId, tagIds, position, pinnedPosition: item.pinned ? pinnedPosition += 1024 : 0,
        createdAt: item.createdAt ?? now, updatedAt: item.updatedAt ?? item.createdAt ?? now });
    }
    const statements: D1PreparedStatement[] = [];
    // JSON parameters keep the number of binds bounded; all chunks commit in one guarded transaction.
    for (let i = 0; i < newGroups.length; i += 100) statements.push(statement(db, `INSERT INTO groups (owner_id, id, name, name_key, position, created_at)
      SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.key'), json_extract(value, '$.position'), ? FROM json_each(?)`, ownerId, now, JSON.stringify(newGroups.slice(i, i + 100))));
    for (let i = 0; i < newTags.length; i += 100) statements.push(statement(db, `INSERT INTO tags (owner_id, id, name, name_key, created_at)
      SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.key'), ? FROM json_each(?)`, ownerId, now, JSON.stringify(newTags.slice(i, i + 100))));
    for (let i = 0; i < additions.length; i += 100) {
      const json = JSON.stringify(additions.slice(i, i + 100));
      statements.push(statement(db, `INSERT INTO bookmarks (owner_id, id, url, normalized_url, title, title_key, note, search_key, group_id, pinned, position, pinned_position, icon_type, icon_key, created_at, updated_at)
        SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.url'), json_extract(value, '$.normalizedUrl'), json_extract(value, '$.title'), json_extract(value, '$.titleKey'), json_extract(value, '$.note'), json_extract(value, '$.searchKey'), json_extract(value, '$.groupId'), json_extract(value, '$.pinned'), json_extract(value, '$.position'), json_extract(value, '$.pinnedPosition'), json_extract(value, '$.icon.type'), json_extract(value, '$.icon.key'), json_extract(value, '$.createdAt'), json_extract(value, '$.updatedAt') FROM json_each(?)`, ownerId, json),
      statement(db, `INSERT INTO bookmark_tags (owner_id, bookmark_id, tag_id) SELECT ?, json_extract(b.value, '$.id'), t.value FROM json_each(?) b, json_each(b.value, '$.tagIds') t`, ownerId, json));
    }
    return { statements, result: { imported: additions.length, skipped, revision: state.data_revision + 1 } };
  });
}

export async function exportBookmarks(db: D1Database, ownerId: string): Promise<TransferDocument> {
  const snapshot = await db.batch<Record<string, string | number | null>>([
    statement(db, 'SELECT id, name FROM groups WHERE owner_id = ? ORDER BY position, id LIMIT ?', ownerId, MAX_TRANSFER_BOOKMARKS + 1),
    statement(db, 'SELECT id, name FROM tags WHERE owner_id = ? ORDER BY name_key, id LIMIT ?', ownerId, MAX_TRANSFER_BOOKMARKS + 1),
    statement(db, `SELECT ${bookmarkColumns} FROM bookmarks b WHERE b.owner_id = ? AND b.deleted_at IS NULL
      AND (SELECT coalesce(sum(length(CAST(url || title || note AS BLOB))), 0) FROM bookmarks WHERE owner_id = ? AND deleted_at IS NULL) <= ?
      ORDER BY b.position, b.id LIMIT ?`, ownerId, ownerId, MAX_TRANSFER_BYTES, MAX_TRANSFER_BOOKMARKS + 1),
    statement(db, 'SELECT count(*) AS n FROM bookmarks WHERE owner_id = ? AND deleted_at IS NULL', ownerId),
  ]);
  const count = Number(snapshot[3]!.results[0]!.n);
  if (snapshot.slice(0, 3).some(result => result.results.length > MAX_TRANSFER_BOOKMARKS) || snapshot[2]!.results.length !== count) {
    throw new AppError('TRANSFER_LIMIT', '单次导出最多 5000 条收藏、5000 个分组或标签，且文件不超过 10 MiB。', 413);
  }
  const groups = new Map(snapshot[0]!.results.map(row => [String(row.id), String(row.name)]));
  const tags = new Map(snapshot[1]!.results.map(row => [String(row.id), String(row.name)]));
  const document: TransferDocument = { format: 'luypage', version: 1, exportedAt: new Date().toISOString(), groups: [...groups.values()], tags: [...tags.values()],
    bookmarks: snapshot[2]!.results.map(raw => {
      const item = bookmarkDto(raw as unknown as BookmarkRow);
      return { url: item.url, title: item.title, note: item.note, pinned: item.pinned, icon: item.icon,
        group: item.groupId ? groups.get(item.groupId)! : null, tags: item.tagIds.map(id => tags.get(id)!), createdAt: item.createdAt, updatedAt: item.updatedAt };
    }) };
  if (new TextEncoder().encode(JSON.stringify(document)).length > MAX_TRANSFER_BYTES) throw new AppError('TRANSFER_LIMIT', '导出文件超过 10 MiB。', 413);
  return document;
}
