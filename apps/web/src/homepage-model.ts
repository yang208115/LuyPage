import type { HomepagePreferences } from '@luypage/contracts';

export const WALLPAPERS = [
  { id: 'sunset-fields', name: '田野夕阳', caption: '让日常慢一点' },
  { id: 'blue-lake', name: '湖泊群山', caption: '山水之间，心有余闲' },
  { id: 'night-forest', name: '夜色森林', caption: '在安静里，找到灵感' },
] as const;
export const SEARCH_OPTIONS = [
  { id: 'bing', name: '必应', hint: '搜索广阔世界' },
  { id: 'baidu', name: '百度', hint: '搜索广阔世界' },
  { id: 'google', name: 'Google', hint: '搜索广阔世界' },
  { id: 'bookmarks', name: '我的收藏', hint: '搜索自己的收藏' },
] as const;
export function externalSearchUrl(provider: HomepagePreferences['searchProvider'], query: string): string | null {
  const value = query.trim();
  if (!value || provider === 'bookmarks') return null;
  const destinations = { bing: ['https://www.bing.com/search', 'q'], baidu: ['https://www.baidu.com/s', 'wd'], google: ['https://www.google.com/search', 'q'] } as const;
  const [base, key] = destinations[provider];
  const url = new URL(base);
  url.searchParams.set(key, value);
  return url.href;
}
export function calendarDays(year: number, month: number): (number | null)[] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  return [...Array<null>(offset).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
}
