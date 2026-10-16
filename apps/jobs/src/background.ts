import { parseJobMessage, type JobMessage } from '../../../packages/storage/src/jobs';

const PAGE_SIZE = 50;
const MAX_DISPATCH_ATTEMPTS = 5;
const DISPATCH_LEASE_MS = 60_000;
const DELIVERY_TIMEOUT_MS = 60 * 60_000;
const ACTIVE_SQL = "('uploading', 'validating', 'awaiting_confirmation', 'queued', 'running')";

interface Control { dispatch_epoch: number; paused: number }
interface EventRow {
  id: string; job_id: string; chunk_index: number; dispatch_epoch: number;
  event_type: string; attempts: number; status: 'pending' | 'sent' | 'failed'; handled_at: number | null;
}

async function controlState(db: D1Database): Promise<Control> {
  const control = await db.prepare('SELECT dispatch_epoch, paused FROM background_control WHERE singleton = 1').first<Control>();
  if (!control) throw new Error('BACKGROUND_CONTROL_MISSING');
  return control;
}

async function recordFailure(db: D1Database, queue: string, message: Message<unknown>, code: string, now: number): Promise<void> {
  // Never persist an untrusted body, URL, owner claim, or raw exception text.
  await db.prepare(`INSERT INTO background_failures(queue_name, message_id, error_code, attempts, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(queue_name, message_id) DO UPDATE SET
    status = 'needs_attention', error_code = excluded.error_code, attempts = excluded.attempts, last_seen_at = excluded.last_seen_at`)
    .bind(queue, message.id, code, message.attempts, now, now).run();
}

// Both writes commit together. A durable failure is the only successful outcome of this skeleton.
async function failEvent(db: D1Database, eventId: string, code: string, now: number): Promise<boolean> {
  const results = await db.batch([
    db.prepare(`UPDATE background_jobs SET status = 'needs_attention', error_code = ?,
      lease_token = NULL, lease_expires_at = NULL, lease_generation = lease_generation + 1,
      version = version + 1, updated_at = ?
      WHERE status IN ${ACTIVE_SQL} AND EXISTS (
        SELECT 1 FROM outbox_events e JOIN background_control c ON c.singleton = 1
        WHERE e.id = ? AND e.job_id = background_jobs.id AND e.handled_at IS NULL
          AND e.dispatch_epoch = c.dispatch_epoch AND background_jobs.dispatch_epoch = c.dispatch_epoch AND c.paused = 0
      )`).bind(code, now, eventId),
    db.prepare(`UPDATE outbox_events SET status = 'failed', error_code = ?, handled_at = ?,
      dispatch_token = NULL, dispatch_until = NULL WHERE id = ? AND handled_at IS NULL
      AND dispatch_epoch = (SELECT dispatch_epoch FROM background_control WHERE singleton = 1 AND paused = 0)`)
      .bind(code, now, eventId),
    db.prepare('SELECT status, handled_at FROM outbox_events WHERE id = ?').bind(eventId),
  ]);
  const final = results[2]?.results[0] as { status: string; handled_at: number | null } | undefined;
  return final?.status === 'failed' && final.handled_at !== null;
}

export async function consumeJobs(batch: MessageBatch<unknown>, env: JobsBindings): Promise<void> {
  for (const message of batch.messages) {
    try {
      const control = await controlState(env.DB);
      if (control.paused) { message.retry({ delaySeconds: 60 }); continue; }
      const now = Date.now();
      const payload = parseJobMessage(message.body);
      if (!payload) {
        await recordFailure(env.DB, batch.queue, message, 'INVALID_QUEUE_MESSAGE', now);
        message.ack();
        continue;
      }
      if (payload.dispatchEpoch !== control.dispatch_epoch) {
        await recordFailure(env.DB, batch.queue, message, 'STALE_DISPATCH_EPOCH', now);
        message.ack();
        continue;
      }
      const event = await env.DB.prepare('SELECT * FROM outbox_events WHERE id = ?').bind(payload.eventId).first<EventRow>();
      if (!event || event.job_id !== payload.jobId || event.chunk_index !== payload.chunkIndex || event.dispatch_epoch !== payload.dispatchEpoch) {
        await recordFailure(env.DB, batch.queue, message, 'OUTBOX_MESSAGE_MISMATCH', now);
        message.ack();
        continue;
      }
      const code = batch.queue === env.DEAD_LETTER_QUEUE ? 'QUEUE_RETRIES_EXHAUSTED' : 'EVENT_NOT_IMPLEMENTED';
      if (!await failEvent(env.DB, event.id, code, now)) {
        message.retry({ delaySeconds: 60 });
        continue;
      }
      console.warn(JSON.stringify({ event: 'background_event_failed', eventId: event.id, jobId: event.job_id, code, attempts: message.attempts }));
      // ACK means failure was saved, never that the import/export/icon work succeeded.
      message.ack();
    } catch {
      console.error(JSON.stringify({ event: 'background_persistence_failed', messageId: message.id, code: 'BACKGROUND_DEPENDENCY_UNAVAILABLE' }));
      message.retry({ delaySeconds: 60 });
    }
  }
}

