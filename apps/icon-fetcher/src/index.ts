// This worker deliberately never reads a URL or makes a network request.
// The caller keeps its existing builtin icon/domain initial on this response.
export default {
  async fetch(): Promise<Response> {
    return Response.json({ error: {
      code: 'CAPABILITY_UNAVAILABLE',
      message: '自动图标的连接目标约束尚未验收，请使用本地图标。',
    }, fallback: 'builtin', status: 'unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  },
} satisfies ExportedHandler<IconBindings>;
