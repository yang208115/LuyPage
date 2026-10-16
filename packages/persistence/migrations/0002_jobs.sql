-- Additive background schema; no core data mutations. All times are UTC epoch milliseconds.
CREATE TABLE background_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  dispatch_epoch INTEGER NOT NULL CHECK (dispatch_epoch > 0),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1))
) STRICT;
INSERT INTO background_control(singleton, dispatch_epoch) VALUES (1, 1);

CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('import', 'export', 'icon', 'cleanup')),
  status TEXT NOT NULL CHECK (status IN ('uploading', 'validating', 'awaiting_confirmation', 'queued', 'running', 'completed', 'partial', 'ready', 'failed', 'needs_attention', 'cancelled', 'expired')),
  format TEXT CHECK (format IN ('json', 'html')),
  dispatch_epoch INTEGER NOT NULL CHECK (dispatch_epoch > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total BETWEEN 0 AND 5000),
  succeeded INTEGER NOT NULL DEFAULT 0 CHECK (succeeded >= 0),
  duplicate INTEGER NOT NULL DEFAULT 0 CHECK (duplicate >= 0),
  trashed INTEGER NOT NULL DEFAULT 0 CHECK (trashed >= 0),
  invalid INTEGER NOT NULL DEFAULT 0 CHECK (invalid >= 0),
  write_failed INTEGER NOT NULL DEFAULT 0 CHECK (write_failed >= 0),
  unprocessed INTEGER NOT NULL DEFAULT 0 CHECK (unprocessed >= 0),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0 AND cursor <= total),
  preview_version INTEGER NOT NULL DEFAULT 0 CHECK (preview_version >= 0),
  confirmed_preview_version INTEGER,
  manifest_sha256 TEXT CHECK (manifest_sha256 IS NULL OR (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^a-f0-9]*')),
  input_bytes INTEGER NOT NULL DEFAULT 0 CHECK (input_bytes BETWEEN 0 AND 536870912),
  data_revision INTEGER,
  expected_revision INTEGER,
  layout_status TEXT NOT NULL DEFAULT 'pending' CHECK (layout_status IN ('pending', 'applied', 'preserved', 'needs_attention', 'conflict')),
  artifact_key TEXT,
  artifact_bytes INTEGER CHECK (artifact_bytes > 0 AND artifact_bytes <= 536870912),
  artifact_sha256 TEXT CHECK (artifact_sha256 IS NULL OR (length(artifact_sha256) = 64 AND artifact_sha256 NOT GLOB '*[^a-f0-9]*')),
  artifact_verified_at INTEGER,
  lease_token TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  results_expires_at INTEGER NOT NULL CHECK (results_expires_at >= expires_at),
  UNIQUE (id, owner_id),
  UNIQUE (id, dispatch_epoch),
  CHECK (total = succeeded + duplicate + trashed + invalid + write_failed + unprocessed),
  CHECK ((lease_token IS NULL AND lease_expires_at IS NULL) OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (kind = 'import' OR status NOT IN ('uploading', 'validating', 'awaiting_confirmation', 'partial')),
  CHECK (kind != 'export' OR status != 'completed'),
  CHECK (status != 'ready' OR (kind = 'export' AND artifact_key IS NOT NULL AND artifact_bytes IS NOT NULL AND artifact_sha256 IS NOT NULL AND artifact_verified_at IS NOT NULL AND unprocessed = 0 AND write_failed = 0)),
  CHECK (status != 'completed' OR (unprocessed = 0 AND write_failed = 0 AND (kind != 'import' OR layout_status IN ('applied', 'preserved')))),
  CHECK (kind != 'import' OR status NOT IN ('validating', 'awaiting_confirmation', 'queued', 'running') OR manifest_sha256 IS NOT NULL),
  CHECK (kind != 'import' OR status NOT IN ('queued', 'running') OR (confirmed_preview_version IS NOT NULL AND confirmed_preview_version = preview_version AND preview_version > 0)),
  CHECK (status NOT IN ('failed', 'needs_attention') OR error_code IS NOT NULL),
  CHECK (format != 'html' OR input_bytes <= 10000000)
) STRICT;
CREATE UNIQUE INDEX one_active_import_per_owner ON background_jobs(owner_id)
  WHERE kind = 'import' AND status IN ('uploading', 'validating', 'awaiting_confirmation', 'queued', 'running', 'needs_attention');
CREATE INDEX background_jobs_recovery ON background_jobs(status, lease_expires_at, expires_at);

CREATE TRIGGER background_job_transition BEFORE UPDATE OF status ON background_jobs
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'uploading' AND NEW.status IN ('validating', 'failed', 'needs_attention', 'cancelled', 'expired')) OR
  (OLD.status = 'validating' AND NEW.status IN ('awaiting_confirmation', 'failed', 'needs_attention', 'cancelled', 'expired')) OR
  (OLD.status = 'awaiting_confirmation' AND NEW.status IN ('validating', 'queued', 'failed', 'needs_attention', 'cancelled', 'expired')) OR
  (OLD.status = 'queued' AND NEW.status IN ('running', 'failed', 'needs_attention', 'cancelled', 'expired')) OR
  (OLD.status = 'running' AND NEW.status IN ('queued', 'completed', 'partial', 'ready', 'failed', 'needs_attention', 'cancelled', 'expired')) OR
  (OLD.status = 'needs_attention' AND NEW.status IN ('queued', 'validating', 'failed', 'cancelled', 'expired')) OR
  (OLD.status = 'partial' AND NEW.status IN ('queued', 'cancelled', 'expired')) OR
  (OLD.status = 'ready' AND NEW.status IN ('needs_attention', 'expired'))
)
BEGIN SELECT RAISE(ABORT, 'JOB_TRANSITION_INVALID'); END;

