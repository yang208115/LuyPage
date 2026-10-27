import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_HOMEPAGE_PREFERENCES, type Homepage } from '@luypage/contracts';
import { defaultHomepageProfile } from '@luypage/domain';

const headers = { Origin: 'http://127.0.0.1:5183' };
async function settings(page: Page, mobile: boolean) {
  await page.getByRole('button', { name: mobile ? '打开主页设置' : '主页设置', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '让主页更像你' });
  await expect(modal.getByRole('slider', { name: '网站图标大小', exact: true })).toBeEnabled();
  return modal;
}
test.beforeEach(async ({ request }) => {
  const current: Homepage = await (await request.get('/api/homepage')).json();
  expect((await request.put('/api/homepage/preferences', { headers, data: { operationId: crypto.randomUUID(), baseRevision: current.revision, preferences: DEFAULT_HOMEPAGE_PREFERENCES } })).ok()).toBe(true);
});

test('icon sizes remain square, preview and persist; dragging the icon uses one unchanged cell', async ({ page, request, isMobile }, info) => {
  const create = await request.post('/api/bookmarks', { headers, data: { operationId: crypto.randomUUID(), title: '正方形网站', url: `https://example.com/${crypto.randomUUID()}`, pinned: true } });
  const id = (await create.json()).data.id as string;
  const current: Homepage = await (await request.get('/api/homepage')).json();
  const device = isMobile ? 'mobile' : 'desktop';
  const order = [id, ...current.pinnedIds.filter(item => item !== id)];
  const profile = defaultHomepageProfile(device, current.folders.filter(folder => folder.id || folder.count).map(folder => folder.id ? `folder:${folder.id}` : 'ungrouped'), order);
  profile.pinnedSlots = order.map((_, index) => index ? index + 30 : 0);
  profile.items.find(item => item.id === 'favorites')!.h = 8;
  expect((await request.put('/api/homepage/layout', { headers, data: { operationId: crypto.randomUUID(), baseRevision: current.revision, device, profile } })).ok()).toBe(true);
  await page.goto('/');
  const icon = page.locator(`[data-pin-id="${id}"] .home-site-icon`);
  const cell = page.locator(`[data-pin-id="${id}"]`);
  const modal = await settings(page, isMobile);
  for (const size of [40, 128, 96]) {
    await modal.getByRole('slider', { name: '网站图标大小', exact: true }).fill(String(size));
    await expect(icon).toHaveCSS('width', `${size}px`); await expect(icon).toHaveCSS('height', `${size}px`);
    const bounds = (await icon.boundingBox())!; expect(bounds.width).toBe(bounds.height);
  }
  await modal.getByRole('button', { name: '保存主页设置' }).click(); await expect(modal).not.toBeVisible();
  await page.reload(); await expect(icon).toHaveCSS('width', '96px'); await expect(icon).toHaveCSS('height', '96px');
  const saved: Homepage = await (await request.get('/api/homepage')).json();
  expect(saved.preferences.shortcutIconSize).toBe(96); expect(saved.layout[device]).toEqual(profile);
  const grid = page.locator('.home-pin-grid');
  const row = await grid.evaluate(element => getComputedStyle(element).gridAutoRows);
  if (isMobile) await page.getByRole('button', { name: '打开主页导航' }).click();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await expect(grid).toHaveCSS('grid-auto-rows', row);
  const handle = cell.getByRole('button', { name: '移动网站：正方形网站', exact: true });
  await handle.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const handleBox = (await handle.boundingBox())!; const cellBox = (await cell.boundingBox())!;
  expect(handleBox).toEqual(cellBox);
  const start = (await icon.boundingBox())!;
  const gridBox = (await grid.boundingBox())!;
  const columns = Number(await grid.getAttribute('data-pin-columns'));
  const response = page.waitForResponse(res => res.url().endsWith('/api/homepage/layout') && res.request().method() === 'PUT');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + (gridBox.width + 12) / columns, start.y + start.height / 2 + parseFloat(row), { steps: 12 });
  await expect(page.locator('.home-pin-drop-preview')).toBeVisible(); await page.mouse.up();
  expect((await response).ok()).toBe(true);
  await expect(page.locator('.homepage-layout-toolbar').getByRole('status')).toHaveText('已保存');
  await expect(cell).toHaveAttribute('data-pin-slot', String(columns + 1));
  await expect(grid.locator('[data-pin-slot="0"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('single-cell-square-icons.png'), fullPage: true });
});

test('size preview cancels cleanly and failed saves retain the chosen size for retry', async ({ page, request, isMobile }) => {
  await request.post('/api/bookmarks', { headers, data: { operationId: crypto.randomUUID(), title: '图标保存', url: `https://example.com/${crypto.randomUUID()}`, pinned: true } });
  await page.goto('/');
  const icon = page.locator('.home-pin-grid .home-site-icon').first();
  let modal = await settings(page, isMobile);
  await modal.getByRole('slider', { name: '网站图标大小' }).fill('128'); await expect(icon).toHaveCSS('width', '128px');
  page.once('dialog', dialog => dialog.accept()); await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(icon).toHaveCSS('width', '62px'); await expect(icon).toHaveCSS('height', '62px');
  modal = await settings(page, isMobile);
  await modal.getByRole('slider', { name: '网站图标大小' }).fill('80');
  await page.route('**/api/homepage/preferences', route => route.abort('internetdisconnected'));
  await modal.getByRole('button', { name: '保存主页设置' }).click(); await expect(modal.getByRole('alert')).toBeVisible();
  await expect(icon).toHaveCSS('width', '80px'); await expect(icon).toHaveCSS('height', '80px');
  await page.unroute('**/api/homepage/preferences'); await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal).not.toBeVisible(); await page.reload(); await expect(icon).toHaveCSS('width', '80px');
});

