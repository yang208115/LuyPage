import { MAX_WALLPAPER_PIXELS, MAX_WALLPAPER_SOURCE_BYTES, scaledDimensions, WALLPAPER_MIME_TYPES, WallpaperError, type WallpaperImage } from './wallpaper-model';

function webp(bitmap: ImageBitmap, maxEdge: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const size = scaledDimensions(bitmap.width, bitmap.height, maxEdge);
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new WallpaperError('浏览器无法处理图片，请使用支持 Canvas 的浏览器。', 'IMAGE');
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    canvas.width = 0; canvas.height = 0;
    if (blob?.type === 'image/webp') resolve(blob);
    else reject(new WallpaperError('浏览器无法生成 WebP 图片，请更换浏览器后重试。', 'IMAGE'));
  }, 'image/webp', 0.85));
}
export async function prepareWallpaper(file: File, ownerId: string): Promise<WallpaperImage> {
  if (!WALLPAPER_MIME_TYPES.some(type => type === file.type)) throw new WallpaperError('仅支持 JPEG、PNG、WebP 和 GIF 图片。', 'IMAGE');
  if (!file.size || file.size > MAX_WALLPAPER_SOURCE_BYTES) throw new WallpaperError('图片不能为空，单张原图不能超过 20 MiB。', 'LIMIT');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new WallpaperError('图片无法解码，请检查文件是否损坏。', 'IMAGE'); }
  try {
    if (bitmap.width * bitmap.height > MAX_WALLPAPER_PIXELS) throw new WallpaperError('图片不能超过 4000 万像素，请缩小后再导入。', 'LIMIT');
    // ImageBitmap snapshots the first frame; both sizes come from the same static image.
    const blob = await webp(bitmap, 3840);
    const thumbnail = await webp(bitmap, 320);
    return { ownerId, id: crypto.randomUUID(), name: file.name, blob, thumbnail,
      ...scaledDimensions(bitmap.width, bitmap.height, 3840), bytes: blob.size + thumbnail.size, createdAt: Date.now() };
  } finally { bitmap.close(); }
}
export async function validateWallpaperBlob(blob: Blob): Promise<void> {
  try { const bitmap = await createImageBitmap(blob); bitmap.close(); }
  catch { throw new WallpaperError('本地背景图片无法读取，已显示内置壁纸。请重新导入图片。', 'IMAGE'); }
}
