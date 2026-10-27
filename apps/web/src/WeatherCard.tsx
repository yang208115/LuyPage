import { useQuery } from '@tanstack/react-query';
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, MapPin, Moon, RefreshCw, Sun } from 'lucide-react';
import type { WeatherConditions, WeatherLocation } from '@luypage/contracts';
import { useSession } from './session';
import { describeWeather } from './weather-model';

const icons = { sun: Sun, moon: Moon, partly: CloudSun, cloud: Cloud, fog: CloudFog, rain: CloudRain, snow: CloudSnow, storm: CloudLightning };
export function WeatherCard({ location, onConfigure }: { location: WeatherLocation | null; onConfigure: () => void }) {
  const { session, send, expired } = useSession();
  const weather = useQuery({
    queryKey: ['private', session.user.id, 'weather', location?.latitude, location?.longitude],
    queryFn: ({ signal }) => send<WeatherConditions>(`/api/weather?${new URLSearchParams({ latitude: String(location!.latitude), longitude: String(location!.longitude) })}`, { signal }),
    enabled: !!location && !expired, staleTime: 600_000, refetchInterval: 600_000, retry: false,
  });
  const data = location ? weather.data : undefined;
  const description = describeWeather(data?.code ?? -1, data?.isDay);
  const Icon = icons[description.icon];
  return <section className="home-weather home-tile" aria-label="天气">
    <header><button className="weather-location" onClick={onConfigure} aria-label="选择天气城市" title={location?.name ?? '选择城市或使用当前位置'}><MapPin size={14} /><span>{location?.name ?? '窗外的天气'}</span></button>
      {location && <button className="home-icon-button" aria-label="刷新天气" disabled={weather.isFetching || expired} onClick={() => void weather.refetch()}><RefreshCw size={14} className={weather.isFetching ? 'spin' : ''} /></button>}</header>
    {!location ? <div className="weather-empty"><CloudSun size={32} strokeWidth={1.4} /><p>看看今天的天气</p><button onClick={onConfigure}>选择城市或定位</button></div> : data ? <>
      <div className="weather-current"><strong>{Math.round(data.temperature)}<small>°C</small></strong><Icon size={38} strokeWidth={1.4} /></div>
      <div className="weather-summary"><span>{description.label}</span><span>{Math.round(data.low)}° / {Math.round(data.high)}°</span></div>
      <p className="weather-details">体感 {Math.round(data.apparentTemperature)}° · 湿度 {Math.round(data.humidity)}% · 风 {Math.round(data.windSpeed)} km/h</p>
      <small className="weather-updated">{Date.now() - data.observedAt > 3_600_000 ? '较早数据 · ' : ''}<time dateTime={new Date(data.observedAt).toISOString()}>{new Date(data.observedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time> 更新</small>
    </> : weather.isPending ? <p className="weather-status" role="status">正在获取天气…</p> : null}
    {weather.error && location && <p className="weather-status weather-error" role="alert">{data ? '刷新失败，暂显示上次天气。' : '天气暂时不可用。'}<button disabled={weather.isFetching || expired} onClick={() => void weather.refetch()}>重试</button></p>}
    <a className="weather-credit" href="https://open-meteo.com/" target="_blank" rel="noreferrer">天气 · Open-Meteo</a>
  </section>;
}
