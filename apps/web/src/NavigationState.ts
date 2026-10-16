import { useEffect, useRef, useState } from 'react';
import type { BookmarkQuery, Sort } from '@luypage/contracts';

export interface NavigationState {
  view: 'home' | 'library' | 'trash'; q: string; groupId: string; tagIds: string[]; pinned: boolean | undefined; sort: Sort;
}
export const emptyNavigation: NavigationState = { view: 'library', q: '', groupId: '', tagIds: [], pinned: undefined, sort: 'manual' };
export function parseNavigation(search: string): NavigationState {
  const params = new URLSearchParams(search);
  const sort = params.get('sort');
  const legacyFilters = ['q', 'groupId', 'tagIds', 'pinned', 'sort'].some(key => params.has(key));
  const view = params.get('view');
  return {
    view: view === 'trash' ? 'trash' : view === 'library' || legacyFilters ? 'library' : 'home', q: (params.get('q') ?? '').slice(0, 2000),
    groupId: params.get('groupId') ?? '', tagIds: [...new Set((params.get('tagIds') ?? '').split(',').filter(Boolean))].slice(0, 20),
    pinned: params.get('pinned') === 'true' ? true : params.get('pinned') === 'false' ? false : undefined,
    sort: sort === 'created' || sort === 'updated' || sort === 'title' ? sort : 'manual',
  };
}
export function navigationUrl(state: NavigationState, pathname = '/'): string {
  const params = new URLSearchParams();
  if (state.view !== 'home') params.set('view', state.view);
  if (state.q) params.set('q', state.q);
  if (state.groupId) params.set('groupId', state.groupId);
  if (state.tagIds.length) params.set('tagIds', state.tagIds.join(','));
  if (state.pinned !== undefined) params.set('pinned', String(state.pinned));
  if (state.sort !== 'manual') params.set('sort', state.sort);
  return `${pathname}${params.size ? `?${params}` : ''}`;
}
export function useNavigation(guard: () => boolean) {
  const [state, setState] = useState(() => parseNavigation(window.location.search));
  const current = useRef(state); current.current = state;
  const latestGuard = useRef(guard); latestGuard.current = guard;
  useEffect(() => {
    const listener = () => {
      if (latestGuard.current()) setState(parseNavigation(window.location.search));
      else window.history.pushState(null, '', navigationUrl(current.current, window.location.pathname));
    };
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);
  function navigate(patch: Partial<NavigationState>, replace = false) {
    if (!latestGuard.current()) return false;
    const next = { ...current.current, ...patch };
    window.history[replace ? 'replaceState' : 'pushState'](null, '', navigationUrl(next, window.location.pathname));
    current.current = next; setState(next); return true;
  }
  return { state, navigate };
}
export function asQuery(state: NavigationState): BookmarkQuery {
  return { q: state.q, groupId: state.groupId || undefined, tagIds: state.tagIds, pinned: state.pinned, sort: state.sort };
}
export const hasFilters = (state: NavigationState) => !!(state.q || state.groupId || state.tagIds.length || state.pinned !== undefined || state.sort !== 'manual');
