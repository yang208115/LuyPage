import { assertGalleryCapacity, WallpaperError, type WallpaperDraft, type WallpaperGallery, type WallpaperImage, type WallpaperItem, type WallpaperState } from './wallpaper-model';

const DATABASE = 'luypage-wallpapers';
const STORES = ['images', 'metadata', 'state'] as const;
const emptyState = (ownerId: string): WallpaperState => ({ ownerId, selectedId: null, revision: 0 });

function storageError(error: unknown): Error {
  if (error instanceof WallpaperError) return error;
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return new WallpaperError('浏览器存储空间不足，本地背景未保存。请释放空间后重试。');
  return new WallpaperError('无法读写本地图库，请检查浏览器的网站存储权限后重试。');
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let finished = false;
    const fail = (error: unknown) => { if (finished) return; finished = true; clearTimeout(timer); reject(storageError(error)); };
    const timer = window.setTimeout(() => fail(new WallpaperError('本地图库打开超时，请关闭其他旧页面后重试。')), 5000);
    try {
      request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('images', { keyPath: ['ownerId', 'id'] });
        db.createObjectStore('metadata', { keyPath: ['ownerId', 'id'] }).createIndex('ownerId', 'ownerId');
        db.createObjectStore('state', { keyPath: 'ownerId' });
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new WallpaperError('本地图库升级被其他页面阻塞，请关闭其他 LuyPage 标签页后重试。'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        if (finished) { db.close(); return; }
        finished = true; clearTimeout(timer); resolve(db);
      };
    } catch (error) { fail(error); }
  });
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      let failure: Error | null = null;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure ?? storageError(tx.error));
      tx.onerror = event => { failure ??= storageError((event.target as IDBRequest).error ?? tx.error); };
      const fail = (error: Error) => { failure = error; tx.abort(); };
      try { work(tx, next => { value = next; }, fail); }
      catch (error) { fail(storageError(error)); }
    });
  } catch (error) { throw storageError(error); }
  finally { db.close(); }
}

export function readWallpaperGallery(ownerId: string): Promise<WallpaperGallery> {
  return transaction(['metadata', 'state'], 'readonly', (tx, result) => {
    const state = tx.objectStore('state').get(ownerId);
    const items = tx.objectStore('metadata').index('ownerId').getAll(ownerId);
    items.onsuccess = () => result({ ...(state.result ?? emptyState(ownerId)), items: (items.result as WallpaperItem[]).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) });
  });
}
export function readWallpaperImage(ownerId: string, id: string): Promise<Pick<WallpaperImage, 'ownerId' | 'id' | 'blob'>> {
  return transaction(['images'], 'readonly', (tx, result, fail) => {
    const request = tx.objectStore('images').get([ownerId, id]);
    request.onsuccess = () => request.result ? result(request.result) : fail(new WallpaperError('这张本地图片已不存在，请重新选择或导入图片。', 'IMAGE'));
  });
}
export function readActiveWallpaper(ownerId: string): Promise<Pick<WallpaperImage, 'ownerId' | 'id' | 'blob'> | null> {
  return transaction(['images', 'state'], 'readonly', (tx, result, fail) => {
    const request = tx.objectStore('state').get(ownerId);
    request.onsuccess = () => {
      const state: WallpaperState = request.result ?? emptyState(ownerId);
      if (!state.selectedId) { result(null); return; }
      const image = tx.objectStore('images').get([ownerId, state.selectedId]);
      image.onsuccess = () => image.result ? result(image.result) : fail(new WallpaperError('已保存的背景图片不存在，已显示内置壁纸。请重新选择图片。', 'IMAGE'));
    };
  });
}
export function saveWallpaperGallery(draft: WallpaperDraft): Promise<WallpaperGallery> {
  return transaction([...STORES], 'readwrite', (tx, result, fail) => {
    const states = tx.objectStore('state');
    const metadata = tx.objectStore('metadata');
    const images = tx.objectStore('images');
    const current = states.get(draft.ownerId);
    const existing = metadata.index('ownerId').getAll(draft.ownerId);
    existing.onsuccess = () => {
      try {
        const state: WallpaperState = current.result ?? emptyState(draft.ownerId);
        if (state.revision !== draft.revision) throw new WallpaperError('本地图库已在其他标签页更新。当前草稿仍保留，请重新载入图库后编辑。', 'CONFLICT');
        const items = (existing.result as WallpaperItem[]).filter(item => !draft.deletedIds.includes(item.id));
        for (const image of draft.additions) {
          if (image.ownerId !== draft.ownerId || items.some(item => item.id === image.id)) throw new WallpaperError('图片身份不匹配，请重新导入。');
          const { blob: _blob, ...item } = image;
          items.push(item);
        }
        assertGalleryCapacity(items);
        if (draft.selectedId && !items.some(item => item.id === draft.selectedId)) throw new WallpaperError('所选图片已不存在，请重新选择。', 'IMAGE');
        for (const id of draft.deletedIds) { images.delete([draft.ownerId, id]); metadata.delete([draft.ownerId, id]); }
        for (const image of draft.additions) {
          const { blob: _blob, ...item } = image;
          images.put({ ownerId: image.ownerId, id: image.id, blob: image.blob }); metadata.put(item);
        }
        const next: WallpaperState = { ownerId: draft.ownerId, selectedId: draft.selectedId, revision: state.revision + 1 };
        states.put(next); result({ ...next, items });
      } catch (error) { fail(storageError(error)); }
    };
  });
}
