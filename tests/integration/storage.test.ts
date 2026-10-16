import { env } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';
import { putImmutableChunk, sha256 } from '../../packages/storage/src/chunks';

describe('local R2 immutable chunks', () => {
  it('verifies bytes, tolerates a duplicate PUT and preserves the object', async () => {
    const bytes = new TextEncoder().encode('中文内容和 UTF-8 分片');
    const identity = { ownerId: crypto.randomUUID(), jobId: crypto.randomUUID(), kind: 'imports' as const, stage: 'input' as const, index: 0 };
    const expected = { bytes: bytes.byteLength, sha256: await sha256(bytes) };
    const first = await putImmutableChunk(env.TEST_FILES, identity, new Response(bytes).body, expected);
    const second = await putImmutableChunk(env.TEST_FILES, identity, new Response(bytes).body, expected);
    expect(second).toEqual(first);
    const object = await env.TEST_FILES.get(first.key);
    expect(await object?.text()).toBe('中文内容和 UTF-8 分片');
    await expect(putImmutableChunk(env.TEST_FILES, identity, new Response('tampered').body, { bytes: 8, sha256: expected.sha256 })).rejects.toMatchObject({ code: 'CHUNK_DIGEST_MISMATCH' });
    expect((await env.TEST_FILES.list({ prefix: `imports/${identity.ownerId}/` })).objects).toHaveLength(1);
  });
});
