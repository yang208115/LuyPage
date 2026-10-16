import { describe, expect, it } from 'vitest';
import { addWallpaper, assertGalleryCapacity, galleryBytes, MAX_WALLPAPER_LIBRARY_BYTES, removeWallpaper, scaledDimensions, wallpaperDirty, wallpaperDraft, type WallpaperImage } from '../../apps/web/src/wallpaper-model';

const image = (id: string, bytes = 100): WallpaperImage => ({ ownerId: 'owner', id, bytes, name: `${id}.png`, width: 32, height: 32, createdAt: 1, blob: new Blob(['main']), thumbnail: new Blob(['thumb']) });
const initial = () => wallpaperDraft({ ownerId: 'owner', revision: 3, selectedId: 'saved', items: [image('saved')] });

describe('local wallpaper drafts', () => {
  it('keeps imports and deletes separate from saved state and selects the newest import', () => {
    const original = initial();
    const first = addWallpaper(original, image('new'));
    const second = addWallpaper(first, image('second'));
    expect(original.items.map(item => item.id)).toEqual(['saved']);
    expect(second.selectedId).toBe('second');
    expect(second.additions.map(item => item.id)).toEqual(['new', 'second']);
    expect(wallpaperDirty(original)).toBe(false);
    expect(wallpaperDirty(second)).toBe(true);
  });
  it('returns to the builtin background when deleting the selected image and only deletes persisted IDs', () => {
    const removed = removeWallpaper(initial(), 'saved');
    expect(removed.selectedId).toBeNull();
    expect(removed.deletedIds).toEqual(['saved']);
    const fresh = wallpaperDraft({ ownerId: 'owner', revision: 0, selectedId: null, items: [] });
    const cancelledImport = removeWallpaper(addWallpaper(fresh, image('new')), 'new');
    expect(cancelledImport.additions).toEqual([]);
    expect(cancelledImport.deletedIds).toEqual([]);
    expect(wallpaperDirty(cancelledImport)).toBe(false);
  });
  it('retains the library when changing the selected background and resets the dirty baseline after save', () => {
    const switched = { ...initial(), selectedId: null };
    expect(wallpaperDirty(switched)).toBe(true);
    expect(switched.items).toHaveLength(1);
    expect(wallpaperDirty(wallpaperDraft(switched))).toBe(false);
    expect(wallpaperDirty(null)).toBe(false);
  });
  it('counts both compressed sizes and rejects capacity overflow without changing the draft', () => {
    const full = wallpaperDraft({ ownerId: 'owner', revision: 0, selectedId: null, items: [image('large', MAX_WALLPAPER_LIBRARY_BYTES)] });
    expect(() => assertGalleryCapacity(full.items)).not.toThrow();
    expect(() => addWallpaper(full, image('extra', 1))).toThrow('100 MiB');
    expect(galleryBytes(full.items)).toBe(MAX_WALLPAPER_LIBRARY_BYTES);
    expect(full.additions).toEqual([]);
  });
  it('scales landscape and portrait images proportionally without upscaling', () => {
    expect(scaledDimensions(7680, 4320, 3840)).toEqual({ width: 3840, height: 2160 });
    expect(scaledDimensions(2000, 4000, 3840)).toEqual({ width: 1920, height: 3840 });
    expect(scaledDimensions(80, 40, 320)).toEqual({ width: 80, height: 40 });
    expect(scaledDimensions(40000, 1, 320)).toEqual({ width: 320, height: 1 });
  });
});
