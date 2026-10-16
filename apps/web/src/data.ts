import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { BookmarkPage, BookmarkQuery, Bootstrap, Homepage, LayoutIndex } from '@luypage/contracts';
import { ApiError } from './api';
import { useSession } from './session';

export function useWorkspace(bootstrapEnabled = true, layoutEnabled = true) {
  const { session, send, expired } = useSession();
  const root = ['private', session.user.id] as const;
  const bootstrap = useQuery({ queryKey: [...root, 'bootstrap'], queryFn: ({ signal }) => send<Bootstrap>('/api/bootstrap', { signal }), enabled: bootstrapEnabled && !expired });
  const layout = useQuery({ queryKey: [...root, 'layout'], queryFn: ({ signal }) => send<LayoutIndex>('/api/layout/index', { signal }), enabled: layoutEnabled && !expired });
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: root });
  const freshLayout = () => client.fetchQuery({ queryKey: [...root, 'layout'], queryFn: ({ signal }) => send<LayoutIndex>('/api/layout/index', { signal }), staleTime: 0 });
  return { bootstrap, layout, refresh, freshLayout };
}

export function useHomepage() {
  const { session, send, expired } = useSession();
  const query = useQuery({ queryKey: ['private', session.user.id, 'homepage'], queryFn: ({ signal }) => send<Homepage>('/api/homepage', { signal }), enabled: !expired, refetchOnWindowFocus: 'always' });
  const { refetch } = query;
  useEffect(() => {
    if (expired) return;
    // Visibility changes are handled by Query; window focus also covers side-by-side sessions.
    const onFocus = () => { if (document.visibilityState === 'visible') void refetch(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [expired, refetch]);
  return query;
}

export function useBookmarks(filters: BookmarkQuery, trash = false, enabled = true) {
  const { session, send, expired } = useSession();
  return useInfiniteQuery({
    queryKey: ['private', session.user.id, trash ? 'trash' : 'bookmarks', filters],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (filters.q) params.set('q', filters.q);
      if (filters.groupId) params.set('groupId', filters.groupId);
      if (filters.tagIds?.length) params.set('tagIds', filters.tagIds.join(','));
      if (filters.pinned !== undefined) params.set('pinned', String(filters.pinned));
      params.set('sort', filters.sort ?? 'manual');
      params.set('limit', String(filters.limit ?? 50));
      if (pageParam) params.set('cursor', pageParam);
      return send<BookmarkPage>(`${trash ? '/api/trash' : '/api/bookmarks'}?${params}`, { signal });
    },
    getNextPageParam: page => page.nextCursor,
    enabled: enabled && !expired,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 409, 422].includes(error.status)) && count < 1,
  });
}
