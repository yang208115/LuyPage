import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, LocateFixed, Search } from 'lucide-react';
import type { WeatherLocation } from '@luypage/contracts';
import { useSession } from './session';
import { ErrorNotice } from './ui';

export function WeatherSettings({ location, onChange, onBusyChange, disabled }: {
  location: WeatherLocation | null; onChange: (location: WeatherLocation | null) => void; onBusyChange: (busy: boolean) => void; disabled: boolean;
}) {
  const { session, send, expired } = useSession();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [locating, setLocating] = useState(false);
  const [networkLocating, setNetworkLocating] = useState(false);
  const networkRequest = useRef<AbortController | null>(null);
  const [locationError, setLocationError] = useState<Error | null>(null);
  const mounted = useRef(true);
  const change = useRef(onChange); change.current = onChange;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; networkRequest.current?.abort(); }; }, []);
  const search = useQuery({
    queryKey: ['private', session.user.id, 'weather-cities', term],
    queryFn: ({ signal }) => send<{ locations: WeatherLocation[] }>(`/api/weather/locations?${new URLSearchParams({ q: term })}`, { signal }),
    enabled: term.length >= 2 && !expired, staleTime: 86_400_000, retry: false,
  });
  function findCity() {
    const next = query.trim(); if (next.length < 2) return;
    setLocationError(null);
    if (next === term) void search.refetch(); else setTerm(next);
  }
  function locate() {
    if (!navigator.geolocation) { setLocationError(new Error('当前浏览器不支持定位，请手动选择城市。')); return; }
    setLocating(true); onBusyChange(true); setLocationError(null);
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current) return;
      change.current({ name: '当前位置', latitude: Math.round(position.coords.latitude * 100) / 100, longitude: Math.round(position.coords.longitude * 100) / 100 });
      setLocating(false); onBusyChange(false);
    }, error => {
      if (!mounted.current) return;
      setLocationError(new Error(error.code === 1 ? '定位权限未开启，请在浏览器中允许定位，或手动选择城市。' : error.code === 3 ? '定位超时，请重试或手动选择城市。' : '暂时无法获取位置，请重试或手动选择城市。'));
      setLocating(false); onBusyChange(false);
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 });
  }
  async function locateNetwork() {
    const controller = new AbortController(); networkRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    setNetworkLocating(true); onBusyChange(true); setLocationError(null);
    try {
      const result = await send<{ location: WeatherLocation }>('/api/weather/location', { signal: controller.signal });
      if (mounted.current) change.current(result.location);
    } catch (cause) { if (mounted.current) setLocationError(cause instanceof DOMException && cause.name === 'AbortError' ? new Error('网络定位超时，请重试或手动选择城市。') : cause instanceof Error ? cause : new Error('网络定位未完成，请手动选择城市。')); }
    finally { window.clearTimeout(timeout); if (mounted.current) { setNetworkLocating(false); onBusyChange(false); } networkRequest.current = null; }
  }
  return <section className="weather-settings" aria-label="天气位置设置">
    <div className="weather-selected"><span>{location ? `已选择：${location.name}` : '还没有选择天气位置'}</span><div className="weather-location-actions"><button type="button" disabled={disabled || locating || networkLocating} onClick={locate}><LocateFixed size={15} />{locating ? '正在定位…' : '使用当前位置'}</button><button type="button" disabled={disabled || locating || networkLocating} onClick={() => void locateNetwork()}>{networkLocating ? '正在估算…' : '按网络估算城市'}</button></div></div>
    <p className="form-hint">仅在点击时定位。取整后的位置用于 Open-Meteo 天气查询，保存后随账号同步；也可以手动选择城市。</p>
    <p className="form-hint">浏览器定位不可用时可按网络估算，结果可能受代理或 VPN 影响。</p>
    {locating && <p role="status">请在浏览器提示中允许定位…</p>}
    <ErrorNotice error={locationError} />
    <div className="weather-search"><label className="field"><span>天气城市</span><input value={query} maxLength={80} placeholder="搜索城市，如北京、台北" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); findCity(); } }} /></label>
      <button type="button" disabled={disabled || locating || search.isFetching || query.trim().length < 2} onClick={findCity}><Search size={15} />搜索城市</button></div>
    {search.isFetching && <p role="status">正在搜索城市…</p>}
    <ErrorNotice error={search.error} retry={findCity} />
    {term && search.data && <div className="weather-city-results" aria-label="天气城市搜索结果">{search.data.locations.length ? search.data.locations.map(city => <button type="button" key={`${city.latitude}:${city.longitude}:${city.name}`} aria-pressed={location?.latitude === city.latitude && location.longitude === city.longitude} disabled={disabled || locating} onClick={() => { setLocationError(null); onChange(city); }}><span>{city.name}</span>{location?.latitude === city.latitude && location.longitude === city.longitude && <Check size={15} />}</button>) : <p>没有找到城市，试试拼音或附近的大城市。</p>}</div>}
    {location && <button type="button" className="text-button" disabled={disabled || locating} onClick={() => onChange(null)}>清除天气位置</button>}
  </section>;
}
