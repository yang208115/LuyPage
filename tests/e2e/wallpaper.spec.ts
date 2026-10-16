import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { DEFAULT_HOMEPAGE_PREFERENCES } from '../../packages/contracts/src/types';

async function settings(page: Page, isMobile: boolean) {
  await page.getByRole('button', { name: isMobile ? '打开主页设置' : '主页设置', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '让主页更像你' });
  await expect(modal.getByLabel('导入背景图片')).toBeEnabled();
  return modal;
}
async function picture(page: Page, name = '风景.png', width = 160, height = 90, solid = false) {
  const data = await page.evaluate(({ width, height, solid }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#365d84'); gradient.addColorStop(1, '#d7b284');
    ctx.fillStyle = solid ? '#365d84' : gradient; ctx.fillRect(0, 0, width, height);
    ctx.clearRect(0, 0, 2, 2);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }, { width, height, solid });
  return { name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}
async function importPicture(page: Page, modal: Locator, name = '风景.png') {
  await modal.getByLabel('导入背景图片').setInputFiles(await picture(page, name));
  await expect(modal.getByRole('button', { name: `使用背景：${name}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-custom/);
}
async function save(modal: Locator) {
  await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal).not.toBeVisible();
}
async function snapshot(page: Page) {
  return page.evaluate(() => new Promise<{ items: { id: string; name: string; width: number; height: number; bytes: number; thumbnailType: string; thumbnailSize: number }[]; images: { id: string; type: string; size: number }[]; states: { ownerId: string; selectedId: string | null; revision: number }[] }>((resolve, reject) => {
    const open = indexedDB.open('luypage-wallpapers');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['metadata', 'images', 'state']);
      const metadata = tx.objectStore('metadata').getAll(); const images = tx.objectStore('images').getAll(); const states = tx.objectStore('state').getAll();
      tx.oncomplete = () => { db.close(); resolve({ items: metadata.result.map(item => ({ id: item.id, name: item.name, width: item.width, height: item.height, bytes: item.bytes, thumbnailType: item.thumbnail.type, thumbnailSize: item.thumbnail.size })), images: images.result.map(item => ({ id: item.id, type: item.blob.type, size: item.blob.size })), states: states.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}
async function injectWriteFailure(page: Page, failure: 'quota' | 'abort' | null) {
  await page.evaluate(failure => {
    const target = window as typeof window & { wallpaperFailure?: string | null; wallpaperPatched?: boolean };
    target.wallpaperFailure = failure;
    if (target.wallpaperPatched) return;
    target.wallpaperPatched = true;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'state' && target.wallpaperFailure === 'quota') throw new DOMException('Test quota', 'QuotaExceededError');
      const request = original.apply(this, args);
      if (this.name === 'state' && target.wallpaperFailure === 'abort') this.transaction.abort();
      return request;
    };
  }, failure);
}

test.beforeEach(async ({ request }) => {
  const current = await (await request.get('/api/homepage')).json();
  const saved = await request.put('/api/homepage/preferences', { headers: { Origin: 'http://127.0.0.1:5183' }, data: { operationId: crypto.randomUUID(), baseRevision: current.revision, preferences: DEFAULT_HOMEPAGE_PREFERENCES } });
  expect(saved.ok()).toBe(true);
});

test('多图导入逐项校验，取消不持久化，恢复内置壁纸', async ({ page, isMobile }) => {
  await page.goto('/');
  const modal = await settings(page, isMobile);
  await modal.getByLabel('导入背景图片').setInputFiles([
    await picture(page, '第一张.png'), { name: '文字.txt', mimeType: 'text/plain', buffer: Buffer.from('no image') },
    { name: '损坏.png', mimeType: 'image/png', buffer: Buffer.from('broken') }, await picture(page, '第二张.png'),
  ]);
  await expect(modal.getByRole('button', { name: '使用背景：第二张.png' })).toHaveAttribute('aria-pressed', 'true');
  await expect(modal.getByRole('alert')).toContainText('文字.txt');
  await expect(modal.getByRole('alert')).toContainText('损坏.png');
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-custom/);
  expect((await snapshot(page)).items).toEqual([]);
  await expect(modal.getByRole('button', { name: '删除背景：第一张.png' })).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-sunset-fields/);
  expect((await snapshot(page)).items).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('压缩主图与缩略图、仅本地保存、刷新恢复且其他浏览器不共享', async ({ page, isMobile, browser }, testInfo) => {
  await page.goto('/');
  let modal = await settings(page, isMobile);
  const writes: unknown[] = [];
  page.on('request', request => { if (request.url().endsWith('/api/homepage/preferences') && request.method() === 'PUT') writes.push(request.postDataJSON()); });
  await modal.getByLabel('导入背景图片').setInputFiles([await picture(page, '宽幅.png', 4000, 2000), await picture(page, '透明.png')]);
  await expect(modal.getByRole('button', { name: '使用背景：透明.png' })).toHaveAttribute('aria-pressed', 'true');
  await modal.getByRole('button', { name: '使用背景：宽幅.png' }).click();
  await save(modal);
  expect(writes).toHaveLength(0);
  const saved = await snapshot(page);
  expect(saved.items).toHaveLength(2);
  expect(saved.items.find(item => item.name === '宽幅.png')).toMatchObject({ width: 3840, height: 1920, thumbnailType: 'image/webp' });
  expect(saved.images.every(item => item.type === 'image/webp')).toBe(true);
  expect(saved.states[0]?.revision).toBe(1);
  await page.reload();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-custom/);
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage(); await otherPage.goto('http://127.0.0.1:5183/');
    await expect(otherPage.locator('.homepage')).toHaveClass(/wallpaper-sunset-fields/);
  } finally { await other.close(); }
  modal = await settings(page, isMobile);
  await modal.getByRole('button', { name: '使用背景：透明.png' }).focus();
  await page.keyboard.press('Enter');
  await expect(modal.getByRole('button', { name: '使用背景：透明.png' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('wallpaper-gallery.png'), fullPage: true });
  await modal.getByRole('button', { name: '湖泊群山' }).click();
  await save(modal);
  expect((await snapshot(page)).items).toHaveLength(2);
  expect((await snapshot(page)).states[0]?.selectedId).toBeNull();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-blue-lake/);
});

test('账号保存失败不写图库，部分成功后只重试本地事务', async ({ page, request, isMobile }) => {
  await page.goto('/');
  const modal = await settings(page, isMobile);
  await importPicture(page, modal);
  await modal.getByLabel('默认搜索方式').selectOption('google');
  const payloads: { operationId: string; preferences: unknown; baseRevision: number }[] = [];
  page.on('request', req => { if (req.url().endsWith('/api/homepage/preferences') && req.method() === 'PUT') payloads.push(req.postDataJSON()); });
  await page.route('**/api/homepage/preferences', route => route.abort('internetdisconnected'));
  await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal.getByRole('alert')).toBeVisible();
  expect((await snapshot(page)).items).toHaveLength(0);
  await page.unroute('**/api/homepage/preferences');
  await injectWriteFailure(page, 'quota');
  await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal.getByRole('status')).toContainText('账号设置已保存，本地背景未保存');
  await expect(modal.getByRole('alert')).toContainText('空间不足');
  expect((await (await request.get('/api/homepage')).json()).preferences.searchProvider).toBe('google');
  const failed = await snapshot(page);
  expect(failed.items).toHaveLength(0); expect(failed.images).toHaveLength(0); expect(failed.states).toHaveLength(0);
  expect(payloads).toHaveLength(2);
  expect(payloads[0]?.operationId).toBe(payloads[1]?.operationId);
  expect(Object.keys(payloads[1]!).sort()).toEqual(['baseRevision', 'operationId', 'preferences']);
  await injectWriteFailure(page, null);
  await save(modal);
  expect(payloads).toHaveLength(2);
  expect((await snapshot(page)).items).toHaveLength(1);
});

test('删除与选中状态原子提交，事务中止保留旧图并支持取消', async ({ page, isMobile }) => {
  await page.goto('/');
  let modal = await settings(page, isMobile);
  await importPicture(page, modal, '保留.png'); await save(modal);
  const before = await snapshot(page);
  modal = await settings(page, isMobile);
  await modal.getByRole('button', { name: '删除背景：保留.png' }).click();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-sunset-fields/);
  await injectWriteFailure(page, 'abort');
  await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal.getByRole('alert')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  page.once('dialog', dialog => dialog.accept());
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-custom/);
  modal = await settings(page, isMobile);
  await modal.getByRole('button', { name: '删除背景：保留.png' }).click();
  await injectWriteFailure(page, null); await save(modal);
  const after = await snapshot(page);
  expect(after.items).toHaveLength(0); expect(after.images).toHaveLength(0); expect(after.states[0]?.selectedId).toBeNull();
  await page.reload(); await expect(page.locator('.homepage')).toHaveClass(/wallpaper-sunset-fields/);
});

test('多标签页冲突保留草稿，重新载入图库保留账号设置草稿', async ({ page, context, isMobile }) => {
  await page.goto('/');
  const first = await settings(page, isMobile); await importPicture(page, first, '第一页面.png');
  const secondPage = await context.newPage(); await secondPage.goto('/');
  const second = await settings(secondPage, isMobile); await importPicture(secondPage, second, '第二页面.png');
  await save(first);
  await second.getByRole('button', { name: '保存主页设置' }).click();
  await expect(second.getByRole('alert')).toContainText('其他标签页更新');
  await expect(second.getByRole('button', { name: '使用背景：第二页面.png' })).toBeVisible();
  expect((await snapshot(secondPage)).items.map(item => item.name)).toEqual(['第一页面.png']);
  await second.getByLabel('默认搜索方式').selectOption('google');
  secondPage.once('dialog', dialog => dialog.accept());
  await second.getByRole('button', { name: '重新载入本地图库' }).click();
  await expect(second.getByRole('button', { name: '使用背景：第一页面.png' })).toHaveAttribute('aria-pressed', 'true');
  await expect(second.getByLabel('默认搜索方式')).toHaveValue('google');
  await second.getByRole('button', { name: '湖泊群山' }).click(); await save(second);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-blue-lake/);
  await secondPage.close();
});

test('数据库不可用仍可保存账号偏好，恢复后可载入图库', async ({ page, isMobile, request }) => {
  await page.addInitScript(() => {
    const target = window as typeof window & { restoreDatabase?: () => void };
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = () => { throw new DOMException('Test denied', 'SecurityError'); };
    target.restoreDatabase = () => { IDBFactory.prototype.open = open; };
  });
  await page.goto('/');
  await page.getByRole('button', { name: isMobile ? '打开主页设置' : '主页设置', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '让主页更像你' });
  await expect(modal.getByRole('alert')).toContainText('存储权限');
  await modal.getByLabel('默认搜索方式').selectOption('google'); await save(modal);
  expect((await (await request.get('/api/homepage')).json()).preferences.searchProvider).toBe('google');
  await page.evaluate(() => (window as typeof window & { restoreDatabase: () => void }).restoreDatabase());
  await settings(page, isMobile);
});

test('当前图片损坏或丢失时回退，清除图库后不影响主页', async ({ page, isMobile }) => {
  await page.goto('/');
  const modal = await settings(page, isMobile); await importPicture(page, modal); await save(modal);
  const corrupt = async (remove: boolean) => page.evaluate(remove => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('luypage-wallpapers');
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction('images', 'readwrite'); const store = tx.objectStore('images'); const images = store.getAll();
      images.onsuccess = () => { for (const item of images.result) { if (remove) store.delete([item.ownerId, item.id]); else store.put({ ...item, blob: new Blob(['broken'], { type: 'image/webp' }) }); } };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), remove);
  await corrupt(false); await page.reload();
  await expect(page.locator('.home-notices').getByRole('alert')).toContainText('无法读取');
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-sunset-fields/);
  await corrupt(true); await page.reload();
  await expect(page.locator('.home-notices').getByRole('alert')).toContainText('不存在');
  await page.evaluate(() => new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('luypage-wallpapers'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }));
  await page.reload();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-sunset-fields/);
  await expect(page.locator('.home-notices').getByRole('alert')).toHaveCount(0);
});

test('账号切换隔离本地图库并释放 Blob URL，切回原账号恢复', async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    const urls = new Set<string>();
    (window as typeof window & { wallpaperUrls: Set<string> }).wallpaperUrls = urls;
    const create = URL.createObjectURL; const revoke = URL.revokeObjectURL;
    URL.createObjectURL = blob => { const url = create(blob); urls.add(url); return url; };
    URL.revokeObjectURL = url => { urls.delete(url); revoke(url); };
  });
  await page.goto('/');
  const modal = await settings(page, isMobile); await importPicture(page, modal); await save(modal);
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-custom/);
  await page.route('**/api/session', async route => {
    const response = await route.fetch(); const session = await response.json();
    await route.fulfill({ json: { ...session, user: { id: 'another-wallpaper-owner', displayName: '另一账号' } } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('已切换登录身份', { exact: false })).toBeVisible();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-sunset-fields/);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { wallpaperUrls: Set<string> }).wallpaperUrls.size)).toBe(0);
  const other = await settings(page, isMobile);
  await expect(other.getByText('还没有本地图片', { exact: false })).toBeVisible();
  await other.getByRole('button', { name: '取消', exact: true }).click();
  await page.unroute('**/api/session');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-custom/);
});

test('生产构建应用实际 CSP 后仍可显示 Blob 背景及缩略图', async ({ page, isMobile }) => {
  const headers = await readFile('apps/web/public/_headers', 'utf8');
  const csp = headers.split('\n').find(line => line.includes('Content-Security-Policy:'))!.split('Content-Security-Policy:')[1]!.trim();
  await page.route('http://127.0.0.1:5183/', async route => route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': csp }, body: await readFile('apps/web/dist/index.html') }));
  await page.route('**/assets/*', async route => {
    const name = basename(new URL(route.request().url()).pathname);
    await route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'application/javascript', body: await readFile(`apps/web/dist/assets/${name}`) });
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as typeof window & { cspViolations: string[] }).cspViolations = violations;
    document.addEventListener('securitypolicyviolation', event => violations.push(`${event.violatedDirective}:${event.blockedURI}`));
  });
  await page.goto('/');
  const modal = await settings(page, isMobile);
  // Existing Zod initialization probes eval and falls back under CSP. Keep that
  // startup diagnostic separate; wallpaper operations must introduce no violations.
  const startupViolations = await page.evaluate(() => (window as typeof window & { cspViolations: string[] }).cspViolations.splice(0));
  expect(startupViolations.filter(violation => violation !== 'script-src:eval')).toEqual([]);
  await importPicture(page, modal);
  await expect.poll(() => modal.locator('.local-wallpaper-card img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await save(modal);
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-custom/);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.homepage')!, '::before').backgroundImage)).toContain('blob:');
  expect(await page.evaluate(() => (window as typeof window & { cspViolations: string[] }).cspViolations)).toEqual([]);
});

test('GIF 取首帧并保留 PNG 透明度，超限图片逐项拒绝', async ({ page, isMobile }) => {
  await page.goto('/');
  const modal = await settings(page, isMobile);
  // Two 1px frames: red, then blue, with a looping GIF extension.
  const animated = Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');
  await modal.getByLabel('导入背景图片').setInputFiles([
    { name: '动态.gif', mimeType: 'image/gif', buffer: animated }, await picture(page, '透明像素.png'),
    { name: '超大.png', mimeType: 'image/png', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) },
  ]);
  await expect(modal.getByRole('button', { name: '使用背景：透明像素.png' })).toHaveAttribute('aria-pressed', 'true');
  await expect(modal.getByRole('alert')).toContainText('不能超过 20 MiB');
  await save(modal);
  const pixels = await page.evaluate(() => new Promise<{ name: string; color: number[]; animated: boolean; thumbWidth: number }[]>((resolve, reject) => {
    const open = indexedDB.open('luypage-wallpapers');
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction(['images', 'metadata']);
      const images = tx.objectStore('images').getAll(); const metadata = tx.objectStore('metadata').getAll();
      tx.oncomplete = () => {
        db.close();
        void Promise.all(images.result.map(async item => {
          const meta = metadata.result.find(meta => meta.id === item.id);
          const bitmap = await createImageBitmap(item.blob); const thumb = await createImageBitmap(meta.thumbnail);
          const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
          const result = { name: meta.name, color: Array.from(ctx.getImageData(0, 0, 1, 1).data), animated: new TextDecoder().decode(await item.blob.arrayBuffer()).includes('ANIM'), thumbWidth: thumb.width };
          bitmap.close(); thumb.close(); return result;
        })).then(resolve, reject);
      };
    };
  }));
  expect(pixels.find(item => item.name === '透明像素.png')?.color[3]).toBe(0);
  const gif = pixels.find(item => item.name === '动态.gif')!;
  expect(gif.animated).toBe(false); expect(gif.color[0]).toBeGreaterThan(240); expect(gif.color[2]).toBeLessThan(20);
});

test('超过 4000 万像素的图片不进入草稿也不写图库', async ({ page, isMobile }) => {
  await page.goto('/');
  const modal = await settings(page, isMobile);
  await modal.getByLabel('导入背景图片').setInputFiles(await picture(page, '像素超限.png', 8000, 5001, true));
  await expect(modal.getByRole('alert')).toContainText('不能超过 4000 万像素');
  await expect(modal.getByRole('button', { name: '保存主页设置' })).toBeDisabled();
  expect((await snapshot(page)).items).toHaveLength(0);
});
