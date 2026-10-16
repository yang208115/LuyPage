import { useCallback, useEffect, useState } from 'react';
import { readActiveWallpaper, readWallpaperImage } from './wallpaper-storage';
import { validateWallpaperBlob } from './wallpaper-image';

export function useBlobUrl(blob: Blob | null | undefined): string | null {
  const [value, setValue] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) { setValue(null); return; }
    const url = URL.createObjectURL(blob);
    setValue({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return value && value.blob === blob ? value.url : null;
}

export function useWallpaper(ownerId: string, preview?: { id: string | null; blob?: Blob }) {
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  const [value, setValue] = useState<{ key: string; blob: Blob | null; error: Error | null } | null>(null);
  const id = preview?.id;
  const previewBlob = preview?.blob;
  const key = JSON.stringify([ownerId, id, attempt]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const image = id === null ? null : previewBlob ? { blob: previewBlob } : id === undefined ? await readActiveWallpaper(ownerId) : await readWallpaperImage(ownerId, id);
        if (image) await validateWallpaperBlob(image.blob);
        if (live) setValue({ key, blob: image?.blob ?? null, error: null });
      } catch (cause) {
        if (live) setValue({ key, blob: null, error: cause instanceof Error ? cause : new Error('无法加载本地背景。') });
      }
    };
    void load();
    return () => { live = false; };
  }, [ownerId, id, previewBlob, key]);
  useEffect(() => {
    if (id !== undefined) return;
    const refresh = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [id, reload]);
  const current = value?.key === key ? value : null;
  const url = useBlobUrl(current?.blob);
  return { url, error: current?.error, reload };
}
