import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { DEFAULT_PREFERENCES, DEFAULT_HOMEPAGE_PREFERENCES, type LayoutPreferences, type HomepagePreferences } from '@luypage/contracts';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), createdAt: text('created_at').notNull(),
});
export const authIdentities = sqliteTable('auth_identities', {
  provider: text('provider').notNull(), issuer: text('issuer').notNull(), subject: text('subject').notNull(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
}, t => [primaryKey({ columns: [t.provider, t.issuer, t.subject] }), index('auth_identities_owner').on(t.ownerId)]);
export const workspaceState = sqliteTable('workspace_state', {
  ownerId: text('owner_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  dataRevision: integer('data_revision').notNull().default(0),
  preferences: text('preferences', { mode: 'json' }).$type<LayoutPreferences>().notNull().default(DEFAULT_PREFERENCES),
  homepagePreferences: text('homepage_preferences', { mode: 'json' }).$type<HomepagePreferences>().notNull().default(DEFAULT_HOMEPAGE_PREFERENCES),
}, t => [check('revision_nonnegative', sql`${t.dataRevision} >= 0`), check('preferences_json', sql`json_valid(${t.preferences})`), check('homepage_preferences_json', sql`json_valid(${t.homepagePreferences})`)]);
export const groups = sqliteTable('groups', {
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  id: text('id').notNull(), name: text('name').notNull(), nameKey: text('name_key').notNull(),
  position: integer('position').notNull(), createdAt: text('created_at').notNull(), version: integer('version').notNull().default(1),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), unique().on(t.ownerId, t.nameKey),
  index('groups_order').on(t.ownerId, t.position, t.id), check('group_version_positive', sql`${t.version} > 0`),
  check('group_position_safe', sql`${t.position} BETWEEN 0 AND 9007199254740991`)]);
export const tags = sqliteTable('tags', {
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  id: text('id').notNull(), name: text('name').notNull(), nameKey: text('name_key').notNull(),
  createdAt: text('created_at').notNull(), version: integer('version').notNull().default(1),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), unique().on(t.ownerId, t.nameKey), check('tag_version_positive', sql`${t.version} > 0`)]);
export const bookmarks = sqliteTable('bookmarks', {
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }), id: text('id').notNull(),
  url: text('url').notNull(), normalizedUrl: text('normalized_url').notNull(), title: text('title').notNull(),
  titleKey: text('title_key').notNull(), note: text('note').notNull(), searchKey: text('search_key').notNull(), groupId: text('group_id'),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false), position: integer('position').notNull(),
  pinnedPosition: integer('pinned_position').notNull(), iconType: text('icon_type', { enum: ['auto', 'builtin'] }).notNull(), iconKey: text('icon_key'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
  version: integer('version').notNull().default(1),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), unique().on(t.ownerId, t.normalizedUrl),
  foreignKey({ columns: [t.ownerId, t.groupId], foreignColumns: [groups.ownerId, groups.id] }),
  index('bookmarks_group_order').on(t.ownerId, t.deletedAt, t.groupId, t.position, t.id),
  index('bookmarks_pinned_order').on(t.ownerId, t.deletedAt, t.pinned, t.pinnedPosition, t.id),
  index('bookmarks_created').on(t.ownerId, t.deletedAt, t.pinned, t.createdAt, t.id),
  index('bookmarks_updated').on(t.ownerId, t.deletedAt, t.pinned, t.updatedAt, t.id),
  index('bookmarks_title').on(t.ownerId, t.deletedAt, t.pinned, t.titleKey, t.id),
  check('bookmark_version_positive', sql`${t.version} > 0`), check('pinned_boolean', sql`${t.pinned} IN (0, 1)`),
  check('icon_type_valid', sql`${t.iconType} IN ('auto', 'builtin')`),
  check('bookmark_position_safe', sql`${t.position} BETWEEN 0 AND 9007199254740991`),
  check('pinned_position_safe', sql`${t.pinnedPosition} BETWEEN 0 AND 9007199254740991`)]);
export const bookmarkTags = sqliteTable('bookmark_tags', {
  ownerId: text('owner_id').notNull(), bookmarkId: text('bookmark_id').notNull(), tagId: text('tag_id').notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.bookmarkId, t.tagId] }),
  foreignKey({ columns: [t.ownerId, t.bookmarkId], foreignColumns: [bookmarks.ownerId, bookmarks.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.ownerId, t.tagId], foreignColumns: [tags.ownerId, tags.id] }).onDelete('cascade'),
  index('bookmark_tags_tag').on(t.ownerId, t.tagId, t.bookmarkId)]);
export const mutationReceipts = sqliteTable('mutation_receipts', {
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }), operationId: text('operation_id').notNull(),
  requestHash: text('request_hash').notNull(), responseJson: text('response_json').notNull(), createdAt: text('created_at').notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.operationId] }), check('receipt_json', sql`json_valid(${t.responseJson})`)]);
export const mutationGuards = sqliteTable('mutation_guards', {
  id: text('id').primaryKey(), passed: integer('passed').notNull(),
}, t => [check('guard_passed', sql`${t.passed} = 1`)]);