async function recoverJobs(db: D1Database, now: number): Promise<void> {
  const rows = await db.prepare(`SELECT id FROM background_jobs WHERE
    dispatch_epoch = (SELECT dispatch_epoch FROM background_control WHERE singleton = 1 AND paused = 0)
    AND status IN ${ACTIVE_SQL} AND (expires_at <= ? OR lease_expires_at <= ?)
    ORDER BY expires_at, id LIMIT ?`).bind(now, now, PAGE_SIZE).all<{ id: string }>();
  for (const row of rows.results) {
    await db.prepare(`UPDATE background_jobs SET
      status = CASE WHEN status IN ('uploading', 'awaiting_confirmation') AND expires_at <= ? THEN 'expired' ELSE 'needs_attention' END,
      error_code = CASE WHEN expires_at <= ? THEN 'JOB_EXPIRED' ELSE 'LEASE_EXPIRED' END,
      lease_token = NULL, lease_expires_at = NULL, lease_generation = lease_generation + 1,
      version = version + 1, updated_at = ? WHERE id = ? AND status IN ${ACTIVE_SQL}
      AND (expires_at <= ? OR lease_expires_at <= ?)
      AND dispatch_epoch = (SELECT dispatch_epoch FROM background_control WHERE singleton = 1 AND paused = 0)`)
      .bind(now, now, now, row.id, now, now).run();
  }
  const stalled = await db.prepare(`SELECT id FROM outbox_events WHERE status = 'sent' AND handled_at IS NULL AND sent_at <= ?
    AND dispatch_epoch = (SELECT dispatch_epoch FROM background_control WHERE singleton = 1 AND paused = 0)
    ORDER BY sent_at, id LIMIT ?`).bind(now - DELIVERY_TIMEOUT_MS, PAGE_SIZE).all<{ id: string }>();
  for (const event of stalled.results) await failEvent(db, event.id, 'DELIVERY_TIMEOUT', now);
}

export async function dispatchOutbox(env: JobsBindings, now = Date.now()): Promise<void> {
  const control = await controlState(env.DB);
  if (control.paused) return;
  await recoverJobs(env.DB, now);
  const rows = await env.DB.prepare(`SELECT * FROM outbox_events WHERE status = 'pending' AND handled_at IS NULL
    AND dispatch_epoch = ? AND available_at <= ? AND (dispatch_until IS NULL OR dispatch_until <= ?)
    ORDER BY available_at, id LIMIT ?`).bind(control.dispatch_epoch, now, now, PAGE_SIZE).all<EventRow>();
  for (const event of rows.results) {
    if (event.attempts >= MAX_DISPATCH_ATTEMPTS) {
      await failEvent(env.DB, event.id, 'OUTBOX_RETRIES_EXHAUSTED', now);
      continue;
    }
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare(`UPDATE outbox_events SET dispatch_token = ?, dispatch_until = ?, attempts = attempts + 1
      WHERE id = ? AND status = 'pending' AND handled_at IS NULL AND attempts < ?
      AND (dispatch_until IS NULL OR dispatch_until <= ?)
      AND dispatch_epoch = (SELECT dispatch_epoch FROM background_control WHERE singleton = 1 AND paused = 0)
      RETURNING id`).bind(token, now + DISPATCH_LEASE_MS, event.id, MAX_DISPATCH_ATTEMPTS, now).first<{ id: string }>();
    if (!claimed) continue;
    const payload: JobMessage = { eventId: event.id, jobId: event.job_id, chunkIndex: event.chunk_index, dispatchEpoch: event.dispatch_epoch };
    if (!parseJobMessage(payload)) {
      await failEvent(env.DB, event.id, 'INVALID_OUTBOX_EVENT', now);
      continue;
    }
    try {
      await env.JOBS_QUEUE.send(payload, { contentType: 'json' });
      await env.DB.prepare(`UPDATE outbox_events SET status = 'sent', sent_at = ?, error_code = NULL,
        dispatch_token = NULL, dispatch_until = NULL WHERE id = ? AND status = 'pending' AND dispatch_token = ?`)
        .bind(now, event.id, token).run();
    } catch {
      // Send may already have succeeded. Release only our claim; replay remains safe.
      await env.DB.prepare(`UPDATE outbox_events SET available_at = ?, error_code = 'OUTBOX_SEND_UNCERTAIN',
        dispatch_token = NULL, dispatch_until = NULL WHERE id = ? AND status = 'pending' AND dispatch_token = ?`)
        .bind(now + Math.min(60_000 * 2 ** event.attempts, 900_000), event.id, token).run();
      console.warn(JSON.stringify({ event: 'outbox_retry', eventId: event.id, code: 'OUTBOX_SEND_UNCERTAIN' }));
    }
  }
}
