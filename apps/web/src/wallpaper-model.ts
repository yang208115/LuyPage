export const MAX_WALLPAPER_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_WALLPAPER_PIXELS = 40_000_000;
export const MAX_WALLPAPER_LIBRARY_BYTES = 100 * 1024 * 1024;
export const WALLPAPER_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export interface WallpaperItem {
  ownerId: string; id: string; name: string; thumbnail: Blob;
  width: number; height: number; bytes: number; createdAt: number;
}
export interface WallpaperImage extends WallpaperItem { blob: Blob }
export interface WallpaperState { ownerId: string; selectedId: string | null; revision: number }
export interface WallpaperGallery extends WallpaperState { items: WallpaperItem[] }
export interface WallpaperDraft extends WallpaperGallery {
  initialSelectedId: string | null;
  additions: WallpaperImage[];
  deletedIds: string[];
}
export class WallpaperError extends Error {
  constructor(message: string, readonly code: 'STORAGE' | 'CONFLICT' | 'IMAGE' | 'LIMIT' = 'STORAGE') {
    super(message); this.name = 'WallpaperError';
  }
}
export function wallpaperDraft(gallery: WallpaperGallery): WallpaperDraft {
  return { ...gallery, initialSelectedId: gallery.selectedId, additions: [], deletedIds: [] };
}
export function wallpaperDirty(draft: WallpaperDraft | null): boolean {
  return !!draft && (draft.selectedId !== draft.initialSelectedId || !!draft.additions.length || !!draft.deletedIds.length);
}
export function galleryBytes(items: WallpaperItem[]): number { return items.reduce((total, item) => total + item.bytes, 0); }
export function assertGalleryCapacity(items: WallpaperItem[]) {
  if (galleryBytes(items) > MAX_WALLPAPER_LIBRARY_BYTES) throw new WallpaperError('本地图库最多保存 100 MiB，请先移除部分图片后再添加。', 'LIMIT');
}
export function addWallpaper(draft: WallpaperDraft, image: WallpaperImage): WallpaperDraft {
  const items = [...draft.items, image];
  assertGalleryCapacity(items);
  return { ...draft, items, additions: [...draft.additions, image], selectedId: image.id };
}
export function removeWallpaper(draft: WallpaperDraft, id: string): WallpaperDraft {
  const isNew = draft.additions.some(item => item.id === id);
  return { ...draft, items: draft.items.filter(item => item.id !== id), additions: draft.additions.filter(item => item.id !== id),
    deletedIds: isNew || draft.deletedIds.includes(id) ? draft.deletedIds : [...draft.deletedIds, id],
    selectedId: draft.selectedId === id ? null : draft.selectedId };
}
export function scaledDimensions(width: number, height: number, maxEdge: number) {
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
