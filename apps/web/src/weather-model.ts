export function describeWeather(code: number, isDay = true): { label: string; icon: 'sun' | 'moon' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm' } {
  if (code === 0) return { label: '晴', icon: isDay ? 'sun' : 'moon' };
  if (code === 1 || code === 2) return { label: code === 1 ? '晴间多云' : '多云', icon: 'partly' };
  if (code === 3) return { label: '阴', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: '雾', icon: 'fog' };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: '毛毛雨', icon: 'rain' };
  if ([61, 63, 65, 66, 67].includes(code)) return { label: code === 65 ? '大雨' : '雨', icon: 'rain' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: '雪', icon: 'snow' };
  if ([80, 81, 82].includes(code)) return { label: '阵雨', icon: 'rain' };
  if ([95, 96, 99].includes(code)) return { label: code === 95 ? '雷雨' : '雷雨伴冰雹', icon: 'storm' };
  return { label: '天气未知', icon: 'cloud' };
}
