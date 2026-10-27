import { ArrowUpRight, Copy, ExternalLink, Pencil, Star, Trash2 } from 'lucide-react';
import type { HomepageShortcut } from '@luypage/contracts';
import type { ContextMenuItem } from './ContextMenu';
import { safeWebsite } from './ui';

export type BookmarkMenuAction = 'edit' | 'pin' | 'trash';
export function bookmarkMenuItems(bookmark: HomepageShortcut & { pinned?: boolean }, action: (action: BookmarkMenuAction) => void | Promise<void>, notify: (message: string) => void, disabled = false): ContextMenuItem[] {
  const href = safeWebsite(bookmark.url);
  return [
    { label: '在新标签页打开', icon: ArrowUpRight, href, newTab: true, disabled: !href },
    { label: '在当前标签页打开', icon: ExternalLink, href, disabled: !href },
    { label: '编辑收藏', icon: Pencil, run: () => action('edit'), disabled, divider: true },
    { label: bookmark.pinned ? '取消常用' : '设为常用', icon: Star, run: () => action('pin'), disabled },
    { label: '复制链接', icon: Copy, run: async () => {
      try { await navigator.clipboard.writeText(bookmark.url); }
      catch { throw new Error('未能复制链接，请检查浏览器剪贴板权限后重试。'); }
      notify('链接已复制');
    } },
    { label: '移入回收站', icon: Trash2, run: () => action('trash'), disabled, danger: true, divider: true },
  ];
}
