import type { Hono } from 'hono';
import type { AppEnv } from './context';
import { importInputSchema } from '@luypage/contracts';
import { importBookmarks, exportBookmarks } from '@luypage/persistence';

export function registerTransferRoutes(app: Hono<AppEnv>): void {
  app.post('/api/imports', async c => {
    const input = importInputSchema.parse(await c.req.json());
    return c.json(await importBookmarks(c.env.DB, c.get('ownerId'), input.operationId, input.document));
  });
  app.get('/api/exports', async c => c.json(await exportBookmarks(c.env.DB, c.get('ownerId'))));
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
