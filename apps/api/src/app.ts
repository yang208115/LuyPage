import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { AppError, MAX_TRANSFER_BYTES, type Session } from '@luypage/contracts';
import type { AppEnv } from './context';
import { registerRoutes } from './routes';
import { registerTransferRoutes } from './transfers';
import { registerIconRoutes } from './icons';

export function createApp(auth: MiddlewareHandler<AppEnv>) {
  const app = new Hono<AppEnv>();
  app.use('*', secureHeaders({ referrerPolicy: 'no-referrer' }));
  app.use('/api/*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Request-Id', c.get('requestId'));
    await next();
  });
  app.use('/api/*', auth);
  app.use('/api/*', (c, next) => bodyLimit({ maxSize: c.req.path === '/api/imports' ? MAX_TRANSFER_BYTES + 1024 : 1_048_576, onError: () => { throw new AppError('PAYLOAD_TOO_LARGE', '请求超过大小限制，请减少本次操作数量。', 413); } })(c, next));
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      if (!c.env.APP_ORIGIN || c.req.header('Origin') !== c.env.APP_ORIGIN) throw new AppError('ORIGIN_FORBIDDEN', '请求来源不受信任，请从应用页面重试。', 403);
      if (c.req.header('Sec-Fetch-Site') === 'cross-site') throw new AppError('ORIGIN_FORBIDDEN', '不允许跨站请求。', 403);
      if (c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new AppError('JSON_REQUIRED', '请使用 JSON 请求。', 415);
    }
    await next();
  });
  app.get('/api/session', c => c.json({ user: { id: c.get('ownerId'), displayName: c.get('displayName') }, local: c.get('isLocal'), loginUrl: '/', logoutUrl: c.get('isLocal') ? '/' : '/cdn-cgi/access/logout' } satisfies Session));
  registerRoutes(app);
  registerIconRoutes(app);
  registerTransferRoutes(app);
  app.notFound(c => c.json({ error: { code: 'NOT_FOUND', message: '请求的资源不存在。', requestId: c.get('requestId') ?? crypto.randomUUID() } }, 404));
  app.onError((error, c) => {
    const requestId = c.get('requestId') ?? crypto.randomUUID();
    if (error instanceof ZodError) return c.json({ error: { code: 'VALIDATION_ERROR', message: '请检查输入内容。', requestId, details: error.issues.map(({ path, message }) => ({ path, message })) } }, 422);
    if (error instanceof AppError) return Response.json({ error: { code: error.code, message: error.message, requestId, ...(error.details === undefined ? {} : { details: error.details }) } }, { status: error.status, headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId } });
    if (error instanceof SyntaxError) return c.json({ error: { code: 'INVALID_JSON', message: '请求内容不是有效的 JSON。', requestId } }, 422);
    // Do not log database errors: they can contain URLs, notes or bound values.
    console.error(JSON.stringify({ event: 'request_failed', requestId, code: 'INTERNAL_ERROR', method: c.req.method }));
    return c.json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时异常，请保留输入并重试。', requestId } }, 500);
  });
  return app;
}