test('each website resizes independently with pointer preview, cancel, undo and persistent square sizes', async ({ page, request, isMobile }, info) => {
  const ids: string[] = [];
  for (const title of ['独立大小甲', '独立大小乙', '默认大小丙']) {
    const created = await request.post('/api/bookmarks', { headers, data: { operationId: crypto.randomUUID(), title, url: `https://example.com/${crypto.randomUUID()}`, pinned: true } });
    ids.push((await created.json()).data.id);
  }
  const device = isMobile ? 'mobile' : 'desktop';
  const current: Homepage = await (await request.get('/api/homepage')).json();
  const order = [...ids, ...current.pinnedIds.filter(id => !ids.includes(id))];
  const profile = defaultHomepageProfile(device, current.folders.filter(folder => folder.id || folder.count).map(folder => folder.id ? `folder:${folder.id}` : 'ungrouped'), order);
  profile.pinnedSlots = order.map((_, index) => index < 3 ? index : index + 30);
  profile.items.find(item => item.id === 'favorites')!.h = 8;
  expect((await request.put('/api/homepage/layout', { headers, data: { operationId: crypto.randomUUID(), baseRevision: current.revision, device, profile } })).ok()).toBe(true);
  const other = current.layout[device === 'desktop' ? 'mobile' : 'desktop'];
  await page.goto('/');
  if (isMobile) await page.getByRole('button', { name: '打开主页导航' }).click();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  const cells = ids.map(id => page.locator(`[data-pin-id="${id}"]`));
  const first = cells[0]!; const second = cells[1]!;
  const icon = first.locator('.home-site-icon');
  const handle = first.getByRole('button', { name: '调整网站大小：独立大小甲', exact: true });
  const saved = () => expect(page.locator('.homepage-layout-toolbar').getByRole('status')).toHaveText('已保存');
  async function resize(delta: number, cancel = false) {
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2 + delta, { steps: 8 });
    await expect(icon).toHaveCSS('width', `${96 + (cancel ? delta : 0)}px`);
    await expect(icon).toHaveCSS('height', `${96 + (cancel ? delta : 0)}px`);
    await expect(page.locator('.home-pin-drop-preview')).toHaveCount(0);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await saved();
  }
  await resize(34);
  await expect(second.locator('.home-site-icon')).toHaveCSS('width', '62px');
  await expect(first).toHaveAttribute('data-pin-slot', '0');
  await page.getByRole('button', { name: '撤销上一步' }).click(); await saved();
  await expect(icon).toHaveCSS('width', '62px');
  await resize(34);
  await resize(20, true); await expect(icon).toHaveCSS('width', '96px');
  const secondHandle = second.getByRole('button', { name: '调整网站大小：独立大小乙', exact: true });
  await secondHandle.press('Shift+ArrowRight'); await secondHandle.press('Shift+ArrowDown'); await saved();
  await expect(second.locator('.home-site-icon')).toHaveCSS('width', '82px');
  await expect(second.locator('.home-site-icon')).toHaveCSS('height', '82px');
  await expect(icon).toHaveCSS('width', '96px');
  const firstMove = first.getByRole('button', { name: '移动网站：独立大小甲', exact: true });
  const columns = Number(await page.locator('.home-pin-grid').getAttribute('data-pin-columns'));
  await firstMove.press('Space'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space'); await saved();
  await expect(first).toHaveAttribute('data-pin-slot', String(columns));
  await page.getByRole('button', { name: '完成编辑' }).click(); await page.reload();
  await expect(icon).toHaveCSS('width', '96px');
  await expect(second.locator('.home-site-icon')).toHaveCSS('width', '82px');
  const after: Homepage = await (await request.get('/api/homepage')).json();
  expect(after.layout[device]?.pinnedSizes).toEqual({ [ids[0]!]: 96, [ids[1]!]: 82 });
  expect(after.layout[device === 'desktop' ? 'mobile' : 'desktop']).toEqual(other);
  const modal = await settings(page, isMobile);
  await modal.getByRole('slider', { name: '网站图标大小', exact: true }).fill('80');
  await expect(icon).toHaveCSS('width', '96px');
  await expect(second.locator('.home-site-icon')).toHaveCSS('width', '82px');
  await expect(cells[2]!.locator('.home-site-icon')).toHaveCSS('width', '80px');
  await modal.getByRole('button', { name: '保存主页设置' }).click(); await expect(modal).not.toBeVisible();
  for (const cell of cells) { const box = (await cell.locator('.home-site-icon').boundingBox())!; expect(box.width).toBe(box.height); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('independent-square-sizes.png'), fullPage: true });
});
