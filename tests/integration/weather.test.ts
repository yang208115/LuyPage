import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMiddleware } from 'hono/factory';
import { createApp } from '../../apps/api/src/app';
import type { AppEnv } from '../../apps/api/src/context';
import { AppError } from '@luypage/contracts';

const app = createApp(createMiddleware<AppEnv>(async (c, next) => {
  if (!c.req.header('X-Test-Owner')) throw new AppError('AUTH_REQUIRED', '请先登录', 401);
  c.set('ownerId', c.req.header('X-Test-Owner')!); await next();
}));
const request = (path: string) => app.request(`https://example.test/api${path}`, { headers: { 'X-Test-Owner': 'weather-test', Cookie: 'private-session=never-forward' } }, env);
const conditions = () => ({ current: { time: 1793073600, temperature_2m: 18.4, apparent_temperature: 17.6, relative_humidity_2m: 65, wind_speed_10m: 12.7, weather_code: 3, is_day: 1 }, daily: { temperature_2m_min: [13.2], temperature_2m_max: [21.7] } });
afterEach(() => vi.restoreAllMocks());

describe('weather API', () => {
  it('estimates a clearly labeled network city only from Cloudflare request metadata', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const result = await app.fetch(new Request('https://example.test/api/weather/location', { headers: { 'X-Test-Owner': 'weather-test' }, cf: { city: 'Taipei', country: 'TW', latitude: '25.03396', longitude: '121.56447' } }), env);
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await result.json()).toEqual({ location: { name: 'Taipei · TW（网络估算）', latitude: 25.03, longitude: 121.56 } });
    const missing = await app.request('https://example.test/api/weather/location', { headers: { 'X-Test-Owner': 'weather-test', 'CF-IPCity': 'spoofed', 'CF-IPLatitude': '25', 'CF-IPLongitude': '121' } }, env);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ error: { code: 'LOCATION_UNAVAILABLE' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rounds coordinates, caches public weather and never forwards identity headers', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      // Construct the real Workers Request so unsupported fetch modes cannot hide behind a mock.
      const outbound = new Request(url, init);
      expect(outbound.redirect).toBe('manual');
      return Response.json(conditions());
    });
    const first = await request('/weather?latitude=25.03396&longitude=121.56447');
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await first.json()).toMatchObject({ temperature: 18.4, apparentTemperature: 17.6, humidity: 65, windSpeed: 12.7, code: 3, isDay: true, low: 13.2, high: 21.7, observedAt: 1793073600000 });
    const [target, init] = fetch.mock.calls[0]!;
    const url = new URL(String(target));
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(url.searchParams.get('latitude')).toBe('25.03'); expect(url.searchParams.get('longitude')).toBe('121.56');
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    expect(new Headers(init?.headers).has('X-Test-Owner')).toBe(false);
    expect((await request('/weather?latitude=25.03&longitude=121.56')).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('returns disambiguated city choices and supports empty search results', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ results: [{ name: '台北', admin1: '台湾', country: '台湾', latitude: 25.03396, longitude: 121.56447 }] })).mockResolvedValueOnce(Response.json({}));
    expect(await (await request('/weather/locations?q=Taipei')).json()).toEqual({ locations: [{ name: '台北 · 台湾', latitude: 25.03, longitude: 121.56 }] });
    expect(new URL(String(fetch.mock.calls[0]![0])).hostname).toBe('geocoding-api.open-meteo.com');
    expect(await (await request('/weather/locations?q=NoSuchWeatherCity')).json()).toEqual({ locations: [] });
  });
  it('rejects invalid input and unauthenticated requests before fetching', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const path of ['/weather?latitude=&longitude=1', '/weather?latitude=91&longitude=1', '/weather?latitude=1&longitude=181', '/weather?latitude=https://evil.test&longitude=1', '/weather/locations?q=a']) expect((await request(path)).status).toBe(422);
    expect((await app.request('https://example.test/api/weather?latitude=1&longitude=2', {}, env)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('turns upstream errors, missing values and oversized data into retryable failures', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const responses = [new Response('unavailable', { status: 429 }), Response.json({ ...conditions(), current: { ...conditions().current, temperature_2m: null } }), new Response('x'.repeat(65 * 1024)), new Response('not-json'), new Response(null, { status: 302, headers: { Location: 'https://other.example' } })];
    for (const [index, response] of responses.entries()) {
      fetch.mockResolvedValueOnce(response);
      const result = await request(`/weather?latitude=${30 + index}&longitude=120`);
      expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ error: { code: 'WEATHER_UNAVAILABLE' } });
    }
    fetch.mockRejectedValueOnce(new DOMException('timed out', 'AbortError'));
    expect((await request('/weather?latitude=40&longitude=120')).status).toBe(503);
  });
});
