// Only wrangler.local.jsonc references this entry. It is absent from the production import graph.
import { createMiddleware } from 'hono/factory';
import { AppError } from '@luypage/contracts';
import { ensureIdentity } from '@luypage/persistence';
import { createApp } from './app';
import type { AppEnv } from './context';

const localAuth = createMiddleware<AppEnv>(async (c, next) => {
  const host = new URL(c.req.url).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new AppError('LOCAL_ONLY', '本地开发入口仅允许回环地址访问。', 403);
  const ownerId = await ensureIdentity(c.env.DB, { provider: 'local-development', issuer: 'http://localhost', subject: 'local-owner', displayName: '本地开发账号' });
  c.set('ownerId', ownerId); c.set('displayName', '本地开发账号'); c.set('isLocal', true);
  await next();
});
export default createApp(localAuth);
