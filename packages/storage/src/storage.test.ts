import { describe, expect, it } from 'vitest';
import { assertCounts, assertJobTransition, initialCounts, parseJobMessage, replaceItemOutcome } from './jobs';
import { freezeManifest, immutableChunkKey, MAX_CHUNK_BYTES, readBoundedChunk, sha256, type ChunkIdentity, type ChunkReference } from './chunks';

const identity: ChunkIdentity = { kind: 'imports', stage: 'input', ownerId: 'owner', jobId: 'job', index: 0 };
const digest = 'a'.repeat(64);
const reference = (index = 0, bytes = 1): ChunkReference => ({ ...identity, index, bytes, sha256: digest, key: immutableChunkKey({ ...identity, index }, digest) });
const stream = (...parts: Uint8Array[]) => new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); } });

describe('item accounting and job transitions', () => {
  it('replaces a failed result without double counting, including duplicate delivery', () => {
    const start = initialCounts(3);
    const failed = replaceItemOutcome(start, null, 'write_failed');
    const retried = replaceItemOutcome(failed, 'write_failed', 'succeeded');
    expect(retried).toEqual({ total: 3, succeeded: 1, duplicate: 0, trashed: 0, invalid: 0, write_failed: 0, unprocessed: 2 });
    expect(replaceItemOutcome(retried, 'succeeded', 'succeeded')).toEqual(retried);
    expect(start.unprocessed).toBe(3);
  });
  it('keeps each outcome disjoint and rejects underflow/invalid totals', () => {
    let counts = initialCounts(5);
    for (const result of ['succeeded', 'duplicate', 'trashed', 'invalid', 'write_failed'] as const) counts = replaceItemOutcome(counts, null, result);
    expect(counts.unprocessed).toBe(0);
    expect(() => replaceItemOutcome(counts, null, 'succeeded')).toThrow('JOB_COUNTS_INVALID');
    expect(() => replaceItemOutcome(counts, 'duplicate', 'succeeded')).toThrow('ITEM_RESULT_IMMUTABLE');
    expect(() => assertCounts({ ...counts, total: 6 })).toThrow();
    for (const total of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => initialCounts(total)).toThrow();
  });
  it('requires frozen input, current confirmation and layout resolution', () => {
    expect(() => assertJobTransition('import', 'uploading', 'validating', { counts: initialCounts(0) })).toThrow('MANIFEST_NOT_FROZEN');
    expect(() => assertJobTransition('import', 'awaiting_confirmation', 'queued', { counts: initialCounts(0), manifestFrozen: true })).toThrow('PREVIEW_NOT_CONFIRMED');
    expect(() => assertJobTransition('import', 'running', 'completed', { counts: initialCounts(0) })).toThrow('JOB_NOT_COMPLETE');
    expect(() => assertJobTransition('import', 'running', 'completed', { counts: initialCounts(0), layoutResolved: true })).not.toThrow();
    expect(() => assertJobTransition('import', 'completed', 'running', { counts: initialCounts(0) })).toThrow('JOB_TRANSITION_INVALID');
  });
  it('does not accept a ready export without verified output', () => {
    expect(() => assertJobTransition('export', 'running', 'ready', { counts: initialCounts(0) })).toThrow('EXPORT_NOT_VERIFIED');
    expect(() => assertJobTransition('export', 'running', 'ready', { counts: initialCounts(0), objectVerified: true })).not.toThrow();
    expect(() => assertJobTransition('import', 'running', 'ready', { counts: initialCounts(0), objectVerified: true })).toThrow('JOB_KIND_STATE_INVALID');
  });
  it('accepts identifier-only queue messages, including a recovery epoch', () => {
    const input = { eventId: 'event', jobId: 'job', chunkIndex: 0, dispatchEpoch: 1 };
    expect(parseJobMessage(input)).toEqual(input);
    for (const invalid of [{ ...input, ownerId: 'claimed-owner' }, { ...input, chunkIndex: 512 }, { ...input, dispatchEpoch: 0 }, { ...input, jobId: '../job' }, null, [], 'body']) expect(parseJobMessage(invalid)).toBeNull();
  });
});

describe('bounded immutable chunks', () => {
  it('hashes actual bytes and checks exact lengths across stream boundaries', async () => {
    const bytes = await readBoundedChunk(stream(new Uint8Array([97]), new Uint8Array([98, 99])), 3);
    expect(await sha256(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await expect(readBoundedChunk(stream(bytes), 2)).rejects.toThrow('CHUNK_LENGTH_MISMATCH');
    await expect(readBoundedChunk(stream())).rejects.toThrow('CHUNK_EMPTY');
  });
  it('accepts exactly one MiB and cancels after actual bytes exceed it', async () => {
    expect((await readBoundedChunk(stream(new Uint8Array(MAX_CHUNK_BYTES)))).length).toBe(MAX_CHUNK_BYTES);
    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_CHUNK_BYTES)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
    await expect(readBoundedChunk(oversized)).rejects.toThrow('CHUNK_TOO_LARGE');
    expect(cancelled).toBe(true);
  });
  it('keys partition owner/job/index/hash and reject path injection', () => {
    expect(immutableChunkKey(identity, digest)).not.toBe(immutableChunkKey({ ...identity, ownerId: 'other' }, digest));
    expect(immutableChunkKey(identity, digest)).not.toBe(immutableChunkKey(identity, 'b'.repeat(64)));
    for (const ownerId of ['../x', 'x/y', '%2f', '', 'https://site']) expect(() => immutableChunkKey({ ...identity, ownerId }, digest)).toThrow('OBJECT_IDENTITY_INVALID');
  });
  it('freezes a contiguous ordered manifest and protects its copied references', async () => {
    const chunks = [reference(0), reference(1)];
    const manifest = await freezeManifest(chunks, 'json');
    chunks[0]!.bytes = 7;
    expect(manifest.totalBytes).toBe(2);
    expect(manifest.chunks[0]!.bytes).toBe(1);
    expect(Object.isFrozen(manifest.chunks[0])).toBe(true);
    await expect(freezeManifest([reference(1), reference(0)], 'json')).rejects.toThrow('MANIFEST_ENTRY_INVALID');
    await expect(freezeManifest([reference(0), { ...reference(1), ownerId: 'other' }], 'json')).rejects.toThrow();
  });
  it('retains the 512 MiB JSON design budget without claiming to process that file', async () => {
    const chunks = Array.from({ length: 512 }, (_, index) => reference(index, MAX_CHUNK_BYTES));
    expect((await freezeManifest(chunks, 'json')).totalBytes).toBe(512 * MAX_CHUNK_BYTES);
    await expect(freezeManifest(chunks, 'html')).rejects.toThrow('FILE_TOO_LARGE');
    await expect(freezeManifest([...chunks, chunks[0]!], 'json')).rejects.toThrow('MANIFEST_SIZE_INVALID');
  });
});
