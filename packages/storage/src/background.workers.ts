import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { consumeJobs, dispatchOutbox } from '../../../apps/jobs/src/background';
import iconWorker from '../../../apps/icon-fetcher/src/index';
import { registerTransferRoutes } from '../../../apps/api/src/transfers';
import type { AppEnv } from '../../../apps/api/src/context';
import { putImmutableChunk, immutableChunkKey, sha256, type ChunkIdentity } from './chunks';
import { claimJobLease } from './leases';

declare global { namespace Cloudflare { interface Env { BACKGROUND_TEST_MIGRATIONS: D1Migration[] } } }

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.BACKGROUND_TEST_MIGRATIONS);
  vi.restoreAllMocks();
});

async function seed(kind: 'import' | 'export' = 'export', total = 0) {
  const now = Date.now();
  await env.DB.prepare('INSERT INTO users(id, created_at) VALUES (?, ?)').bind('owner', new Date(now).toISOString()).run();
  await env.DB.prepare(`INSERT INTO background_jobs(id, owner_id, kind, status, dispatch_epoch, total, unprocessed, created_at, updated_at, expires_at, results_expires_at)
    VALUES ('job', 'owner', ?, ?, 1, ?, ?, ?, ?, ?, ?)`).bind(kind, kind === 'import' ? 'uploading' : 'queued', total, total, now, now, now + 86_400_000, now + 30 * 86_400_000).run();
  await env.DB.prepare(`INSERT INTO outbox_events(id, job_id, event_type, dispatch_epoch, available_at, created_at)
    VALUES ('event', 'job', 'future.unimplemented', 1, ?, ?)`).bind(now, now).run();
  return now;
}
async function runnableImport(total = 2) {
  const now = await seed('import', total);
  await env.DB.prepare("UPDATE background_jobs SET status = 'validating', manifest_sha256 = ? WHERE id = 'job'").bind('a'.repeat(64)).run();
  await env.DB.prepare("UPDATE background_jobs SET status = 'awaiting_confirmation', preview_version = 1 WHERE id = 'job'").run();
  await env.DB.prepare("UPDATE background_jobs SET status = 'queued', confirmed_preview_version = 1 WHERE id = 'job'").run();
  const lease = await claimJobLease(env.DB, { jobId: 'job', eventId: 'event', expectedCursor: 0, dispatchEpoch: 1, now });
  expect(lease).not.toBeNull();
  return lease!;
}
function message(body: unknown = { eventId: 'event', jobId: 'job', chunkIndex: 0, dispatchEpoch: 1 }): Message<unknown> {
  return { id: 'message', timestamp: new Date(), attempts: 1, body, ack: vi.fn(), retry: vi.fn() };
}
function batch(item: Message<unknown>, queue = 'luypage-jobs-local'): MessageBatch<unknown> {
  return { queue, messages: [item], metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } }, ackAll: vi.fn(), retryAll: vi.fn() };
}
function bindings() {
  const response = { metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } } };
  const send = vi.fn<Queue['send']>().mockResolvedValue(response);
  const settings: JobsBindings = {
    DB: env.DB, FILES: env.FILES, DEAD_LETTER_QUEUE: 'luypage-jobs-dlq-local',
    JOBS_QUEUE: {
      send, sendBatch: vi.fn<Queue['sendBatch']>().mockResolvedValue(response),
      metrics: vi.fn<Queue['metrics']>().mockResolvedValue(response.metadata.metrics),
    },
  };
  return { settings, send };
}

