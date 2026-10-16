import { describe, expect, it } from 'vitest';
import { emptyNavigation, navigationUrl, parseNavigation } from '../../apps/web/src/NavigationState';
import { calendarDays, externalSearchUrl } from '../../apps/web/src/homepage-model';

describe('homepage navigation and search', () => {
  it('defaults to homepage and preserves existing collection links', () => {
    expect(parseNavigation('').view).toBe('home');
    expect(parseNavigation('?view=library').view).toBe('library');
    expect(parseNavigation('?view=trash&q=test').view).toBe('trash');
    for (const search of ['?q=中文', '?groupId=ungrouped', '?tagIds=a,b', '?pinned=false', '?sort=title', '?view=home&q=old']) expect(parseNavigation(search).view).toBe('library');
    expect(navigationUrl({ ...emptyNavigation, view: 'home' })).toBe('/');
    const state = { ...emptyNavigation, q: '中文 & ? #', tagIds: ['a', 'b'] };
    expect(parseNavigation(navigationUrl(state).split('?')[1]!)).toEqual(state);
  });
  it('encodes a query as a value without allowing navigation injection', () => {
    const query = '猫 & q=other # /你好?';
    for (const [provider, host, param] of [['bing', 'www.bing.com', 'q'], ['baidu', 'www.baidu.com', 'wd'], ['google', 'www.google.com', 'q']] as const) {
      const url = new URL(externalSearchUrl(provider, query)!);
      expect(url.hostname).toBe(host); expect(url.searchParams.get(param)).toBe(query); expect(url.hash).toBe('');
    }
    expect(externalSearchUrl('bing', '   ')).toBeNull();
    expect(externalSearchUrl('bookmarks', query)).toBeNull();
  });
  it('lays out leap years and month boundaries with Monday as the first weekday', () => {
    expect(calendarDays(2024, 1).filter(Boolean)).toHaveLength(29);
    expect(calendarDays(2025, 1).filter(Boolean)).toHaveLength(28);
    expect(calendarDays(2026, 2)[6]).toBe(1);
    expect(calendarDays(2026, 12)).toEqual(calendarDays(2027, 0));
  });
});
