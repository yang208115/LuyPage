import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { defaultHomepageProfile } from '../../packages/domain/src/homepage-layout';
import type { Homepage, HomepageDevice } from '../../packages/contracts/src';
const headers = { Origin: 'http://127.0.0.1:5183' };
async function home(request: APIRequestContext): Promise<Homepage> { return (await request.get('/api/homepage')).json(); }
async function reset(request: APIRequestContext, device: HomepageDevice) {
  const current = await home(request);
  const profile = defaultHomepageProfile(device, current.folders.filter(item => item.id || item.count).map(item => item.id ? `folder:${item.id}` : 'ungrouped'), current.pinnedIds);
  const result = await request.put('/api/homepage/layout', { headers, data: { operationId: crypto.randomUUID(), baseRevision: current.revision, device, profile } });
  expect(result.ok()).toBe(true); return profile;
}
async function edit(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: '打开主页导航' }).click();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '完成编辑' })).toBeVisible();
}
const saved = (page: Page) => expect(page.locator('.homepage-layout-toolbar').getByRole('status')).toHaveText('已保存');
async function moveClock(page: Page) {
  const handle = page.getByRole('button', { name: '移动时钟', exact: true });
  const before = await page.locator('[data-tile-id="clock"]').getAttribute('style');
  await handle.focus(); await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-tile-id="clock"]')).not.toHaveAttribute('style', before!);
  await page.keyboard.press('Space');
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
}

test('keyboard move, resize, undo, reset and independent device persistence', async ({ page, request, isMobile }, info) => {
  const device = isMobile ? 'mobile' : 'desktop';
  const initial = await reset(request, device); const other = (await home(request)).layout[isMobile ? 'desktop' : 'mobile'];
  await page.goto('/'); await edit(page, isMobile);
  await moveClock(page); await saved(page);
  const moved = (await home(request)).layout[device]!;
  expect(moved.items.find(item => item.id === 'clock')!.y).toBe(initial.items.find(item => item.id === 'clock')!.y + 1);
  const resize = page.getByRole('button', { name: '调整时钟大小', exact: true });
  await resize.focus(); await page.keyboard.press('ArrowDown'); await saved(page);
  expect((await home(request)).layout[device]!.items.find(item => item.id === 'clock')!.h).toBe(4);
  await page.getByRole('button', { name: '撤销上一步' }).click(); await saved(page);
  expect((await home(request)).layout[device]!.items.find(item => item.id === 'clock')!.h).toBe(3);
  await page.getByRole('button', { name: '完成编辑' }).click(); await page.reload();
  expect(await page.locator('[data-tile-id="clock"]').evaluate(element => (element as HTMLElement).style.gridRow)).toContain(String(moved.items.find(item => item.id === 'clock')!.y + 1));
  expect((await home(request)).layout[isMobile ? 'desktop' : 'mobile']).toEqual(other);
  await edit(page, isMobile); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '恢复默认布局' }).click(); await saved(page);
  expect((await home(request)).layout[device]).toEqual(initial);
  await page.screenshot({ path: info.outputPath('homepage-grid-edit.png'), fullPage: true });
  await page.getByRole('button', { name: '完成编辑' }).click();
  await expect(page.getByRole('searchbox', { name: '主页搜索' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('lost save response retries the same operation; conflict keeps draft until explicitly reapplied', async ({ page, request, isMobile }) => {
  const device = isMobile ? 'mobile' : 'desktop'; await reset(request, device);
  await page.goto('/'); await edit(page, isMobile);
  const operations: string[] = []; let drop = true;
  await page.route('**/api/homepage/layout', async route => {
    operations.push(route.request().postDataJSON().operationId);
    if (drop) { await route.fetch(); await route.abort('internetdisconnected'); } else await route.continue();
  });
  await moveClock(page); await expect(page.getByRole('button', { name: '重试保存' })).toBeVisible();
  const committed = (await home(request)).revision;
  drop = false; await page.getByRole('button', { name: '重试保存' }).click(); await saved(page);
  expect(operations[1]).toBe(operations[0]); expect((await home(request)).revision).toBe(committed);
  const current = await home(request);
  await request.put('/api/homepage/preferences', { headers, data: { operationId: crypto.randomUUID(), baseRevision: current.revision, preferences: { ...current.preferences, searchProvider: current.preferences.searchProvider === 'bing' ? 'google' : 'bing' } } });
  await moveClock(page); await expect(page.getByRole('button', { name: '将当前布局应用到最新版本' })).toBeVisible();
  await page.getByRole('button', { name: '将当前布局应用到最新版本' }).click(); await saved(page);
  await expect(page.locator('.homepage-layout-toolbar').getByRole('alert')).toHaveCount(0);
});

test('pointer movement snaps and mobile touch resize works without changing library order', async ({ page, request, isMobile }) => {
  const device = isMobile ? 'mobile' : 'desktop'; const initial = await reset(request, device);
  const library = await (await request.get('/api/layout/index')).json();
  await page.goto('/'); await edit(page, isMobile);
  const handle = page.getByRole('button', { name: '移动时钟', exact: true }); const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + 12, box.y + 90, { steps: 8 }); await page.mouse.up(); await saved(page);
  expect((await home(request)).layout[device]!.items.find(item => item.id === 'clock')!.y).toBeGreaterThan(initial.items.find(item => item.id === 'clock')!.y);
  const resize = page.getByRole('button', { name: '调整时钟大小' });
  const resizeBox = (await resize.boundingBox())!;
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const x = resizeBox.x + resizeBox.width / 2; const y = resizeBox.y + resizeBox.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 72 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(resizeBox.x + 12, resizeBox.y + 12); await page.mouse.down();
    await page.mouse.move(resizeBox.x + 12, resizeBox.y + 84, { steps: 6 }); await page.mouse.up();
  }
  await saved(page);
  expect((await home(request)).layout[device]!.items.find(item => item.id === 'clock')!.h).toBe(4);
  const after = await (await request.get('/api/layout/index')).json(); expect({ ...after, revision: library.revision }).toEqual(library);
});

test('serial autosave keeps later edits and waits before switching device profiles', async ({ page, request, isMobile }) => {
  const device = isMobile ? 'mobile' : 'desktop'; const opposite = isMobile ? 'desktop' : 'mobile';
  await reset(request, device); const other = (await home(request)).layout[opposite];
  await page.goto('/'); await edit(page, isMobile);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/homepage/layout', async route => {
    const response = await route.fetch(); calls++;
    if (calls === 1) await held;
    await route.fulfill({ response });
  });
  const resize = page.getByRole('button', { name: '调整时钟大小' });
  await resize.focus(); await page.keyboard.press('ArrowDown');
  await expect.poll(() => calls).toBe(1);
  await resize.focus(); await page.keyboard.press('ArrowDown');
  await page.setViewportSize(isMobile ? { width: 1280, height: 900 } : { width: 360, height: 800 });
  await expect(page.getByText('正在保存切换前的布局；保存成功后切换到当前屏幕布局。')).toBeVisible();
  release();
  await expect(page.locator('.homepage-layout-toolbar strong')).toHaveText(isMobile ? '电脑布局' : '手机布局');
  await saved(page);
  const latest = await home(request);
  expect(latest.layout[device]!.items.find(item => item.id === 'clock')!.h).toBe(5);
  expect(latest.layout[opposite]).toEqual(other); expect(calls).toBe(2);
});

