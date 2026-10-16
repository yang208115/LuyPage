import type { Hono } from 'hono';
import type { AppEnv } from './context';

export function registerTransferRoutes(app: Hono<AppEnv>): void {
  // Authentication, origin checks, and request IDs belong to the API entry point.
  for (const path of ['/api/imports', '/api/imports/*', '/api/exports', '/api/exports/*']) app.all(path, (context) => {
    context.header('Cache-Control', 'no-store');
    return context.json({ error: {
      code: 'CAPABILITY_UNAVAILABLE',
      message: '导入导出任务管线尚未完成，当前不可用。',
      requestId: context.get('requestId'),
    } }, 503);
  });
}
