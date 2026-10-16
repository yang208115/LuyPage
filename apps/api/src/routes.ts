import type { Hono } from 'hono';
import {
  AppError, batchInputSchema, createBookmarkSchema, idSchema, layoutSaveSchema, nameInputSchema,
  updateBookmarkSchema, versionInputSchema, homepageSaveSchema, homepageLayoutSaveSchema, type BookmarkQuery,
} from '@luypage/contracts';
import {
  batchBookmarks, bookmarkDto, changeBookmarkState, collectionImpact, createBookmark, deleteCollection, findBookmark,
  getBootstrap, getDefaultLayoutIndex, getLayoutIndex, listBookmarks, saveCollection, saveLayout, updateBookmark, getHomepage, saveHomepagePreferences, saveHomepageLayout,
} from '@luypage/persistence';
import type { AppEnv } from './context';

function parseQuery(values: Record<string, string>): BookmarkQuery {
  if (values.pinned !== undefined && !['true', 'false'].includes(values.pinned)) throw new AppError('VALIDATION_ERROR', '置顶筛选必须为 true 或 false。');
  const query: BookmarkQuery = {};
  if (values.homepageDevice !== undefined) {
    if (!['desktop', 'mobile'].includes(values.homepageDevice)) throw new AppError('VALIDATION_ERROR', '主页设备类型无效。');
    query.homepageDevice = values.homepageDevice as BookmarkQuery['homepageDevice'];
  }
  if (values.q !== undefined) query.q = values.q;
  if (values.groupId !== undefined) query.groupId = values.groupId === 'ungrouped' ? 'ungrouped' : idSchema.parse(values.groupId);
  if (values.tagIds !== undefined) query.tagIds = values.tagIds ? values.tagIds.split(',').map(id => idSchema.parse(id)) : [];
  if (values.pinned !== undefined) query.pinned = values.pinned === 'true';
  if (values.sort !== undefined) {
    if (!['manual', 'created', 'updated', 'title'].includes(values.sort)) throw new AppError('VALIDATION_ERROR', '排序方式无效。');
    query.sort = values.sort as BookmarkQuery['sort'];
  }
  if (values.limit !== undefined) query.limit = Number(values.limit);
  if (values.cursor !== undefined) query.cursor = values.cursor;
  return query;
}

export function registerRoutes(app: Hono<AppEnv>): void {
  app.put('/api/homepage/layout', async c => c.json(await saveHomepageLayout(c.env.DB, c.get('ownerId'), homepageLayoutSaveSchema.parse(await c.req.json()))));
  app.get('/api/homepage', async c => c.json(await getHomepage(c.env.DB, c.get('ownerId'))));
  app.put('/api/homepage/preferences', async c => c.json(await saveHomepagePreferences(c.env.DB, c.get('ownerId'), homepageSaveSchema.parse(await c.req.json()))));
  app.get('/api/bootstrap', async c => c.json(await getBootstrap(c.env.DB, c.get('ownerId'))));
  app.get('/api/bookmarks', async c => c.json(await listBookmarks(c.env.DB, c.get('ownerId'), parseQuery(c.req.query()))));
  app.get('/api/trash', async c => c.json(await listBookmarks(c.env.DB, c.get('ownerId'), parseQuery(c.req.query()), true)));
  app.get('/api/bookmarks/:id', async c => {
    const row = await findBookmark(c.env.DB, c.get('ownerId'), idSchema.parse(c.req.param('id')));
    if (!row || row.deleted_at) throw new AppError('NOT_FOUND', '找不到该收藏。', 404);
    return c.json(bookmarkDto(row));
  });
  app.post('/api/bookmarks', async c => c.json(await createBookmark(c.env.DB, c.get('ownerId'), createBookmarkSchema.parse(await c.req.json())), 201));
  app.patch('/api/bookmarks/:id', async c => c.json(await updateBookmark(c.env.DB, c.get('ownerId'), idSchema.parse(c.req.param('id')), updateBookmarkSchema.parse(await c.req.json()))));
  app.post('/api/bookmarks/batch', async c => c.json(await batchBookmarks(c.env.DB, c.get('ownerId'), batchInputSchema.parse(await c.req.json()))));
  app.post('/api/bookmarks/:id/trash', async c => c.json(await changeBookmarkState(c.env.DB, c.get('ownerId'), idSchema.parse(c.req.param('id')), versionInputSchema.parse(await c.req.json()), 'trash')));
  app.post('/api/trash/:id/restore', async c => c.json(await changeBookmarkState(c.env.DB, c.get('ownerId'), idSchema.parse(c.req.param('id')), versionInputSchema.parse(await c.req.json()), 'restore')));
  app.delete('/api/trash/:id', async c => c.json(await changeBookmarkState(c.env.DB, c.get('ownerId'), idSchema.parse(c.req.param('id')), versionInputSchema.parse(await c.req.json()), 'delete')));
  for (const collection of ['groups', 'tags'] as const) {
    app.get(`/api/${collection}`, async c => c.json((await getBootstrap(c.env.DB, c.get('ownerId')))[collection]));
    app.get(`/api/${collection}/:id/impact`, async c => c.json(await collectionImpact(c.env.DB, c.get('ownerId'), collection, idSchema.parse(c.req.param('id')))));
    app.post(`/api/${collection}`, async c => c.json(await saveCollection(c.env.DB, c.get('ownerId'), collection, nameInputSchema.parse(await c.req.json())), 201));
    app.patch(`/api/${collection}/:id`, async c => {
      const input = nameInputSchema.parse(await c.req.json());
      if (input.version === undefined) throw new AppError('VALIDATION_ERROR', '编辑时必须提供版本。');
      return c.json(await saveCollection(c.env.DB, c.get('ownerId'), collection, input, idSchema.parse(c.req.param('id'))));
    });
    app.delete(`/api/${collection}/:id`, async c => c.json(await deleteCollection(c.env.DB, c.get('ownerId'), collection, idSchema.parse(c.req.param('id')), versionInputSchema.parse(await c.req.json()))));
  }
  app.get('/api/layout/index', async c => c.json(await getLayoutIndex(c.env.DB, c.get('ownerId'))));
  app.get('/api/layout/default-preview', async c => c.json(await getDefaultLayoutIndex(c.env.DB, c.get('ownerId'))));
  app.put('/api/layout', async c => c.json(await saveLayout(c.env.DB, c.get('ownerId'), layoutSaveSchema.parse(await c.req.json()))));
}
