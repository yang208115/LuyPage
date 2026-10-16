import { consumeJobs, dispatchOutbox } from './background';

export default {
  async fetch(): Promise<Response> {
    return Response.json({ error: { code: 'CAPABILITY_UNAVAILABLE', message: '后台 Worker 不提供公开 HTTP 入口。' } },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  },
  async queue(batch: MessageBatch<unknown>, env: JobsBindings): Promise<void> {
    await consumeJobs(batch, env);
  },
  async scheduled(_controller: ScheduledController, env: JobsBindings): Promise<void> {
    await dispatchOutbox(env);
  },
} satisfies ExportedHandler<JobsBindings>;