test('homepage shortcut sorting persists independently from library pinned order', async ({ page, request, isMobile }) => {
  const device = isMobile ? 'mobile' : 'desktop';
  const titles = [`布局收藏A-${Date.now()}`, `布局收藏B-${Date.now()}`]; const ids: string[] = [];
  for (const title of titles) {
    const response = await request.post('/api/bookmarks', { headers, data: { operationId: crypto.randomUUID(), title, url: `https://example.com/${crypto.randomUUID()}`, pinned: true } });
    expect(response.ok()).toBe(true); ids.push((await response.json()).data.id);
  }
  await reset(request, device);
  const library = await (await request.get('/api/layout/index')).json();
  await page.goto('/'); await edit(page, isMobile);
  const first = page.getByRole('button', { name: `移动网站：${titles[0]}`, exact: true });
  const second = page.getByRole('button', { name: `移动网站：${titles[1]}`, exact: true });
  await first.scrollIntoViewIfNeeded(); const a = (await first.boundingBox())!; const b = (await second.boundingBox())!;
  const response = page.waitForResponse(res => res.url().endsWith('/api/homepage/layout') && res.request().method() === 'PUT');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 }); await page.mouse.up();
  expect((await response).ok()).toBe(true); await saved(page);
  const order = (await home(request)).layout[device]!.pinnedOrder;
  expect(order.indexOf(ids[1]!)).toBeLessThan(order.indexOf(ids[0]!));
  await page.getByRole('button', { name: '完成编辑' }).click(); await page.reload();
  const links = page.locator('.home-shortcuts a'); await expect(links.filter({ hasText: titles[1]! })).toBeVisible();
  const visible = await page.locator('.home-shortcuts .home-shortcut-name').allTextContents(); expect(visible.indexOf(titles[1]!)).toBeLessThan(visible.indexOf(titles[0]!));
  const after = await (await request.get('/api/layout/index')).json(); expect({ ...after, revision: library.revision }).toEqual(library);
});

