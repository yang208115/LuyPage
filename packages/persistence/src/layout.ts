import { DEFAULT_PREFERENCES, type LayoutIndex, type LayoutSaveInput, type MutationResult } from '@luypage/contracts';
import { applyLayoutOperations } from '@luypage/domain';
import { conflict, mutate, statement } from './database';
import { getLayoutSnapshot, type LayoutSnapshot } from './queries';

const creationOrder = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function defaultIndex(snapshot: LayoutSnapshot): LayoutIndex {
  const ordered = [...snapshot.bookmarks].sort(creationOrder);
  const groupOrder = [...snapshot.groups].sort(creationOrder).map(g => g.id);
  return { revision: snapshot.index.revision, groupOrder,
    groups: [...groupOrder, null].map(groupId => ({ groupId, bookmarkIds: ordered.filter(b => b.group_id === groupId).map(b => b.id) })),
    pinnedOrder: ordered.filter(b => b.pinned).map(b => b.id),
    preferences: { ...DEFAULT_PREFERENCES, collapsedGroupIds: [], autoIcons: snapshot.index.preferences.autoIcons } };
}

export async function getDefaultLayoutIndex(db: D1Database, ownerId: string): Promise<LayoutIndex> {
  return defaultIndex(await getLayoutSnapshot(db, ownerId));
}

export async function saveLayout(db: D1Database, ownerId: string, input: LayoutSaveInput): Promise<MutationResult<LayoutIndex>> {
  return mutate(db, ownerId, input.operationId, ['layout.save', input], async state => {
    const snapshot = await getLayoutSnapshot(db, ownerId);
    if (snapshot.index.revision !== state.data_revision) throw conflict();
    let next: LayoutIndex;
    if (input.reset) next = defaultIndex(snapshot);
    else next = applyLayoutOperations(snapshot.index, input.operations, input.preferences);
    const bookmarks = new Map(snapshot.bookmarks.map(b => [b.id, b]));
    const groups = new Map(snapshot.groups.map(g => [g.id, g]));
    const pins = new Map(next.pinnedOrder.map((id, index) => [id, (index + 1) * 1024]));
    const bookmarkChanges: { id: string; groupId: string | null; position: number; pinnedPosition: number }[] = [];
    for (const group of next.groups) for (let i = 0; i < group.bookmarkIds.length; i++) {
      const id = group.bookmarkIds[i]!;
      const current = bookmarks.get(id)!;
      const position = (i + 1) * 1024;
      const pinnedPosition = pins.get(id) ?? current.pinned_position;
      if (current.group_id !== group.groupId || current.position !== position || current.pinned_position !== pinnedPosition) {
        bookmarkChanges.push({ id, groupId: group.groupId, position, pinnedPosition });
      }
    }
    const groupChanges = next.groupOrder.map((id, i) => ({ id, position: (i + 1) * 1024 })).filter(g => groups.get(g.id)!.position !== g.position);
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < bookmarkChanges.length; i += 200) {
      const chunk = JSON.stringify(bookmarkChanges.slice(i, i + 200));
      statements.push(statement(db, `WITH changes AS (SELECT value FROM json_each(?)) UPDATE bookmarks SET
        group_id = json_extract(c.value, '$.groupId'), position = json_extract(c.value, '$.position'),
        pinned_position = json_extract(c.value, '$.pinnedPosition'), version = version + 1, updated_at = ?
        FROM changes c WHERE owner_id = ? AND id = json_extract(c.value, '$.id') AND deleted_at IS NULL`, chunk, now, ownerId));
    }
    for (let i = 0; i < groupChanges.length; i += 200) {
      statements.push(statement(db, `WITH changes AS (SELECT value FROM json_each(?)) UPDATE groups SET
        position = json_extract(c.value, '$.position'), version = version + 1 FROM changes c WHERE owner_id = ? AND id = json_extract(c.value, '$.id')`, JSON.stringify(groupChanges.slice(i, i + 200)), ownerId));
    }
    statements.push(statement(db, 'UPDATE workspace_state SET preferences = ? WHERE owner_id = ?', JSON.stringify(next.preferences), ownerId));
    next.revision = state.data_revision + 1;
    return { statements, result: { data: next, revision: next.revision } };
  }, input.baseRevision);
}
