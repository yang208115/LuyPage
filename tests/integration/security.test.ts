import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { createMiddleware } from 'hono/factory';
import { createApp } from '../../apps/api/src/app';
import { accessAuth } from '../../apps/api/src/auth';
import type { AppEnv } from '../../apps/api/src/context';

const testAuth = createMiddleware<AppEnv>(async (c, next) => {
  c.set('ownerId', 'security-test-user'); c.set('displayName', '测试'); c.set('isLocal', false);
  await next();
});
const protectedApp = createApp(accessAuth);
const app = createApp(testAuth);

describe('authentication and request boundary', () => {
  it('fails closed when Access has not been configured', async () => {
    const response = await protectedApp.request('https://private.example/api/session', {}, env);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_NOT_CONFIGURED' } });
  });
  it('does not trust a forged email or user header', async () => {
    const response = await protectedApp.request('https://private.example/api/session', { headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com', 'X-User-Id': 'someone' } }, { ...env, ACCESS_ISSUER: 'https://test-team.cloudflareaccess.com', ACCESS_AUD: 'audience', APP_ORIGIN: 'https://private.example' });
    expect(response.status).toBe(401);
  });
  it('rejects malformed JWTs before creating an identity', async () => {
    const response = await protectedApp.request('https://private.example/api/session', { headers: { 'Cf-Access-Jwt-Assertion': 'not-a-jwt' } }, { ...env, ACCESS_ISSUER: 'https://test-team.cloudflareaccess.com', ACCESS_AUD: 'audience', APP_ORIGIN: 'https://private.example' });
    expect(response.status).toBe(401);
  });
  it('rejects absent and foreign Origin on write requests', async () => {
    for (const origin of [undefined, 'https://evil.example']) {
      const response = await app.request('http://localhost/api/imports', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: '{}' }, env);
      expect(response.status).toBe(403);
    }
  });
  it('rejects non-JSON writes', async () => {
    const response = await app.request('http://localhost/api/imports', { method: 'POST', headers: { Origin: env.APP_ORIGIN, 'Content-Type': 'text/plain' }, body: '{}' }, env);
    expect(response.status).toBe(415);
  });
  it('returns JSON 404 instead of the SPA and never invents transfer success', async () => {
    const missing = await app.request('http://localhost/api/missing', {}, env);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
    const unavailable = await app.request('http://localhost/api/imports', { method: 'POST', headers: { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json' }, body: '{}' }, env);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ error: { code: 'CAPABILITY_UNAVAILABLE' } });
  });
});

describe('Access JWT cryptographic verification', () => {
  it('accepts the signed issuer/audience and rejects expired, wrong-audience and forged tokens', async () => {
    const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
    const { vi } = await import('vitest');
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    const issuer = 'https://signed-test.cloudflareaccess.com';
    const bindings = { ...env, ACCESS_ISSUER: issuer, ACCESS_AUD: 'luypage-test', APP_ORIGIN: 'https://private.example' };
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }));
    const sign = (audience: string, expiration: string | number = '5m') => new SignJWT({ type: 'app', email: 'owner@example.test' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience(audience).setSubject('signed-owner').setIssuedAt().setExpirationTime(expiration).sign(privateKey);
    try {
      const valid = await sign('luypage-test');
      const request = (token: string) => protectedApp.request('https://private.example/api/session', { headers: { 'Cf-Access-Jwt-Assertion': token } }, bindings);
      const response = await request(valid);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ user: { displayName: 'owner@example.test' }, local: false });
      expect(mock).toHaveBeenCalledTimes(1);
      expect((await request(await sign('other-app'))).status).toBe(401);
      expect((await request(await sign('luypage-test', Math.floor(Date.now() / 1000) - 60))).status).toBe(401);
      const parts = valid.split('.');
      const signature = parts[2]!;
      parts[2] = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
      expect((await request(parts.join('.'))).status).toBe(401);
    } finally { mock.mockRestore(); }
  });
});
