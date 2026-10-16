import type { Hono } from 'hono';
import { AppError, idSchema } from '@luypage/contracts';
import { findBookmark } from '@luypage/persistence';
import { readState, preferencesOf } from '../../../packages/persistence/src/database';
import type { AppEnv } from './context';

const MAX_ICON_BYTES = 128 * 1024;
export function publicIconHostname(url: string): string | null {
  try {
    const parsed = new URL(url); const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null;
    if (host.length > 253 || !host.includes('.') || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    if (/^[0-9.]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion|lan|home|arpa)$/.test(host)) return null;
    return host;
  } catch { return null; }
}

export async function fetchWebsiteIcon(hostname: string): Promise<Response> {
  // The destination is constant. User domains are path data, never connection targets.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`, {
      redirect: 'manual', signal: controller.signal, headers: { Accept: 'image/png,image/x-icon,image/vnd.microsoft.icon' },
    });
    if (!response.ok || !response.body) throw new Error('ICON_UNAVAILABLE');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > MAX_ICON_BYTES) { await reader.cancel(); throw new Error('ICON_TOO_LARGE'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const png = bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
    const ico = bytes.length >= 22 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0 && (bytes[4]! + bytes[5]! * 256) > 0;
    const type = response.headers.get('content-type')?.split(';')[0]?.toLowerCase();
    if ((!png && !ico) || !['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(type ?? '')) throw new Error('ICON_TYPE');
    return new Response(bytes, { headers: { 'Content-Type': png ? 'image/png' : 'image/x-icon', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    throw new AppError('ICON_UNAVAILABLE', '无法获取网站图标，已使用默认图标。', 404);
  } finally { clearTimeout(timeout); controller.abort(); }
}

export function registerIconRoutes(app: Hono<AppEnv>): void {
  app.get('/api/bookmarks/:id/icon', async c => {
    const ownerId = c.get('ownerId');
    if (!preferencesOf(await readState(c.env.DB, ownerId)).autoIcons) throw new AppError('ICON_DISABLED', '自动图标已关闭。', 404);
    const bookmark = await findBookmark(c.env.DB, ownerId, idSchema.parse(c.req.param('id')));
    if (!bookmark || bookmark.deleted_at || bookmark.icon_type !== 'auto') throw new AppError('NOT_FOUND', '找不到图标。', 404);
    const hostname = publicIconHostname(bookmark.url);
    if (!hostname) throw new AppError('ICON_UNAVAILABLE', '此网址使用默认图标。', 404);
    return fetchWebsiteIcon(hostname);
  });
}
