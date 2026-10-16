import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { createMiddleware } from 'hono/factory';
import { AppError } from '@luypage/contracts';
import { ensureIdentity } from '@luypage/persistence';
import type { AppEnv } from './context';

// Only public signing-key resolvers are cached; identities stay in request context.
const keyResolvers = new Map<string, JWTVerifyGetKey>();
function accessConfiguration(bindings: ApiBindings) {
  const { ACCESS_ISSUER: issuer, ACCESS_AUD: audience, APP_ORIGIN: origin } = bindings;
  if (!issuer || !audience || !origin) throw new AppError('AUTH_NOT_CONFIGURED', '登录服务尚未配置。', 503);
  let url: URL;
  let app: URL;
  try { url = new URL(issuer); app = new URL(origin); } catch { throw new AppError('AUTH_NOT_CONFIGURED', '登录服务配置无效。', 503); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.cloudflareaccess.com') || url.origin !== issuer || app.protocol !== 'https:' || app.origin !== origin) {
    throw new AppError('AUTH_NOT_CONFIGURED', '登录服务配置无效。', 503);
  }
  return { issuer, audience };
}

export const accessAuth = createMiddleware<AppEnv>(async (c, next) => {
  const { issuer, audience } = accessConfiguration(c.env);
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) throw new AppError('UNAUTHENTICATED', '会话已过期，请重新登录。', 401);
  let resolver = keyResolvers.get(issuer);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5_000 });
    keyResolvers.set(issuer, resolver);
  }
  let identity: { subject: string; displayName: string };
  try {
    const { payload } = await jwtVerify(token, resolver, { issuer, audience, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat', 'aud', 'iss'] });
    if (typeof payload.sub !== 'string' || !payload.sub || payload.type !== 'app') throw new Error('Invalid identity');
    identity = { subject: payload.sub, displayName: typeof payload.email === 'string' ? payload.email : '我的账号' };
  } catch {
    throw new AppError('UNAUTHENTICATED', '会话无效或已过期，请重新登录。', 401);
  }
  const ownerId = await ensureIdentity(c.env.DB, { provider: 'cloudflare-access', issuer, ...identity });
  c.set('ownerId', ownerId); c.set('displayName', identity.displayName); c.set('isLocal', false);
  await next();
});
