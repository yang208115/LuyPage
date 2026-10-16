export const JOB_STATUSES = [
  'uploading', 'validating', 'awaiting_confirmation', 'queued', 'running',
  'completed', 'partial', 'ready', 'failed', 'needs_attention', 'cancelled', 'expired',
] as const;
export type JobStatus = typeof JOB_STATUSES[number];
export type JobKind = 'import' | 'export' | 'icon' | 'cleanup';
export type ItemOutcome = 'succeeded' | 'duplicate' | 'trashed' | 'invalid' | 'write_failed';
export interface JobCounts {
  total: number; succeeded: number; duplicate: number; trashed: number;
  invalid: number; write_failed: number; unprocessed: number;
}
const outcomes: ItemOutcome[] = ['succeeded', 'duplicate', 'trashed', 'invalid', 'write_failed'];

export function assertCounts(counts: JobCounts): void {
  const values = [counts.total, counts.unprocessed, ...outcomes.map(key => counts[key])];
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)
    || counts.total !== counts.unprocessed + outcomes.reduce((sum, key) => sum + counts[key], 0)) {
    throw new Error('JOB_COUNTS_INVALID');
  }
}

export function initialCounts(total: number): JobCounts {
  const counts = { total, succeeded: 0, duplicate: 0, trashed: 0, invalid: 0, write_failed: 0, unprocessed: total };
  assertCounts(counts);
  return counts;
}

// The prior result must come from (job_id, source_index) inside the committing transaction.
export function replaceItemOutcome(counts: JobCounts, prior: ItemOutcome | null, next: ItemOutcome): JobCounts {
  assertCounts(counts);
  if (!outcomes.includes(next) || (prior !== null && !outcomes.includes(prior))) throw new Error('ITEM_OUTCOME_INVALID');
  if (prior === next) return { ...counts };
  if (prior !== null && prior !== 'write_failed') throw new Error('ITEM_RESULT_IMMUTABLE');
  const updated = { ...counts };
  updated[prior ?? 'unprocessed'] -= 1;
  updated[next] += 1;
  assertCounts(updated);
  return updated;
}

const nextStatuses: Record<JobStatus, readonly JobStatus[]> = {
  uploading: ['validating', 'failed', 'needs_attention', 'cancelled', 'expired'],
  validating: ['awaiting_confirmation', 'failed', 'needs_attention', 'cancelled', 'expired'],
  awaiting_confirmation: ['validating', 'queued', 'failed', 'needs_attention', 'cancelled', 'expired'],
  queued: ['running', 'failed', 'needs_attention', 'cancelled', 'expired'],
  running: ['queued', 'completed', 'partial', 'ready', 'failed', 'needs_attention', 'cancelled', 'expired'],
  needs_attention: ['queued', 'validating', 'failed', 'cancelled', 'expired'],
  partial: ['queued', 'cancelled', 'expired'],
  failed: [], completed: [], ready: ['needs_attention', 'expired'], cancelled: [], expired: [],
};

export interface JobTransitionEvidence {
  counts: JobCounts;
  manifestFrozen?: boolean;
  previewConfirmed?: boolean;
  objectVerified?: boolean;
  layoutResolved?: boolean;
}

export function assertJobTransition(kind: JobKind, from: JobStatus, to: JobStatus, evidence: JobTransitionEvidence): void {
  assertCounts(evidence.counts);
  if (!nextStatuses[from]?.includes(to)) throw new Error('JOB_TRANSITION_INVALID');
  if (kind !== 'import' && ['uploading', 'validating', 'awaiting_confirmation', 'partial'].includes(to)) throw new Error('JOB_KIND_STATE_INVALID');
  if (kind === 'export' && to === 'completed' || kind !== 'export' && to === 'ready') throw new Error('JOB_KIND_STATE_INVALID');
  if (kind === 'import' && ['validating', 'awaiting_confirmation', 'queued', 'running'].includes(to)
    && !evidence.manifestFrozen) throw new Error('MANIFEST_NOT_FROZEN');
  if (kind === 'import' && ['queued', 'running'].includes(to) && !evidence.previewConfirmed) throw new Error('PREVIEW_NOT_CONFIRMED');
  if (to === 'completed' && (evidence.counts.unprocessed !== 0 || evidence.counts.write_failed !== 0
    || (kind === 'import' && evidence.layoutResolved !== true))) throw new Error('JOB_NOT_COMPLETE');
  if (to === 'ready' && (!evidence.objectVerified || evidence.counts.unprocessed !== 0 || evidence.counts.write_failed !== 0)) throw new Error('EXPORT_NOT_VERIFIED');
}

export interface JobMessage { eventId: string; jobId: string; chunkIndex: number; dispatchEpoch: number }
export function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
export function parseJobMessage(value: unknown): JobMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'chunkIndex,dispatchEpoch,eventId,jobId'
    || !isOpaqueId(record.eventId) || !isOpaqueId(record.jobId)
    || !Number.isSafeInteger(record.chunkIndex) || (record.chunkIndex as number) < 0 || (record.chunkIndex as number) > 511
    || !Number.isSafeInteger(record.dispatchEpoch) || (record.dispatchEpoch as number) < 1) return null;
  return { eventId: record.eventId, jobId: record.jobId, chunkIndex: record.chunkIndex as number, dispatchEpoch: record.dispatchEpoch as number };
}
