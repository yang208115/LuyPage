import { isOpaqueId } from './jobs';

export const MAX_CHUNK_BYTES = 1024 * 1024;
export const MAX_JSON_BYTES = 512 * MAX_CHUNK_BYTES;
export const MAX_HTML_BYTES = 10_000_000;
export const MAX_CHUNKS = 512;

export class StorageError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'StorageError'; }
}
export interface ChunkIdentity { ownerId: string; jobId: string; kind: 'imports' | 'exports'; stage: 'input' | 'normalized' | 'output'; index: number }
export interface ChunkReference extends ChunkIdentity { key: string; bytes: number; sha256: string }

function assertDigest(digest: string): void {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new StorageError('DIGEST_INVALID');
}
export function immutableChunkKey(identity: ChunkIdentity, digest: string): string {
  assertDigest(digest);
  if (!isOpaqueId(identity.ownerId) || !isOpaqueId(identity.jobId)
    || !Number.isSafeInteger(identity.index) || identity.index < 0 || identity.index >= MAX_CHUNKS
    || (identity.kind !== 'imports' && identity.kind !== 'exports')
    || !(identity.kind === 'imports' ? ['input', 'normalized'] : ['output']).includes(identity.stage)) {
    throw new StorageError('OBJECT_IDENTITY_INVALID');
  }
  return `${identity.kind}/${identity.ownerId}/${identity.jobId}/${identity.stage}/${String(identity.index).padStart(6, '0')}-${digest}`;
}
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function readBoundedChunk(stream: ReadableStream<Uint8Array> | null, expectedBytes?: number): Promise<Uint8Array<ArrayBuffer>> {
  if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > MAX_CHUNK_BYTES)) throw new StorageError('CHUNK_SIZE_INVALID');
  if (!stream) throw new StorageError('CHUNK_EMPTY');
  const reader = stream.getReader();
  const buffer = new Uint8Array(MAX_CHUNK_BYTES);
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new StorageError('CHUNK_ENCODING_INVALID');
      if (length + value.byteLength > MAX_CHUNK_BYTES) throw new StorageError('CHUNK_TOO_LARGE');
      buffer.set(value, length);
      length += value.byteLength;
    }
    if (length === 0) throw new StorageError('CHUNK_EMPTY');
    if (expectedBytes !== undefined && length !== expectedBytes) throw new StorageError('CHUNK_LENGTH_MISMATCH');
    return buffer.slice(0, length);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function putImmutableChunk(
  bucket: Pick<R2Bucket, 'put' | 'get'>,
  identity: ChunkIdentity,
  body: ReadableStream<Uint8Array> | null,
  expected: { bytes: number; sha256: string },
): Promise<ChunkReference> {
  assertDigest(expected.sha256);
  // Validate the server-owned identity before reading untrusted bytes.
  immutableChunkKey(identity, expected.sha256);
  const bytes = await readBoundedChunk(body, expected.bytes);
  const digest = await sha256(bytes);
  if (digest !== expected.sha256) throw new StorageError('CHUNK_DIGEST_MISMATCH');
  const key = immutableChunkKey(identity, digest);
  const stored = await bucket.put(key, bytes, {
    onlyIf: new Headers({ 'If-None-Match': '*' }), sha256: digest,
    httpMetadata: { contentType: 'application/octet-stream' },
  });
  if (stored) {
    if (stored.size !== bytes.length) throw new StorageError('OBJECT_LENGTH_MISMATCH');
  } else {
    // A concurrent/retried PUT must never overwrite the existing object. Verify bytes, not custom metadata.
    const existing = await bucket.get(key);
    if (!existing) throw new StorageError('OBJECT_MISSING');
    const existingBytes = await readBoundedChunk(existing.body, bytes.length);
    if (await sha256(existingBytes) !== digest) throw new StorageError('OBJECT_DIGEST_MISMATCH');
  }
  return { ...identity, key, bytes: bytes.length, sha256: digest };
}

export async function freezeManifest(chunks: readonly ChunkReference[], format: 'json' | 'html') {
  if (format !== 'json' && format !== 'html') throw new StorageError('FORMAT_INVALID');
  if (chunks.length === 0 || chunks.length > MAX_CHUNKS) throw new StorageError('MANIFEST_SIZE_INVALID');
  const first = chunks[0]!;
  let totalBytes = 0;
  const entries = chunks.map((chunk, index) => {
    if (chunk.index !== index || chunk.ownerId !== first.ownerId || chunk.jobId !== first.jobId || chunk.kind !== first.kind || chunk.stage !== first.stage
      || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > MAX_CHUNK_BYTES
      || immutableChunkKey(chunk, chunk.sha256) !== chunk.key) throw new StorageError('MANIFEST_ENTRY_INVALID');
    totalBytes += chunk.bytes;
    return Object.freeze({ ...chunk });
  });
  if (totalBytes > (format === 'json' ? MAX_JSON_BYTES : MAX_HTML_BYTES)) throw new StorageError('FILE_TOO_LARGE');
  // This authenticates the ordered manifest, NOT the concatenated file's SHA-256.
  const digest = await sha256(new TextEncoder().encode(JSON.stringify(entries.map(({ key, bytes, sha256 }) => [key, bytes, sha256]))));
  return Object.freeze({ chunks: Object.freeze(entries), totalBytes, manifestSha256: digest });
}