test('a website can occupy an empty cell and keep its gap after autosave and reload', async ({ page, request, isMobile }, info) => {
  const device = isMobile ? 'mobile' : 'desktop';
  const ids: string[] = [];
  for (const name of ['自由摆放', '保持位置']) {
    const response = await request.post('/api/bookmarks', { headers, data: { operationId: crypto.randomUUID(), title: `${name}-${crypto.randomUUID()}`, url: `https://example.com/${crypto.randomUUID()}`, pinned: true } });
    expect(response.ok()).toBe(true); ids.push((await response.json()).data.id);
  }
  const current = await home(request);
  const order = [...ids, ...current.pinnedIds.filter(id => !ids.includes(id))];
  const profile = defaultHomepageProfile(device, current.folders.filter(folder => folder.id || folder.count).map(folder => folder.id ? `folder:${folder.id}` : 'ungrouped'), order);
  profile.pinnedSlots = order.map((_, index) => index < 2 ? index : index + 15);
  profile.items.find(item => item.id === 'favorites')!.h = 8;
  const response = await request.put('/api/homepage/layout', { headers, data: { operationId: crypto.randomUUID(), baseRevision: current.revision, device, profile } });
  expect(response.ok()).toBe(true);
  const library = await (await request.get('/api/layout/index')).json();
  const other = (await home(request)).layout[device === 'desktop' ? 'mobile' : 'desktop'];
  await page.goto('/'); await edit(page, isMobile);
  const grid = page.locator('.home-pin-grid');
  const cell = page.locator(`[data-pin-id="${ids[0]}"]`);
  const handle = cell.getByRole('button', { name: /^移动网站：/ });
  await handle.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const columns = Number(await grid.getAttribute('data-pin-columns'));
  const gridBox = (await grid.boundingBox())!;
  const start = (await handle.boundingBox())!;
  const row = await grid.evaluate(element => parseFloat(getComputedStyle(element).gridAutoRows));
  const savedResponse = page.waitForResponse(res => res.url().endsWith('/api/homepage/layout') && res.request().method() === 'PUT');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + (gridBox.width + 12) / columns, start.y + start.height / 2 + row, { steps: 12 });
  await expect(page.locator('.home-pin-drop-preview')).toBeVisible();
  await page.mouse.up();
  expect((await savedResponse).ok()).toBe(true); await saved(page);
  const slot = columns + 1;
  await expect(cell).toHaveAttribute('data-pin-slot', String(slot));
  await expect(page.locator(`[data-pin-id="${ids[1]}"]`)).toHaveAttribute('data-pin-slot', '1');
  await expect(grid.locator('[data-pin-slot="0"]')).toHaveCount(0);
  await page.getByRole('button', { name: '完成编辑' }).click(); await page.reload();
  await expect(cell).toHaveAttribute('data-pin-slot', String(slot));
  await expect(grid.locator('[data-pin-slot="0"]')).toHaveCount(0);
  const after = await home(request);
  expect(after.layout[device === 'desktop' ? 'mobile' : 'desktop']).toEqual(other);
  const afterLibrary = await (await request.get('/api/layout/index')).json();
  expect({ ...afterLibrary, revision: library.revision }).toEqual(library);
  await page.screenshot({ path: info.outputPath('free-pin-placement.png'), fullPage: true });
});

test('keyboard website placement supports cancel and undo without collapsing empty cells', async ({ page, request, isMobile }) => {
  const device = isMobile ? 'mobile' : 'desktop';
  const response = await request.post('/api/bookmarks', { headers, data: { operationId: crypto.randomUUID(), title: `键盘摆放-${crypto.randomUUID()}`, url: `https://example.com/${crypto.randomUUID()}`, pinned: true } });
  expect(response.ok()).toBe(true);
  const id = (await response.json()).data.id as string;
  await reset(request, device);
  await page.goto('/'); await edit(page, isMobile);
  const grid = page.locator('.home-pin-grid');
  const cell = page.locator(`[data-pin-id="${id}"]`);
  const handle = cell.getByRole('button', { name: /^移动网站：/ });
  // The shared fixture can exceed the first twenty favorites across projects.
  while (await cell.count() === 0) {
    await page.getByRole('button', { name: '更多常用收藏', exact: true }).click();
    await expect(page.getByRole('button', { name: '正在加载…', exact: true })).toHaveCount(0);
  }
  await handle.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const initial = Number(await cell.getAttribute('data-pin-slot'));
  const columns = Number(await grid.getAttribute('data-pin-columns'));
  await handle.focus(); await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.home-pin-drop-preview')).toHaveCSS('grid-row-start', String(Math.floor(initial / columns) + 2));
  await page.keyboard.press('Escape');
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
  await expect(cell).toHaveAttribute('data-pin-slot', String(initial));
  await saved(page);
  await handle.focus(); await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.home-pin-drop-preview')).toHaveCSS('grid-row-start', String(Math.floor(initial / columns) + 2));
  await page.keyboard.press('Space');
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
  await expect(cell).toHaveAttribute('data-pin-slot', String(initial + columns)); await saved(page);
  await page.getByRole('button', { name: '撤销上一步' }).click(); await saved(page);
  await expect(cell).toHaveAttribute('data-pin-slot', String(initial));
});
