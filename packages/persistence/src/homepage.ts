import { homepagePreferencesSchema, homepageLayoutSchema, type Homepage, type HomepagePreferences, type HomepageSaveInput, type HomepageShortcut, type MutationResult } from '@luypage/contracts';
import { missing, mutate, statement } from './database';
import { groupsQuery, type GroupRow } from './queries';

interface PreviewRow {
  id: string; title: string; url: string; group_id: string | null; icon_type: 'auto' | 'builtin'; icon_key: string | null;
}

export async function getHomepage(db: D1Database, ownerId: string): Promise<Homepage> {
  // One snapshot and a bounded projection: no per-folder queries or private notes.
  const results = await db.batch([
    statement(db, 'SELECT data_revision, homepage_preferences, homepage_layout FROM workspace_state WHERE owner_id = ?', ownerId),
    statement(db, groupsQuery, ownerId),
    statement(db, `SELECT count(*) AS active, count(CASE WHEN pinned = 1 THEN 1 END) AS pinned,
      count(CASE WHEN group_id IS NULL THEN 1 END) AS ungrouped
      FROM bookmarks WHERE owner_id = ? AND deleted_at IS NULL`, ownerId),
    statement(db, `SELECT id, title, url, group_id, icon_type, icon_key FROM (
      SELECT id, title, url, group_id, icon_type, icon_key,
        row_number() OVER (PARTITION BY group_id ORDER BY position, id) AS slot
      FROM bookmarks WHERE owner_id = ? AND deleted_at IS NULL
    ) WHERE slot <= 4 ORDER BY group_id, slot`, ownerId),
    statement(db, 'SELECT id FROM bookmarks WHERE owner_id = ? AND pinned = 1 AND deleted_at IS NULL ORDER BY pinned_position, id', ownerId),
  ]);
  const state = results[0]!.results[0] as { data_revision: number; homepage_preferences: string; homepage_layout: string } | undefined;
  if (!state) throw missing();
  const groups = results[1]!.results as unknown as GroupRow[];
  const counts = results[2]!.results[0] as { active: number; pinned: number; ungrouped: number };
  const previews = new Map<string | null, HomepageShortcut[]>();
  for (const row of results[3]!.results as unknown as PreviewRow[]) {
    const items = previews.get(row.group_id) ?? [];
    items.push({ id: row.id, title: row.title, url: row.url, icon: { type: row.icon_type, key: row.icon_key } });
    previews.set(row.group_id, items);
  }
  return {
    layout: homepageLayoutSchema.parse(JSON.parse(state.homepage_layout)),
    pinnedIds: results[4]!.results.map(row => (row as { id: string }).id),
    revision: state.data_revision, preferences: homepagePreferencesSchema.parse(JSON.parse(state.homepage_preferences)),
    counts: { active: counts.active, pinned: counts.pinned },
    folders: [...groups.map(group => ({ id: group.id, name: group.name, count: group.count, preview: previews.get(group.id) ?? [] })),
      { id: null, name: '未分组', count: counts.ungrouped, preview: previews.get(null) ?? [] }],
  };
}

export async function saveHomepagePreferences(db: D1Database, ownerId: string, input: HomepageSaveInput): Promise<MutationResult<HomepagePreferences>> {
  return mutate(db, ownerId, input.operationId, ['homepage.preferences', input], async state => {
    // Older clients omit newer widgets; preserve those saved preferences on their writes.
    const row = await statement(db, 'SELECT homepage_preferences FROM workspace_state WHERE owner_id = ?', ownerId).first<{ homepage_preferences: string }>();
    if (!row) throw missing();
    const previous = homepagePreferencesSchema.parse(JSON.parse(row.homepage_preferences));
    const preferences = homepagePreferencesSchema.parse({ ...input.preferences, tileAppearance: input.preferences.tileAppearance ?? previous.tileAppearance,
      showWeather: input.preferences.showWeather ?? previous.showWeather,
      shortcutIconSize: input.preferences.shortcutIconSize ?? previous.shortcutIconSize,
      weatherLocation: input.preferences.weatherLocation === undefined ? previous.weatherLocation : input.preferences.weatherLocation });
    return {
      statements: [statement(db, 'UPDATE workspace_state SET homepage_preferences = ? WHERE owner_id = ?', JSON.stringify(preferences), ownerId)],
      result: { data: preferences, revision: state.data_revision + 1 },
    };
  }, input.baseRevision);
}
