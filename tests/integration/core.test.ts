import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createMiddleware } from 'hono/factory';
import { createApp } from '../../apps/api/src/app';
import type { AppEnv } from '../../apps/api/src/context';
import { ensureIdentity } from '@luypage/persistence';
import { DEFAULT_PREFERENCES, type ApiErrorBody, type BatchResult, type Bookmark, type BookmarkPage, type Bootstrap,
  type CreateBookmarkInput, type Group, type LayoutIndex, type LayoutSaveInput, type MutationResult, type Tag } from '@luypage/contracts';

const app = createApp(createMiddleware<AppEnv>(async (c, next) => {
  const ownerId = c.req.header('X-Test-Owner');
  if (!ownerId) throw new Error('test owner missing');
  c.set('ownerId', ownerId); c.set('displayName', '测试用户'); c.set('isLocal', false);
  await next();
}));
const operationId = () => crypto.randomUUID();
const identity = (subject = operationId()) => ({ provider: 'core-test', issuer: 'https://identity.test', subject, displayName: 'same@example.test' });
const owner = () => ensureIdentity(env.DB, identity());
const request = (ownerId: string, path: string, method = 'GET', body?: unknown) => app.fetch(new Request(`http://localhost/api${path}`, {
  method, headers: { 'X-Test-Owner': ownerId, Origin: env.APP_ORIGIN, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), env);
async function json<T>(ownerId: string, path: string, method = 'GET', body?: unknown, status = 200): Promise<T> {
  const response = await request(ownerId, path, method, body);
  const result: unknown = await response.json();
  expect(response.status, JSON.stringify(result)).toBe(status);
  return result as T;
}
const input = (extra: Partial<CreateBookmarkInput> = {}): CreateBookmarkInput => ({
  operationId: operationId(), url: `https://example.test/${operationId()}`, title: '', note: '', groupId: null, tagIds: [], pinned: false, icon: { type: 'auto', key: null }, ...extra,
});
const add = (ownerId: string, extra: Partial<CreateBookmarkInput> = {}) => json<MutationResult<Bookmark>>(ownerId, '/bookmarks', 'POST', input(extra), 201);
const group = (ownerId: string, name = 'Group') => json<MutationResult<Group>>(ownerId, '/groups', 'POST', { operationId: operationId(), name }, 201);
const tag = (ownerId: string, name = 'Tag') => json<MutationResult<Tag>>(ownerId, '/tags', 'POST', { operationId: operationId(), name }, 201);
const versionInput = (version: number) => ({ operationId: operationId(), version });

describe('real D1 core', () => {
  it('initializes one user and workspace under concurrent identity requests, without email merging', async () => {
    const before = await env.DB.prepare('SELECT count(*) AS n FROM users').first<{ n: number }>();
    const same = identity();
    const owners = await Promise.all(Array.from({ length: 8 }, () => ensureIdentity(env.DB, same)));
    expect(new Set(owners).size).toBe(1);
    const other = await ensureIdentity(env.DB, { ...same, subject: operationId() });
    expect(other).not.toBe(owners[0]);
    const counts = await env.DB.prepare(`SELECT (SELECT count(*) FROM auth_identities WHERE provider = ? AND issuer = ? AND subject = ?) AS identities,
      (SELECT count(*) FROM workspace_state WHERE owner_id = ?) AS workspaces`).bind(same.provider, same.issuer, same.subject, owners[0]).first();
    expect(counts).toEqual({ identities: 1, workspaces: 1 });
    const after = await env.DB.prepare('SELECT count(*) AS n FROM users').first<{ n: number }>();
    expect(after!.n - before!.n).toBe(2);
  });

  it('replays exact receipts, rejects changed requests, and deduplicates racing normalized URLs', async () => {
    const user = await owner();
    const body = input({ url: 'https://EXAMPLE.test:443/a', title: '' });
    const responses = await Promise.all([request(user, '/bookmarks', 'POST', body), request(user, '/bookmarks', 'POST', body)]);
    expect(responses.map(r => r.status)).toEqual([201, 201]);
    const first = await responses[0]!.json() as MutationResult<Bookmark>;
    expect(await responses[1]!.json()).toEqual(first);
    expect(first.data.title).toBe('example.test');
    const changed = await json<ApiErrorBody>(user, '/bookmarks', 'POST', { ...body, title: 'changed' }, 409);
    expect(changed.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const duplicate = await json<ApiErrorBody>(user, '/bookmarks', 'POST', { ...body, operationId: operationId(), url: 'https://example.test/a' }, 409);
    expect(duplicate.error.code).toBe('DUPLICATE_URL');
    const racing = await Promise.all([request(user, '/bookmarks', 'POST', input({ url: 'https://race.test' })), request(user, '/bookmarks', 'POST', input({ url: 'https://RACE.test:443/' }))]);
    expect(racing.map(r => r.status).sort()).toEqual([201, 409]);
    const bootstrap = await json<Bootstrap>(user, '/bootstrap');
    expect(bootstrap.counts.active).toBe(2);
    expect(bootstrap.revision).toBe(2);
    expect(bootstrap.capabilities).toEqual({ transfers: false, automaticIcons: false });
  });

  it('isolates objects and enforces owner composite FKs and URL uniqueness in D1', async () => {
    const alice = await owner(); const bob = await owner();
    const g = (await group(bob)).data; const t = (await tag(bob)).data;
    const a = (await add(alice)).data; const b = (await add(bob)).data;
    expect((await request(alice, `/bookmarks/${b.id}`)).status).toBe(404);
    expect((await request(alice, '/bookmarks', 'POST', input({ groupId: g.id }))).status).toBe(404);
    expect((await request(alice, '/bookmarks', 'POST', input({ tagIds: [t.id] }))).status).toBe(404);
    await expect(env.DB.prepare('UPDATE bookmarks SET group_id = ? WHERE owner_id = ? AND id = ?').bind(g.id, alice, a.id).run()).rejects.toThrow();
    await expect(env.DB.prepare('INSERT INTO bookmark_tags VALUES (?, ?, ?)').bind(alice, a.id, t.id).run()).rejects.toThrow();
    await expect(env.DB.prepare('INSERT INTO bookmark_tags VALUES (?, ?, ?)').bind(bob, a.id, t.id).run()).rejects.toThrow();
    const deleted = await json<MutationResult<Bookmark>>(alice, `/bookmarks/${a.id}/trash`, 'POST', versionInput(a.version));
    const duplicate = await json<ApiErrorBody>(alice, '/bookmarks', 'POST', input({ url: a.url }), 409);
    expect(duplicate.error).toMatchObject({ code: 'URL_IN_TRASH', details: { id: a.id } });
    await json(alice, `/trash/${a.id}`, 'DELETE', versionInput(deleted.data.version));
    await add(alice, { url: a.url });
    expect((await json<BookmarkPage>(bob, '/bookmarks')).items).toHaveLength(1);
  });

  it('rejects stale editors but permits unrelated edits and returns receipts after later changes', async () => {
    const user = await owner(); const a = (await add(user)).data; const b = (await add(user)).data;
    const body = { ...input({ ...a, title: 'new A' }), version: a.version };
    const result = await json<MutationResult<Bookmark>>(user, `/bookmarks/${a.id}`, 'PATCH', body);
    await json(user, `/bookmarks/${b.id}`, 'PATCH', { ...input({ ...b, title: 'new B' }), version: b.version });
    expect(await json(user, `/bookmarks/${a.id}`, 'PATCH', body)).toEqual(result);
    const stale = await json<ApiErrorBody>(user, `/bookmarks/${a.id}`, 'PATCH', { ...body, operationId: operationId(), title: 'stale' }, 409);
    expect(stale.error.code).toBe('VERSION_CONFLICT');
    expect((await json<Bookmark>(user, `/bookmarks/${a.id}`)).title).toBe('new A');
  });

  it('combines literal keyword AND, tag AND, Unicode names and pinned/group filters', async () => {
    const user = await owner(); const g = (await group(user)).data;
    const a = (await tag(user, 'Straße')).data; const b = (await tag(user, '资料')).data;
    expect((await request(user, '/tags', 'POST', { operationId: operationId(), name: ' STRASSE ' })).status).toBe(409);
    const hit = (await add(user, { title: '设计 ALPHA', note: '100%_完成', groupId: g.id, tagIds: [a.id, b.id], pinned: true })).data;
    await add(user, { title: 'alpha', note: '100X完成', groupId: g.id, tagIds: [a.id] });
    const query = new URLSearchParams({ q: 'alpha STRASSE 100%_', tagIds: `${a.id},${b.id}`, groupId: g.id, pinned: 'true' });
    expect((await json<BookmarkPage>(user, `/bookmarks?${query}`)).items.map(x => x.id)).toEqual([hit.id]);
    await json(user, `/tags/${a.id}`, 'PATCH', { operationId: operationId(), name: 'Renamed', version: a.version });
    expect((await json<BookmarkPage>(user, '/bookmarks?q=strasse')).total).toBe(0);
    expect((await json<BookmarkPage>(user, '/bookmarks?q=renamed')).total).toBe(2);
  });

  it('pages stably across ties, binds query/revision and caps response size', async () => {
    const user = await owner();
    for (let i = 0; i < 6; i++) await add(user, { title: 'same', pinned: i < 2 });
    let page = await json<BookmarkPage>(user, '/bookmarks?sort=title&limit=2');
    const seen = [...page.items.map(b => b.id)]; const initialCursor = page.nextCursor!;
    expect(page.items.every(b => b.pinned)).toBe(true);
    while (page.nextCursor) { page = await json<BookmarkPage>(user, `/bookmarks?sort=title&limit=2&cursor=${encodeURIComponent(page.nextCursor)}`); seen.push(...page.items.map(b => b.id)); }
    expect(seen).toHaveLength(6); expect(new Set(seen).size).toBe(6);
    expect((await request(user, '/bookmarks?limit=5000')).status).toBe(422);
    expect((await json<ApiErrorBody>(user, `/bookmarks?sort=updated&cursor=${encodeURIComponent(initialCursor)}`, 'GET', undefined, 422)).error.code).toBe('INVALID_CURSOR');
    await add(user);
    expect((await json<ApiErrorBody>(user, `/bookmarks?sort=title&cursor=${encodeURIComponent(initialCursor)}`, 'GET', undefined, 409)).error.code).toBe('CURSOR_STALE');
  });

  it('deletes groups/tags without losing trash and advances affected versions', async () => {
    const user = await owner(); const g = (await group(user)).data; const t = (await tag(user)).data;
    const a = (await add(user, { groupId: g.id, tagIds: [t.id] })).data;
    const b = (await add(user, { groupId: g.id, tagIds: [t.id] })).data;
    const trashed = (await json<MutationResult<Bookmark>>(user, `/bookmarks/${b.id}/trash`, 'POST', versionInput(b.version))).data;
    expect(await json(user, `/groups/${g.id}/impact`)).toEqual({ active: 1, trash: 1, total: 2 });
    const index = await json<LayoutIndex>(user, '/layout/index');
    await json(user, '/layout', 'PUT', { operationId: operationId(), baseRevision: index.revision, operations: [], preferences: { ...index.preferences, collapsedGroupIds: [g.id] } });
    await json(user, `/groups/${g.id}`, 'DELETE', versionInput(g.version));
    expect((await json<LayoutIndex>(user, '/layout/index')).preferences.collapsedGroupIds).toEqual([]);
    expect((await json<Bookmark>(user, `/bookmarks/${a.id}`))).toMatchObject({ groupId: null, version: a.version + 1 });
    const trash = (await json<BookmarkPage>(user, '/trash')).items[0]!;
    expect(trash).toMatchObject({ groupId: null, version: trashed.version + 1 });
    await json(user, `/tags/${t.id}`, 'DELETE', versionInput(t.version));
    expect((await json<BookmarkPage>(user, '/trash')).items[0]).toMatchObject({ tagIds: [], version: trash.version + 1 });
    const restored = await json<MutationResult<Bookmark>>(user, `/trash/${b.id}/restore`, 'POST', versionInput(trash.version + 1));
    expect(restored.data).toMatchObject({ deletedAt: null, groupId: null, tagIds: [] });
  });

  it('reports partial batch failures and preserves unmentioned labels with replay receipts', async () => {
    const user = await owner(); const other = await owner(); const g = (await group(user)).data;
    const t1 = (await tag(user, 'One')).data; const t2 = (await tag(user, 'Two')).data;
    const a = (await add(user, { tagIds: [t1.id] })).data; const b = (await add(user)).data; const foreign = (await add(other)).data;
    const batch = { operationId: operationId(), action: 'addTags', tagIds: [t2.id], items: [{ id: a.id, version: a.version }, { id: b.id, version: 99 }, { id: foreign.id, version: foreign.version }] };
    const result = await json<BatchResult>(user, '/bookmarks/batch', 'POST', batch);
    expect(result).toMatchObject({ succeeded: 1, failed: 2, items: [{ success: true }, { code: 'VERSION_CONFLICT' }, { code: 'NOT_FOUND' }] });
    expect(await json(user, '/bookmarks/batch', 'POST', batch)).toEqual(result);
    let latest = await json<Bookmark>(user, `/bookmarks/${a.id}`);
    expect(new Set(latest.tagIds)).toEqual(new Set([t1.id, t2.id]));
    await json(user, '/bookmarks/batch', 'POST', { operationId: operationId(), action: 'removeTags', tagIds: [t1.id], items: [{ id: a.id, version: latest.version }] });
    latest = await json<Bookmark>(user, `/bookmarks/${a.id}`);
    expect(latest.tagIds).toEqual([t2.id]);
    await json(user, '/bookmarks/batch', 'POST', { operationId: operationId(), action: 'move', groupId: g.id, items: [{ id: a.id, version: latest.version }] });
    expect((await json<Bookmark>(user, `/bookmarks/${a.id}`))).toMatchObject({ groupId: g.id, version: latest.version + 1 });
  });

  it('moves across full groups atomically, keeps independent pins and previews/restores defaults', async () => {
    const user = await owner(); const g1 = (await group(user, 'First')).data; const g2 = (await group(user, 'Second')).data;
    const a = (await add(user, { groupId: g1.id, pinned: true })).data; const b = (await add(user, { groupId: g2.id, pinned: true })).data;
    const initial = await json<LayoutIndex>(user, '/layout/index');
    const body: LayoutSaveInput = { operationId: operationId(), baseRevision: initial.revision, preferences: { ...DEFAULT_PREFERENCES, density: 'compact', collapsedGroupIds: [g1.id] }, operations: [
      { type: 'bookmark', id: a.id, groupId: g2.id, placement: { afterId: b.id } },
      { type: 'group', id: g2.id, placement: { beforeId: g1.id } },
      { type: 'pinned', id: b.id, placement: { beforeId: a.id } },
    ] };
    const saved = await json<MutationResult<LayoutIndex>>(user, '/layout', 'PUT', body);
    expect(saved.data.groups.find(g => g.groupId === g2.id)?.bookmarkIds).toEqual([b.id, a.id]);
    expect((await json<BookmarkPage>(user, '/bookmarks?pinned=true&sort=manual')).items.map(x => x.id)).toEqual([b.id, a.id]);
    expect((await json<Bookmark>(user, `/bookmarks/${a.id}`)).version).toBe(a.version + 1);
    expect(await json(user, '/layout', 'PUT', body)).toEqual(saved);
    const preview = await json<LayoutIndex>(user, '/layout/default-preview');
    expect(preview.revision).toBe(saved.revision);
    expect(preview.groupOrder).toEqual([g1.id, g2.id]);
    expect(preview.groups.find(g => g.groupId === g2.id)?.bookmarkIds).toEqual([a.id, b.id]);
    expect((await json<LayoutIndex>(user, '/layout/index')).preferences.density).toBe('compact');
    const reset = await json<MutationResult<LayoutIndex>>(user, '/layout', 'PUT', { operationId: operationId(), baseRevision: saved.revision, preferences: DEFAULT_PREFERENCES, operations: [], reset: true });
    expect(reset.data).toEqual({ ...preview, revision: saved.revision + 1 });
  });

  it('batch trash, restore and permanent deletion preserve versions and atomically clean associations', async () => {
    const user = await owner(); const t = (await tag(user)).data;
    const a = (await add(user, { tagIds: [t.id], pinned: true })).data;
    const b = (await add(user)).data;
    const perform = (action: string, items: { id: string; version: number }[]) => json<BatchResult>(user, '/bookmarks/batch', 'POST', { operationId: operationId(), action, items });
    expect(await perform('trash', [{ id: a.id, version: a.version }, { id: b.id, version: b.version }])).toMatchObject({ succeeded: 2, failed: 0 });
    expect((await json<LayoutIndex>(user, '/layout/index')).pinnedOrder).toEqual([]);
    const trash = await json<BookmarkPage>(user, '/trash');
    expect(trash.total).toBe(2);
    expect(await perform('restore', trash.items.map(x => ({ id: x.id, version: x.version })))).toMatchObject({ succeeded: 2, failed: 0 });
    const restored = (await json<BookmarkPage>(user, '/bookmarks')).items;
    expect(restored.find(x => x.id === a.id)).toMatchObject({ version: 3, tagIds: [t.id], pinned: true });
    expect((await json<LayoutIndex>(user, '/layout/index')).pinnedOrder).toEqual([a.id]);
    expect(await perform('delete', [{ id: a.id, version: 3 }])).toMatchObject({ succeeded: 0, failed: 1, items: [{ code: 'NOT_FOUND' }] });
    await perform('trash', restored.map(x => ({ id: x.id, version: x.version })));
    expect(await perform('delete', [{ id: a.id, version: 4 }, { id: b.id, version: 4 }])).toMatchObject({ succeeded: 2, failed: 0 });
    expect((await json<Bootstrap>(user, '/bootstrap')).counts).toEqual({ active: 0, trash: 0, pinned: 0, ungrouped: 0 });
    expect((await env.DB.prepare('SELECT count(*) AS n FROM bookmark_tags WHERE owner_id = ?').bind(user).first<{ n: number }>())?.n).toBe(0);
    await add(user, { url: a.url });
  });

  it('keeps max-label batch failures retryable and enforces bounded fallback titles', async () => {
    const user = await owner();
    const tags: string[] = [];
    for (let i = 0; i < 21; i++) tags.push((await tag(user, `Label ${i}`)).data.id);
    const hostname = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(60)}`;
    const bookmark = (await add(user, { url: `https://${hostname}`, tagIds: tags.slice(0, 20) })).data;
    expect(Array.from(bookmark.title)).toHaveLength(200);
    const batch = { operationId: operationId(), action: 'addTags', tagIds: [tags[20]], items: [{ id: bookmark.id, version: bookmark.version }] };
    const result = await json<BatchResult>(user, '/bookmarks/batch', 'POST', batch);
    expect(result).toMatchObject({ succeeded: 0, failed: 1, items: [{ code: 'TAG_LIMIT' }] });
    expect(await json(user, '/bookmarks/batch', 'POST', batch)).toEqual(result);
    expect(await json(user, `/bookmarks/${bookmark.id}`)).toEqual(bookmark);
  });

  it('allows exactly one concurrent layout winner and rejects invalid anchors without changes', async () => {
    const user = await owner(); const a = (await add(user)).data; const b = (await add(user)).data;
    const initial = await json<LayoutIndex>(user, '/layout/index');
    const body = { baseRevision: initial.revision, preferences: DEFAULT_PREFERENCES, operations: [{ type: 'bookmark', id: a.id, groupId: null, placement: { afterId: b.id } }] };
    const responses = await Promise.all([request(user, '/layout', 'PUT', { ...body, operationId: operationId() }), request(user, '/layout', 'PUT', { ...body, operationId: operationId() })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const latest = await json<LayoutIndex>(user, '/layout/index');
    expect(latest.revision).toBe(initial.revision + 1);
    const invalid = { ...body, operationId: operationId(), baseRevision: latest.revision, operations: [{ type: 'bookmark', id: a.id, groupId: null, placement: { beforeId: 'missing' } }] };
    expect((await request(user, '/layout', 'PUT', invalid)).status).toBe(422);
    expect(await json(user, '/layout/index')).toEqual(latest);
  });

  it('CHECK assertions generate a failing row and roll back preceding D1 writes', async () => {
    const user = await owner();
    const guard = operationId();
    await expect(env.DB.batch([
      env.DB.prepare('UPDATE workspace_state SET data_revision = 99 WHERE owner_id = ?').bind(user),
      env.DB.prepare(`INSERT INTO mutation_guards (id, passed) VALUES (?, CASE WHEN EXISTS
        (SELECT 1 FROM workspace_state WHERE owner_id = ? AND data_revision = -1) THEN 1 ELSE 0 END)`).bind(guard, user),
    ])).rejects.toThrow(/CHECK/);
    expect((await json<Bootstrap>(user, '/bootstrap')).revision).toBe(0);
    expect(await env.DB.prepare('SELECT * FROM mutation_guards WHERE id = ?').bind(guard).first()).toBeNull();
  });

  it('rolls back business writes/version/receipt after an injected mid-batch SQL failure and safely retries', async () => {
    const user = await owner(); const a = (await add(user)).data; const b = (await add(user)).data;
    const initial = await json<LayoutIndex>(user, '/layout/index');
    const body: LayoutSaveInput = { operationId: operationId(), baseRevision: initial.revision, preferences: { ...DEFAULT_PREFERENCES, density: 'compact' }, operations: [{ type: 'bookmark', id: b.id, groupId: null, placement: { beforeId: a.id } }] };
    // Real SQLite failure after bookmark and workspace updates, before receipt commit.
    const trigger = `fail_receipt_${user.replaceAll('-', '')}`;
    await env.DB.prepare(`CREATE TRIGGER ${trigger} BEFORE INSERT ON mutation_receipts WHEN NEW.owner_id = '${user}' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`).run();
    try {
      const response = await json<ApiErrorBody>(user, '/layout', 'PUT', body, 503);
      expect(response.error.code).toBe('STORAGE_UNAVAILABLE');
      expect(await json(user, '/layout/index')).toEqual(initial);
      expect((await json<Bookmark>(user, `/bookmarks/${a.id}`)).version).toBe(a.version);
      expect(await env.DB.prepare('SELECT * FROM mutation_receipts WHERE owner_id = ? AND operation_id = ?').bind(user, body.operationId).first()).toBeNull();
    } finally { await env.DB.prepare(`DROP TRIGGER ${trigger}`).run(); }
    const retry = await json<MutationResult<LayoutIndex>>(user, '/layout', 'PUT', body);
    expect(retry.revision).toBe(initial.revision + 1);
    expect(await json(user, '/layout', 'PUT', body)).toEqual(retry);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM mutation_guards').first<{ n: number }>())?.n).toBe(0);
  });

  it('reads a complete 5000-ID index, pages cards, and atomically persists all changed positions with a receipt', async () => {
    const user = await owner();
    // Capacity fixture goes through real D1 SQL, not an in-memory repository.
    await env.DB.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 5000)
      INSERT INTO bookmarks (owner_id, id, url, normalized_url, title, title_key, note, search_key, pinned, position, pinned_position, icon_type, created_at, updated_at)
      SELECT ?, printf('capacity-%05d', n), 'https://capacity.test/' || n, 'https://capacity.test/' || n,
      'Card ' || n, 'card ' || n, 'private note', 'card ' || n, 0, n * 1024, 0, 'auto', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z' FROM seq`).bind(user).run();
    const page = await json<BookmarkPage>(user, '/bookmarks');
    expect(page.total).toBe(5000); expect(page.items).toHaveLength(50); expect(page.nextCursor).not.toBeNull();
    const index = await json<LayoutIndex>(user, '/layout/index');
    expect(index.groups[0]?.bookmarkIds).toHaveLength(5000);
    expect(JSON.stringify(index)).not.toContain('private note');
    const body: LayoutSaveInput = { operationId: operationId(), baseRevision: index.revision, preferences: DEFAULT_PREFERENCES,
      operations: [{ type: 'bookmark', id: 'capacity-05000', groupId: null, placement: { edge: 'start' } }] };
    const started = performance.now();
    const saved = await json<MutationResult<LayoutIndex>>(user, '/layout', 'PUT', body);
    console.info(JSON.stringify({ event: 'local_d1_5000_layout', elapsedMs: Math.round(performance.now() - started), count: 5000 }));
    expect(saved.data.groups[0]?.bookmarkIds[0]).toBe('capacity-05000');
    const updated = await env.DB.prepare('SELECT count(*) AS n, count(DISTINCT position) AS positions FROM bookmarks WHERE owner_id = ? AND version = 2').bind(user).first();
    expect(updated).toEqual({ n: 5000, positions: 5000 });
    expect(await json(user, '/layout', 'PUT', body)).toEqual(saved);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM mutation_receipts WHERE owner_id = ?').bind(user).first<{ n: number }>())?.n).toBe(1);
  }, 30_000);
});
