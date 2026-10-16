import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { createMiddleware } from 'hono/factory';
import { createApp } from '../../apps/api/src/app';
import type { AppEnv } from '../../apps/api/src/context';
import { ensureIdentity } from '@luypage/persistence';
import { transferDocumentSchema, type Bootstrap, type BookmarkPage, type ImportResult, type TransferDocument } from '@luypage/contracts';

const app = createApp(createMiddleware<AppEnv>(async (c, next) => {
  c.set('ownerId', c.req.header('X-Test-Owner')!); c.set('displayName', 'test'); c.set('isLocal', true); await next();
}));
const owner = () => ensureIdentity(env.DB, { provider: 'transfer-test', issuer: 'test', subject: crypto.randomUUID(), displayName: 'test' });
const request = (id: string, path: string, method = 'GET', body?: unknown) => app.request(`http://localhost/api${path}`, {
  method, headers: { 'X-Test-Owner': id, Origin: env.APP_ORIGIN, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}, env);
const document = () => transferDocumentSchema.parse({ format: 'luypage', version: 1, groups: ['研发', '空分组'], tags: ['TypeScript'], bookmarks: [
  { url: 'https://example.com/path?secret=private', title: '<示例> & 文档', note: '多行\n备注', group: '研发', tags: ['TypeScript'], pinned: true, createdAt: '2020-01-01T00:00:00.000Z', icon: { type: 'builtin', key: 'code' } },
  { url: 'https://www.cloudflare.com/docs', title: 'Cloudflare' },
] });

describe('bookmark transfers and automatic icons', () => {
  it('supports the advertised 5000 bookmarks and rejects larger files before writing', async () => {
    const id = await owner();
    const doc = transferDocumentSchema.parse({ format: 'luypage', version: 1, bookmarks: Array.from({ length: 5000 }, (_, index) => ({ url: `https://example.com/${index}`, title: `收藏 ${index}`, group: '容量测试', tags: ['测试'] })) });
    const response = await request(id, '/imports', 'POST', { operationId: crypto.randomUUID(), document: doc });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 5000, skipped: 0 });
    expect((await (await request(id, '/exports')).json<TransferDocument>()).bookmarks).toHaveLength(5000);
    expect((await request(id, '/imports', 'POST', { operationId: crypto.randomUUID(), document: { ...doc, bookmarks: [...doc.bookmarks, { url: 'https://example.com/extra' }] } })).status).toBe(422);
  });
  it('imports atomically, replays receipts, merges collections and round-trips active metadata across accounts', async () => {
    const alice = await owner(); const bob = await owner(); const input = { operationId: crypto.randomUUID(), document: document() };
    const first = await request(alice, '/imports', 'POST', input); expect(first.status).toBe(200);
    const result = await first.json<ImportResult>(); expect(result).toMatchObject({ imported: 2, skipped: 0 });
    expect(await (await request(alice, '/imports', 'POST', input)).json()).toEqual(result);
    expect(await (await request(alice, '/imports', 'POST', { ...input, operationId: crypto.randomUUID() })).json()).toMatchObject({ imported: 0, skipped: 2 });
    const exported = await (await request(alice, '/exports')).json<TransferDocument>();
    expect(exported.bookmarks).toEqual(expect.arrayContaining(input.document.bookmarks.map(item => expect.objectContaining(item))));
    expect(exported.groups).toEqual(['研发', '空分组']);
    expect((await (await request(bob, '/exports')).json<TransferDocument>()).bookmarks).toEqual([]);
    expect((await request(bob, '/imports', 'POST', { operationId: crypto.randomUUID(), document: exported })).status).toBe(200);
    expect((await (await request(bob, '/exports')).json<TransferDocument>()).bookmarks).toEqual(expect.arrayContaining(exported.bookmarks));
    const bootstrap = await (await request(alice, '/bootstrap')).json<Bootstrap>();
    expect(bootstrap.groups).toHaveLength(2); expect(bootstrap.tags).toHaveLength(1);
    const page = await (await request(alice, '/bookmarks')).json<BookmarkPage>(); const item = page.items[0]!;
    await request(alice, `/bookmarks/${item.id}/trash`, 'POST', { operationId: crypto.randomUUID(), version: item.version });
    expect(await (await request(alice, '/imports', 'POST', { ...input, operationId: crypto.randomUUID() })).json()).toMatchObject({ imported: 0, skipped: 2 });
    expect((await (await request(alice, '/exports')).json<TransferDocument>()).bookmarks).toHaveLength(1);
  });
  it('rejects invalid data before writing, skips duplicates within a file and protects idempotency keys', async () => {
    const id = await owner(); const doc = document(); const operationId = crypto.randomUUID();
    expect((await request(id, '/imports', 'POST', { operationId, document: { ...doc, bookmarks: [...doc.bookmarks, { url: 'javascript:alert(1)' }] } })).status).toBe(422);
    expect((await (await request(id, '/bootstrap')).json<Bootstrap>()).groups).toHaveLength(0);
    expect(await (await request(id, '/imports', 'POST', { operationId, document: { ...doc, bookmarks: [...doc.bookmarks, doc.bookmarks[0]] } })).json()).toMatchObject({ imported: 2, skipped: 1 });
    expect((await request(id, '/imports', 'POST', { operationId, document: doc })).status).toBe(409);
  });
  it('rolls back collections and bookmarks when a database constraint fails', async () => {
    const id = await owner();
    await env.DB.prepare("CREATE TRIGGER fail_transfer BEFORE INSERT ON bookmarks WHEN NEW.title = 'force-transfer-failure' BEGIN SELECT RAISE(ABORT, 'test'); END").run();
    try {
      const doc = document(); doc.bookmarks[1]!.title = 'force-transfer-failure';
      expect((await request(id, '/imports', 'POST', { operationId: crypto.randomUUID(), document: doc })).status).toBe(503);
      const state = await (await request(id, '/bootstrap')).json<Bootstrap>();
      expect(state.groups).toHaveLength(0); expect(state.tags).toHaveLength(0); expect(state.counts.active).toBe(0);
    } finally { await env.DB.prepare('DROP TRIGGER fail_transfer').run(); }
  });
  it('gates icon network requests by owner, preference and icon choice; sends only the domain', async () => {
    const alice = await owner(); const bob = await owner();
    await request(alice, '/imports', 'POST', { operationId: crypto.randomUUID(), document: document() });
    const page = await (await request(alice, '/bookmarks')).json<BookmarkPage>();
    const automatic = page.items.find(item => item.icon.type === 'auto')!;
    const builtin = page.items.find(item => item.icon.type === 'builtin')!;
    const png = new Uint8Array(24); png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(png, { headers: { 'Content-Type': 'image/png' } }));
    try {
      expect((await request(alice, `/bookmarks/${automatic.id}/icon`)).status).toBe(404); expect(mock).not.toHaveBeenCalled();
      for (const id of [alice, bob]) await env.DB.prepare("UPDATE workspace_state SET preferences = json_set(preferences, '$.autoIcons', json('true')) WHERE owner_id = ?").bind(id).run();
      expect((await request(bob, `/bookmarks/${automatic.id}/icon`)).status).toBe(404);
      expect((await request(alice, `/bookmarks/${builtin.id}/icon`)).status).toBe(404); expect(mock).not.toHaveBeenCalled();
      const response = await request(alice, `/bookmarks/${automatic.id}/icon`); expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(mock.mock.calls[0]?.[0]).toBe('https://icons.duckduckgo.com/ip3/www.cloudflare.com.ico');
      expect(mock.mock.calls[0]?.[1]?.redirect).toBe('manual');
    } finally { mock.mockRestore(); }
  });
});