describe('D1 task invariants', () => {
  it('atomically counts unique results and replaces a failed retry', async () => {
    const lease = await runnableImport();
    const insert = () => env.DB.prepare(`INSERT INTO job_item_results(job_id, source_index, outcome, error_code, lease_generation, updated_at)
      VALUES ('job', 0, 'write_failed', 'WRITE_FAILED', ?, ?)`).bind(lease.lease_generation, Date.now()).run();
    await insert();
    await expect(insert()).rejects.toThrow();
    await env.DB.prepare("UPDATE job_item_results SET outcome = 'succeeded', error_code = NULL WHERE job_id = 'job' AND source_index = 0").run();
    expect(await env.DB.prepare("SELECT total, succeeded, write_failed, unprocessed FROM background_jobs WHERE id = 'job'").first())
      .toEqual({ total: 2, succeeded: 1, write_failed: 0, unprocessed: 1 });
    await expect(env.DB.prepare("UPDATE background_jobs SET total = 3 WHERE id = 'job'").run()).rejects.toThrow();
  });
  it('fences an expired consumer and rolls back other writes in the same batch', async () => {
    const oldLease = await runnableImport();
    await env.DB.prepare("UPDATE background_jobs SET lease_expires_at = ? WHERE id = 'job'").bind(Date.now() - 1000).run();
    const newLease = await claimJobLease(env.DB, { jobId: 'job', eventId: 'event', expectedCursor: 0, dispatchEpoch: 1, now: Date.now() });
    expect(newLease!.lease_generation).toBe(oldLease.lease_generation + 1);
    await expect(env.DB.batch([
      env.DB.prepare("INSERT INTO users(id, created_at) VALUES ('must-rollback', 'now')"),
      env.DB.prepare("INSERT INTO job_item_results(job_id, source_index, outcome, lease_generation, updated_at) VALUES ('job', 0, 'succeeded', ?, ?)").bind(oldLease.lease_generation, Date.now()),
    ])).rejects.toThrow('JOB_FENCE_REJECTED');
    expect(await env.DB.prepare("SELECT id FROM users WHERE id = 'must-rollback'").first()).toBeNull();
    expect(await env.DB.prepare("SELECT succeeded FROM background_jobs WHERE id = 'job'").first('succeeded')).toBe(0);
  });
  it('rejects concurrent claims, a wrong cursor, and a paused scheduler', async () => {
    const now = await seed();
    const input = { jobId: 'job', eventId: 'event', dispatchEpoch: 1, expectedCursor: 0, now };
    expect(await claimJobLease(env.DB, { ...input, expectedCursor: 1 })).toBeNull();
    const claims = await Promise.all([claimJobLease(env.DB, input), claimJobLease(env.DB, input)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await env.DB.prepare('UPDATE background_control SET paused = 1').run();
    expect(await claimJobLease(env.DB, { ...input, now: now + 60_001 })).toBeNull();
  });
  it('prevents a cursor skipping unprocessed entries and premature completion', async () => {
    const lease = await runnableImport();
    await env.DB.prepare("INSERT INTO job_item_results(job_id, source_index, outcome, lease_generation, updated_at) VALUES ('job', 1, 'succeeded', ?, ?)").bind(lease.lease_generation, Date.now()).run();
    await expect(env.DB.prepare("UPDATE background_jobs SET cursor = 2 WHERE id = 'job'").run()).rejects.toThrow('IMPORT_CURSOR_GAP');
    await expect(env.DB.prepare("UPDATE background_jobs SET status = 'completed', layout_status = 'preserved' WHERE id = 'job'").run()).rejects.toThrow();
  });
  it('rejects an already expired lease within the same second and preserves active result evidence', async () => {
    const lease = await runnableImport();
    await env.DB.prepare("INSERT INTO job_item_results(job_id, source_index, outcome, lease_generation, updated_at) VALUES ('job', 0, 'succeeded', ?, ?)").bind(lease.lease_generation, Date.now()).run();
    await expect(env.DB.prepare("DELETE FROM job_item_results WHERE job_id = 'job'").run()).rejects.toThrow('RESULT_RETENTION_ACTIVE');
    await env.DB.prepare("UPDATE background_jobs SET lease_expires_at = ? WHERE id = 'job'").bind(Date.now() - 1).run();
    await expect(env.DB.prepare("INSERT INTO job_item_results(job_id, source_index, outcome, lease_generation, updated_at) VALUES ('job', 1, 'succeeded', ?, ?)").bind(lease.lease_generation, Date.now()).run()).rejects.toThrow('JOB_FENCE_REJECTED');
  });
  it('allows only one active import per owner and freezes input chunk references', async () => {
    await seed('import');
    await env.DB.prepare(`INSERT INTO job_chunks(job_id, stage, chunk_index, object_key, byte_length, sha256, created_at)
      VALUES ('job', 'input', 0, 'key', 3, ?, ?)`).bind('a'.repeat(64), Date.now()).run();
    await expect(env.DB.prepare("UPDATE job_chunks SET object_key = 'changed'").run()).rejects.toThrow('CHUNK_IMMUTABLE');
    await env.DB.prepare("UPDATE background_jobs SET status = 'validating', manifest_sha256 = ? WHERE id = 'job'").bind('a'.repeat(64)).run();
    await expect(env.DB.prepare("DELETE FROM job_chunks WHERE job_id = 'job'").run()).rejects.toThrow('CHUNK_STILL_REFERENCED');
    await expect(env.DB.prepare(`INSERT INTO job_chunks(job_id, stage, chunk_index, object_key, byte_length, sha256, created_at)
      VALUES ('job', 'input', 1, 'key2', 3, ?, ?)`).bind('a'.repeat(64), Date.now()).run()).rejects.toThrow('MANIFEST_FROZEN');
    await expect(env.DB.prepare(`INSERT INTO background_jobs(id, owner_id, kind, status, dispatch_epoch, created_at, updated_at, expires_at, results_expires_at)
      SELECT 'another', owner_id, kind, 'uploading', dispatch_epoch, created_at, updated_at, expires_at, results_expires_at FROM background_jobs WHERE id = 'job'`).run()).rejects.toThrow();
  });
});

describe('queue and scheduled failure handling', () => {
  it('persists unsupported events and job attention before ack, with idempotent replay', async () => {
    await seed();
    const item = message();
    const { settings } = bindings();
    await consumeJobs(batch(item), settings);
    expect(item.ack).toHaveBeenCalledOnce();
    expect(item.retry).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT status, error_code FROM background_jobs WHERE id = 'job'").first())
      .toEqual({ status: 'needs_attention', error_code: 'EVENT_NOT_IMPLEMENTED' });
    expect(await env.DB.prepare("SELECT status FROM outbox_events WHERE id = 'event'").first('status')).toBe('failed');
    const version = await env.DB.prepare("SELECT version FROM background_jobs WHERE id = 'job'").first('version');
    await consumeJobs(batch(message()), settings);
    expect(await env.DB.prepare("SELECT version FROM background_jobs WHERE id = 'job'").first('version')).toBe(version);
  });
  it('does not ack if the atomic failure transaction cannot commit', async () => {
    await seed();
    await env.DB.prepare("CREATE TRIGGER test_outbox_abort BEFORE UPDATE ON outbox_events BEGIN SELECT RAISE(ABORT, 'INJECTED_FAILURE'); END").run();
    const item = message();
    await consumeJobs(batch(item), bindings().settings);
    expect(item.ack).not.toHaveBeenCalled();
    expect(item.retry).toHaveBeenCalledOnce();
    expect(await env.DB.prepare("SELECT status FROM background_jobs WHERE id = 'job'").first('status')).toBe('queued');
  });
  it('persists malformed/orphan messages without mutating an unrelated task', async () => {
    await seed();
    const item = message({ eventId: 'event', jobId: 'other', chunkIndex: 0, dispatchEpoch: 1 });
    await consumeJobs(batch(item), bindings().settings);
    expect(item.ack).toHaveBeenCalledOnce();
    expect(await env.DB.prepare('SELECT error_code FROM background_failures').first('error_code')).toBe('OUTBOX_MESSAGE_MISMATCH');
    expect(await env.DB.prepare("SELECT status FROM background_jobs WHERE id = 'job'").first('status')).toBe('queued');
  });
  it('isolates old restoration epochs and records dead-letter exhaustion', async () => {
    await seed();
    await consumeJobs(batch(message({ eventId: 'event', jobId: 'job', chunkIndex: 0, dispatchEpoch: 2 })), bindings().settings);
    expect(await env.DB.prepare('SELECT error_code FROM background_failures').first('error_code')).toBe('STALE_DISPATCH_EPOCH');
    await consumeJobs(batch(message(), 'luypage-jobs-dlq-local'), bindings().settings);
    expect(await env.DB.prepare("SELECT error_code FROM background_jobs WHERE id = 'job'").first('error_code')).toBe('QUEUE_RETRIES_EXHAUSTED');
  });
  it('dispatches only IDs, marks sent separately, and does not mark work complete', async () => {
    const now = await seed();
    const { settings, send } = bindings();
    await dispatchOutbox(settings, now);
    expect(send).toHaveBeenCalledExactlyOnceWith({ eventId: 'event', jobId: 'job', chunkIndex: 0, dispatchEpoch: 1 }, { contentType: 'json' });
    expect(await env.DB.prepare("SELECT status FROM outbox_events WHERE id = 'event'").first('status')).toBe('sent');
    expect(await env.DB.prepare("SELECT status FROM background_jobs WHERE id = 'job'").first('status')).toBe('queued');
    await dispatchOutbox(settings, now + 3_600_001);
    expect(await env.DB.prepare("SELECT error_code FROM background_jobs WHERE id = 'job'").first('error_code')).toBe('DELIVERY_TIMEOUT');
  });
  it('replays uncertain sends then stops after a finite dispatch budget', async () => {
    const now = await seed();
    const { settings, send } = bindings();
    send.mockRejectedValue(new Error('sensitive upstream text'));
    for (let attempt = 0; attempt < 6; attempt++) await dispatchOutbox(settings, now + attempt * 900_001);
    expect(send).toHaveBeenCalledTimes(5);
    expect(await env.DB.prepare("SELECT status, error_code FROM outbox_events WHERE id = 'event'").first())
      .toEqual({ status: 'failed', error_code: 'OUTBOX_RETRIES_EXHAUSTED' });
    expect(await env.DB.prepare("SELECT status FROM background_jobs WHERE id = 'job'").first('status')).toBe('needs_attention');
  });
  it('replays after send succeeds but the sent marker fails, without assuming business success', async () => {
    const now = await seed();
    await env.DB.prepare("CREATE TRIGGER test_sent_abort BEFORE UPDATE OF status ON outbox_events WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'MARKER_FAILED'); END").run();
    const { settings, send } = bindings();
    await dispatchOutbox(settings, now);
    expect(send).toHaveBeenCalledOnce();
    expect(await env.DB.prepare("SELECT status, error_code FROM outbox_events WHERE id = 'event'").first())
      .toEqual({ status: 'pending', error_code: 'OUTBOX_SEND_UNCERTAIN' });
    await env.DB.prepare('DROP TRIGGER test_sent_abort').run();
    await dispatchOutbox(settings, now + 60_001);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare("SELECT status FROM background_jobs WHERE id = 'job'").first('status')).toBe('queued');
    await consumeJobs(batch(message()), settings);
    expect(await env.DB.prepare("SELECT status FROM background_jobs WHERE id = 'job'").first('status')).toBe('needs_attention');
  });
  it('recovers expired leases into attention without running a business operation', async () => {
    await runnableImport();
    await env.DB.prepare("UPDATE background_jobs SET lease_expires_at = ? WHERE id = 'job'").bind(Date.now() - 2000).run();
    await dispatchOutbox(bindings().settings);
    expect(await env.DB.prepare("SELECT status, error_code, lease_token FROM background_jobs WHERE id = 'job'").first())
      .toEqual({ status: 'needs_attention', error_code: 'LEASE_EXPIRED', lease_token: null });
  });
});

describe('R2 and disabled capability boundaries', () => {
  const identity: ChunkIdentity = { kind: 'imports', stage: 'input', ownerId: 'owner', jobId: 'job', index: 0 };
  const data = new TextEncoder().encode('verified bytes');
  const body = () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } });
  it('uses conditional immutable puts with safe concurrent retries in local R2', async () => {
    const expected = { bytes: data.length, sha256: await sha256(data) };
    const refs = await Promise.all([putImmutableChunk(env.FILES, identity, body(), expected), putImmutableChunk(env.FILES, identity, body(), expected)]);
    expect(refs[0]).toEqual(refs[1]);
    expect((await env.FILES.list()).objects).toHaveLength(1);
    await expect(putImmutableChunk(env.FILES, identity, body(), { ...expected, sha256: 'a'.repeat(64) })).rejects.toThrow('CHUNK_DIGEST_MISMATCH');
  });
  it('rejects a corrupt existing object instead of overwriting it', async () => {
    const expected = { bytes: data.length, sha256: await sha256(data) };
    const key = immutableChunkKey(identity, expected.sha256);
    await env.FILES.put(key, new Uint8Array(data.length));
    await expect(putImmutableChunk(env.FILES, identity, body(), expected)).rejects.toThrow('OBJECT_DIGEST_MISMATCH');
    expect(new Uint8Array(await (await env.FILES.get(key))!.arrayBuffer())).toEqual(new Uint8Array(data.length));
  });
  it('keeps unimplemented background transfer methods and subresources closed', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', async (context, next) => { context.set('requestId', 'request'); await next(); });
    registerTransferRoutes(app);
    for (const path of ['/api/imports', '/api/imports/job/chunks/0', '/api/imports/job/confirm', '/api/exports', '/api/exports/job/download']) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
        if ((path === '/api/imports' && method === 'POST') || (path === '/api/exports' && ['GET', 'HEAD'].includes(method))) continue;
        const response = await app.request(path, { method });
        expect(response.status).toBe(503);
        if (method !== 'HEAD') expect(await response.json()).toMatchObject({ error: { code: 'CAPABILITY_UNAVAILABLE', requestId: 'request' } });
      }
    }
  });
  it('icon fallback never invokes the network', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    const response = await iconWorker.fetch();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ fallback: 'builtin', error: { code: 'CAPABILITY_UNAVAILABLE' } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