CREATE TRIGGER background_job_identity BEFORE UPDATE ON background_jobs
WHEN NEW.id != OLD.id OR NEW.owner_id != OLD.owner_id OR NEW.kind != OLD.kind OR NEW.dispatch_epoch != OLD.dispatch_epoch
  OR (OLD.manifest_sha256 IS NOT NULL AND (NEW.manifest_sha256 IS NOT OLD.manifest_sha256 OR NEW.input_bytes != OLD.input_bytes))
  OR (OLD.status NOT IN ('uploading', 'validating') AND NEW.total != OLD.total)
  OR NEW.lease_generation < OLD.lease_generation
BEGIN SELECT RAISE(ABORT, 'JOB_IDENTITY_IMMUTABLE'); END;

CREATE TABLE job_chunks (
  job_id TEXT NOT NULL REFERENCES background_jobs(id),
  stage TEXT NOT NULL CHECK (stage IN ('input', 'normalized', 'output')),
  chunk_index INTEGER NOT NULL CHECK (chunk_index BETWEEN 0 AND 511),
  object_key TEXT NOT NULL UNIQUE,
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 1048576),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, stage, chunk_index)
) STRICT;
CREATE TRIGGER input_chunk_frozen BEFORE INSERT ON job_chunks
WHEN NEW.stage = 'input' AND NOT EXISTS (
  SELECT 1 FROM background_jobs WHERE id = NEW.job_id AND kind = 'import' AND status = 'uploading' AND manifest_sha256 IS NULL
)
BEGIN SELECT RAISE(ABORT, 'MANIFEST_FROZEN'); END;
CREATE TRIGGER immutable_chunk BEFORE UPDATE ON job_chunks
BEGIN SELECT RAISE(ABORT, 'CHUNK_IMMUTABLE'); END;
CREATE TRIGGER live_chunk_retention BEFORE DELETE ON job_chunks
WHEN EXISTS (SELECT 1 FROM background_jobs WHERE id = OLD.job_id AND status NOT IN ('completed', 'failed', 'cancelled', 'expired'))
BEGIN SELECT RAISE(ABORT, 'CHUNK_STILL_REFERENCED'); END;

CREATE TABLE job_item_results (
  job_id TEXT NOT NULL REFERENCES background_jobs(id),
  source_index INTEGER NOT NULL CHECK (source_index >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'duplicate', 'trashed', 'invalid', 'write_failed')),
  error_code TEXT,
  lease_generation INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, source_index),
  CHECK (outcome NOT IN ('invalid', 'write_failed') OR error_code IS NOT NULL)
) STRICT;
CREATE TRIGGER item_result_insert_fence BEFORE INSERT ON job_item_results
WHEN NOT EXISTS (
  SELECT 1 FROM background_jobs WHERE id = NEW.job_id AND kind = 'import' AND status = 'running'
    AND NEW.source_index >= cursor AND NEW.source_index < total AND lease_generation = NEW.lease_generation
    AND lease_token IS NOT NULL AND lease_expires_at > unixepoch('subsec') * 1000
    AND dispatch_epoch = (SELECT dispatch_epoch FROM background_control WHERE singleton = 1 AND paused = 0)
)
BEGIN SELECT RAISE(ABORT, 'JOB_FENCE_REJECTED'); END;
CREATE TRIGGER item_result_update_fence BEFORE UPDATE ON job_item_results
WHEN NEW.job_id != OLD.job_id OR NEW.source_index != OLD.source_index
  OR (OLD.outcome != 'write_failed' AND NEW.outcome != OLD.outcome)
  OR NOT EXISTS (
    SELECT 1 FROM background_jobs WHERE id = NEW.job_id AND status = 'running' AND kind = 'import'
      AND lease_generation = NEW.lease_generation AND lease_token IS NOT NULL AND lease_expires_at > unixepoch('subsec') * 1000
      AND dispatch_epoch = (SELECT dispatch_epoch FROM background_control WHERE singleton = 1 AND paused = 0)
  )
