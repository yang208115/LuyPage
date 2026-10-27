import { describe, expect, it } from 'vitest';
import { describeWeather } from '../../apps/web/src/weather-model';

describe('weather descriptions', () => {
  it('distinguishes clear nights, precipitation, fog and thunderstorms', () => {
    expect(describeWeather(0, false)).toEqual({ label: '晴', icon: 'moon' });
    expect(describeWeather(0, true).icon).toBe('sun');
    expect(describeWeather(2).label).toBe('多云');
    expect(describeWeather(48).icon).toBe('fog');
    expect(describeWeather(65)).toEqual({ label: '大雨', icon: 'rain' });
    expect(describeWeather(86).icon).toBe('snow');
    expect(describeWeather(99).label).toBe('雷雨伴冰雹');
    expect(describeWeather(-1).label).toBe('天气未知');
  });
});
