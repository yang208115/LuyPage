import type { Hono } from 'hono';
import { z } from 'zod';
import { AppError, type WeatherConditions, type WeatherLocation } from '@luypage/contracts';
import type { AppEnv } from './context';

const coordinate = (min: number, max: number) => z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().min(min).max(max));
const coordinates = z.object({ latitude: coordinate(-90, 90), longitude: coordinate(-180, 180) });
const geocoding = z.object({ results: z.array(z.object({
  name: z.string().min(1).max(120), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  admin1: z.string().optional(), country: z.string().optional(),
})).max(10).optional() });
const forecast = z.object({
  current: z.object({ time: z.number(), temperature_2m: z.number(), apparent_temperature: z.number(),
    relative_humidity_2m: z.number().min(0).max(100), wind_speed_10m: z.number().nonnegative(), weather_code: z.number().int().min(0).max(99), is_day: z.union([z.literal(0), z.literal(1)]) }),
  daily: z.object({ temperature_2m_min: z.array(z.number()).length(1), temperature_2m_max: z.array(z.number()).length(1) }),
});

// Only fixed Open-Meteo hosts are called. No cookies, identity or request headers are forwarded.
async function meteo<T>(url: URL, schema: z.ZodType<T>, ttl: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  let stage = 'cache'; let upstreamStatus: number | undefined;
  try {
    const cache = await caches.open('luypage-weather-v1');
    const key = new Request(url);
    const cached = await cache.match(key).catch(() => undefined);
    if (cached) return schema.parse(await cached.json());
    stage = 'fetch';
    const response = await fetch(url, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'application/json' } });
    upstreamStatus = response.status;
    if (!response.ok || !response.body) throw new Error('WEATHER_UPSTREAM');
    stage = 'body';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > 64 * 1024) { await reader.cancel(); throw new Error('WEATHER_TOO_LARGE'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    stage = 'validate';
    const result = schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    await cache.put(key, Response.json(result, { headers: { 'Cache-Control': `public, max-age=${ttl}` } })).catch(() => undefined);
    return result;
  } catch (cause) {
    console.warn(JSON.stringify({ event: 'weather_unavailable', stage, upstreamStatus, type: cause instanceof Error ? cause.name : 'unknown',
      ...(cause instanceof z.ZodError ? { fields: cause.issues.map(issue => issue.path.join('.')) } : {}) }));
    throw new AppError('WEATHER_UNAVAILABLE', '天气服务暂时无法连接，请稍后重试。', 503);
  } finally { clearTimeout(timeout); controller.abort(); }
}

export function registerWeatherRoutes(app: Hono<AppEnv>): void {
  app.get('/api/weather/location', c => {
    const result = z.object({ city: z.string().trim().min(1).max(100), country: z.string().optional(), latitude: coordinate(-90, 90), longitude: coordinate(-180, 180) }).safeParse(c.req.raw.cf);
    if (!result.success) throw new AppError('LOCATION_UNAVAILABLE', '无法按网络估算城市，请使用浏览器定位或手动选择城市。', 503);
    const { city, country, latitude, longitude } = result.data;
    const location: WeatherLocation = { name: `${[city, country].filter(Boolean).join(' · ')}（网络估算）`.slice(0, 120), latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100 };
    return c.json({ location });
  });
  app.get('/api/weather/locations', async c => {
    const query = z.string().trim().min(2).max(80).parse(c.req.query('q'));
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: query, count: '6', language: 'zh', format: 'json' }).toString();
    const result = await meteo(url, geocoding, 86400);
    const locations: WeatherLocation[] = (result.results ?? []).map(item => ({
      name: [...new Set([item.name, item.admin1, item.country].filter(Boolean))].join(' · ').slice(0, 120),
      latitude: Math.round(item.latitude * 100) / 100, longitude: Math.round(item.longitude * 100) / 100,
    }));
    return c.json({ locations });
  });
  app.get('/api/weather', async c => {
    const input = coordinates.parse(c.req.query());
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: (Math.round(input.latitude * 100) / 100).toFixed(2), longitude: (Math.round(input.longitude * 100) / 100).toFixed(2),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m',
      daily: 'temperature_2m_min,temperature_2m_max', forecast_days: '1', timezone: 'auto', timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'kmh' }).toString();
    const { current, daily } = await meteo(url, forecast, 600);
    return c.json({ temperature: current.temperature_2m, apparentTemperature: current.apparent_temperature, humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m, code: current.weather_code, isDay: current.is_day === 1, low: daily.temperature_2m_min[0]!, high: daily.temperature_2m_max[0]!,
      observedAt: current.time * 1000, fetchedAt: Date.now() } satisfies WeatherConditions);
  });
}