BEGIN SELECT RAISE(ABORT, 'JOB_FENCE_REJECTED'); END;
CREATE TRIGGER item_result_insert_counts AFTER INSERT ON job_item_results
BEGIN
  UPDATE background_jobs SET
    succeeded = succeeded + (NEW.outcome = 'succeeded'), duplicate = duplicate + (NEW.outcome = 'duplicate'),
    trashed = trashed + (NEW.outcome = 'trashed'), invalid = invalid + (NEW.outcome = 'invalid'),
    write_failed = write_failed + (NEW.outcome = 'write_failed'), unprocessed = unprocessed - 1,
    updated_at = NEW.updated_at, version = version + 1 WHERE id = NEW.job_id;
END;
CREATE TRIGGER item_result_update_counts AFTER UPDATE OF outcome ON job_item_results
BEGIN
  UPDATE background_jobs SET
    succeeded = succeeded + (NEW.outcome = 'succeeded') - (OLD.outcome = 'succeeded'),
    duplicate = duplicate + (NEW.outcome = 'duplicate') - (OLD.outcome = 'duplicate'),
    trashed = trashed + (NEW.outcome = 'trashed') - (OLD.outcome = 'trashed'),
    invalid = invalid + (NEW.outcome = 'invalid') - (OLD.outcome = 'invalid'),
    write_failed = write_failed + (NEW.outcome = 'write_failed') - (OLD.outcome = 'write_failed'),
    updated_at = NEW.updated_at, version = version + 1 WHERE id = NEW.job_id;
END;

CREATE TRIGGER import_cursor_contiguous BEFORE UPDATE OF cursor ON background_jobs
WHEN NEW.kind = 'import' AND NEW.cursor != OLD.cursor AND (
  NEW.cursor < OLD.cursor OR NEW.cursor != (SELECT COUNT(*) FROM job_item_results WHERE job_id = NEW.id AND source_index < NEW.cursor)
)
BEGIN SELECT RAISE(ABORT, 'IMPORT_CURSOR_GAP'); END;

-- Retention cleanup may keep historical summary counts, but cannot erase live idempotency evidence.
CREATE TRIGGER item_result_retention BEFORE DELETE ON job_item_results
WHEN EXISTS (SELECT 1 FROM background_jobs WHERE id = OLD.job_id
  AND (status NOT IN ('completed', 'failed', 'cancelled', 'expired') OR results_expires_at > unixepoch('subsec') * 1000))
BEGIN SELECT RAISE(ABORT, 'RESULT_RETENTION_ACTIVE'); END;

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0 CHECK (chunk_index BETWEEN 0 AND 511),
  dispatch_epoch INTEGER NOT NULL,
  expected_cursor INTEGER NOT NULL DEFAULT 0 CHECK (expected_cursor >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at INTEGER NOT NULL,
  dispatch_token TEXT,
  dispatch_until INTEGER,
  sent_at INTEGER,
  handled_at INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id, dispatch_epoch) REFERENCES background_jobs(id, dispatch_epoch),
  CHECK ((dispatch_token IS NULL AND dispatch_until IS NULL) OR (dispatch_token IS NOT NULL AND dispatch_until IS NOT NULL)),
  CHECK (status != 'sent' OR sent_at IS NOT NULL),
  CHECK (status != 'failed' OR (error_code IS NOT NULL AND handled_at IS NOT NULL))
) STRICT;
CREATE INDEX outbox_dispatch ON outbox_events(status, available_at, dispatch_until);
CREATE INDEX outbox_job ON outbox_events(job_id, handled_at);
CREATE TRIGGER immutable_outbox_identity BEFORE UPDATE ON outbox_events
WHEN NEW.id != OLD.id OR NEW.job_id != OLD.job_id OR NEW.dispatch_epoch != OLD.dispatch_epoch
  OR NEW.chunk_index != OLD.chunk_index OR NEW.event_type != OLD.event_type OR NEW.expected_cursor != OLD.expected_cursor
BEGIN SELECT RAISE(ABORT, 'OUTBOX_IDENTITY_IMMUTABLE'); END;

-- A malformed/orphan message still has an observable failed outcome without trusting its owner/job fields.
CREATE TABLE background_failures (
  queue_name TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_attention' CHECK (status IN ('needs_attention', 'resolved')),
  error_code TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (queue_name, message_id)
) STRICT;
