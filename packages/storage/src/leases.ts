export interface JobLease {
  id: string; lease_token: string; lease_generation: number; lease_expires_at: number; cursor: number;
}
export async function claimJobLease(db: D1Database, input: {
  jobId: string; eventId: string; dispatchEpoch: number; expectedCursor: number; now: number; ttlMs?: number;
}): Promise<JobLease | null> {
  const ttl = input.ttlMs ?? 30_000;
  if (!Number.isSafeInteger(input.now) || input.now < 0 || !Number.isSafeInteger(ttl) || ttl < 1 || ttl > 60_000
    || !Number.isSafeInteger(input.expectedCursor) || input.expectedCursor < 0 || !Number.isSafeInteger(input.dispatchEpoch) || input.dispatchEpoch < 1) throw new Error('LEASE_INPUT_INVALID');
  // CAS claim. Every result write must use this generation inside the SAME D1 batch as business writes and cursor/outbox.
  return db.prepare(`UPDATE background_jobs SET status = 'running', lease_token = ?, lease_generation = lease_generation + 1,
    lease_expires_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND dispatch_epoch = ?
    AND status IN ('queued', 'running') AND cursor = ? AND expires_at > ?
    AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    AND dispatch_epoch = (SELECT dispatch_epoch FROM background_control WHERE singleton = 1 AND paused = 0)
    AND EXISTS (SELECT 1 FROM outbox_events e WHERE e.id = ? AND e.job_id = background_jobs.id
      AND e.dispatch_epoch = background_jobs.dispatch_epoch AND e.expected_cursor = background_jobs.cursor AND e.handled_at IS NULL)
    RETURNING id, lease_token, lease_generation, lease_expires_at, cursor`)
    .bind(crypto.randomUUID(), input.now + ttl, input.now, input.jobId, input.dispatchEpoch,
      input.expectedCursor, input.now, input.now, input.eventId).first<JobLease>();
}
