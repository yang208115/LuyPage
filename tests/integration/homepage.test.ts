import { defaultHomepageProfile, placeHomepageTile } from '@luypage/domain';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createMiddleware } from 'hono/factory';
import { DEFAULT_HOMEPAGE_PREFERENCES, type Bookmark, type Homepage, type HomepagePreferences, type LayoutIndex, type MutationResult, type HomepageLayout, type BookmarkPage } from '@luypage/contracts';
import { ensureIdentity } from '@luypage/persistence';
import { createApp } from '../../apps/api/src/app';
import type { AppEnv } from '../../apps/api/src/context';

const app = createApp(createMiddleware<AppEnv>(async (c, next) => {
  c.set('ownerId', c.req.header('X-Test-Owner')!); c.set('displayName', '主页测试'); c.set('isLocal', false); await next();
}));
const owner = () => ensureIdentity(env.DB, { provider: 'homepage-test', issuer: 'https://identity.test', subject: crypto.randomUUID(), displayName: '主页测试' });
const request = (ownerId: string, path: string, method = 'GET', body?: unknown) => app.fetch(new Request(`http://localhost/api${path}`, {
  method, headers: { 'X-Test-Owner': ownerId, Origin: env.APP_ORIGIN, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
}), env);
async function json<T>(ownerId: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await request(ownerId, path, method, body);
  expect(response.ok, await response.clone().text()).toBe(true);
  return response.json() as Promise<T>;
}
async function add(ownerId: string, groupId: string | null, index: number) {
  return (await json<MutationResult<Bookmark>>(ownerId, '/bookmarks', 'POST', {
    operationId: crypto.randomUUID(), url: `https://example.test/${crypto.randomUUID()}`, title: `网站 ${index}`, note: '不应传入主页摘要的私有备注', groupId, pinned: index % 2 === 0,
    tagIds: [], icon: { type: 'builtin', key: 'book' },
  })).data;
}
const saveInput = (revision: number, preferences: HomepagePreferences = { ...DEFAULT_HOMEPAGE_PREFERENCES, wallpaperId: 'blue-lake' }) => ({ operationId: crypto.randomUUID(), baseRevision: revision, preferences });

describe('homepage D1 API', () => {
  it('returns ordered bounded folder previews and excludes trash and private notes', async () => {
    const user = await owner();
    const group = (await json<MutationResult<{ id: string }>>(user, '/groups', 'POST', { operationId: crypto.randomUUID(), name: '书房' })).data;
    const books: Bookmark[] = [];
    for (let i = 0; i < 7; i++) books.push(await add(user, group.id, i));
    await add(user, null, 99);
    await json(user, `/bookmarks/${books[0]!.id}/trash`, 'POST', { operationId: crypto.randomUUID(), version: books[0]!.version });
    const home = await json<Homepage>(user, '/homepage');
    expect(home.preferences).toEqual(DEFAULT_HOMEPAGE_PREFERENCES);
    expect(home.counts).toEqual({ active: 7, pinned: 3 });
    expect(home.folders.map(folder => folder.id)).toEqual([group.id, null]);
    expect(home.folders[0]!.count).toBe(6);
    expect(home.folders[0]!.preview.map(book => book.id)).toEqual(books.slice(1, 5).map(book => book.id));
    expect(home.folders[1]!.count).toBe(1);
    expect(JSON.stringify(home)).not.toContain('私有备注');
    expect(Object.keys(home.folders[0]!.preview[0]!).sort()).toEqual(['icon', 'id', 'title', 'url']);
    const other = await owner();
    const otherHome = await json<Homepage>(other, '/homepage');
    expect(otherHome.counts.active).toBe(0);
    expect(otherHome.folders).toEqual([{ id: null, name: '未分组', count: 0, preview: [] }]);
  });

  it('saves preferences atomically with receipts and rejects stale or changed requests', async () => {
    const user = await owner();
    const body = saveInput(0);
    const first = await json<MutationResult<HomepagePreferences>>(user, '/homepage/preferences', 'PUT', body);
    expect(first).toEqual({ data: body.preferences, revision: 1 });
    expect(await json(user, '/homepage/preferences', 'PUT', body)).toEqual(first);
    expect((await request(user, '/homepage/preferences', 'PUT', { ...body, preferences: { ...body.preferences, showClock: false } })).status).toBe(409);
    expect((await request(user, '/homepage/preferences', 'PUT', saveInput(0))).status).toBe(409);
    const home = await json<Homepage>(user, '/homepage');
    expect(home.preferences.wallpaperId).toBe('blue-lake');
    expect(home.revision).toBe(1);
    const other = await owner();
    expect((await json<Homepage>(other, '/homepage')).preferences).toEqual(DEFAULT_HOMEPAGE_PREFERENCES);
  });

  it('rejects unrecognized preferences and keeps existing bookmark layout independent', async () => {
    const user = await owner();
    const book = await add(user, null, 0);
    const before = await json<LayoutIndex>(user, '/layout/index');
    await json(user, '/homepage/preferences', 'PUT', saveInput(before.revision));
    const after = await json<LayoutIndex>(user, '/layout/index');
    expect({ ...after, revision: before.revision }).toEqual(before);
    expect(await json<Bookmark>(user, `/bookmarks/${book.id}`)).toEqual(book);
    const reset = await json<MutationResult<LayoutIndex>>(user, '/layout', 'PUT', { operationId: crypto.randomUUID(), baseRevision: after.revision, operations: [], preferences: after.preferences, reset: true });
    expect((await json<Homepage>(user, '/homepage')).preferences.wallpaperId).toBe('blue-lake');
    for (const invalid of [{ wallpaperId: 'https://third-party.test/image' }, { searchProvider: 'javascript:alert(1)' }, { showClock: 'yes' }, { arbitrary: true }]) {
      expect((await request(user, '/homepage/preferences', 'PUT', { ...saveInput(reset.revision), preferences: { ...DEFAULT_HOMEPAGE_PREFERENCES, ...invalid } })).status).toBe(422);
    }
  });

  it('enforces origin checks on preference writes', async () => {
    const user = await owner();
    const response = await app.fetch(new Request('http://localhost/api/homepage/preferences', { method: 'PUT', headers: { 'X-Test-Owner': user, Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: JSON.stringify(saveInput(0)) }), env);
    expect(response.status).toBe(403);
    expect((await json<Homepage>(user, '/homepage')).revision).toBe(0);
  });
});


describe('homepage layout persistence', () => {
  it('saves separate device profiles, replays receipts and preserves the library layout', async () => {
    const user = await owner();
    const a = await add(user, null, 0); const b = await add(user, null, 2);
    const before = await json<LayoutIndex>(user, '/layout/index');
    const profile = defaultHomepageProfile('desktop', ['ungrouped'], [b.id, a.id]);
    const body = { operationId: crypto.randomUUID(), baseRevision: before.revision, device: 'desktop', profile };
    const saved = await json<MutationResult<HomepageLayout>>(user, '/homepage/layout', 'PUT', body);
    expect(saved.data.desktop).toEqual(profile); expect(saved.data.mobile).toBeNull();
    expect(await json(user, '/homepage/layout', 'PUT', body)).toEqual(saved);
    expect((await request(user, '/homepage/layout', 'PUT', { ...body, operationId: crypto.randomUUID() })).status).toBe(409);
    const mobile = defaultHomepageProfile('mobile', ['ungrouped'], [a.id, b.id]);
    await json(user, '/homepage/layout', 'PUT', { ...body, operationId: crypto.randomUUID(), baseRevision: saved.revision, device: 'mobile', profile: mobile });
    const home = await json<Homepage>(user, '/homepage');
    expect(home.layout).toEqual({ version: 1, desktop: profile, mobile });
    const after = await json<LayoutIndex>(user, '/layout/index');
    expect({ ...after, revision: before.revision }).toEqual(before);
    expect(await json(user, `/bookmarks/${a.id}`)).toEqual(a);
    const first = await json<BookmarkPage>(user, '/bookmarks?pinned=true&homepageDevice=desktop&limit=1');
    expect(first.items.map(item => item.id)).toEqual([b.id]);
    const second = await json<BookmarkPage>(user, `/bookmarks?pinned=true&homepageDevice=desktop&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items.map(item => item.id)).toEqual([a.id]);
    expect((await json<BookmarkPage>(user, '/bookmarks?pinned=true&homepageDevice=mobile')).items.map(item => item.id)).toEqual([a.id, b.id]);
    expect((await json<BookmarkPage>(user, '/bookmarks?pinned=true')).items.map(item => item.id)).toEqual([a.id, b.id]);
    expect((await json<Homepage>(await owner(), '/homepage')).layout).toEqual({ version: 1, desktop: null, mobile: null });
  });
  it('rejects foreign references, overlapping tiles, missing widgets and invalid profiles without mutation', async () => {
    const user = await owner(); const other = await owner(); const foreign = await add(other, null, 0);
    const profile = defaultHomepageProfile('desktop', [], []);
    const save = (next: typeof profile) => request(user, '/homepage/layout', 'PUT', { operationId: crypto.randomUUID(), baseRevision: 0, device: 'desktop', profile: next });
    expect((await save({ ...profile, pinnedOrder: [foreign.id] })).status).toBe(409);
    expect((await save({ ...profile, items: [...profile.items, { id: 'folder:foreign', x: 0, y: 50, w: 3, h: 3 }] })).status).toBe(409);
    expect((await save({ ...profile, items: profile.items.map(item => ({ ...item, x: 0, y: 0 })) })).status).toBe(422);
    expect((await save({ ...profile, items: profile.items.slice(1) })).status).toBe(422);
    expect((await json<Homepage>(user, '/homepage')).revision).toBe(0);
  });
});
