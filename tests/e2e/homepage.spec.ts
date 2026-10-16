import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEFAULT_HOMEPAGE_PREFERENCES, type Homepage, type HomepagePreferences } from '../../packages/contracts/src/types';

const headers = { Origin: 'http://127.0.0.1:5183' };
async function home(request: APIRequestContext): Promise<Homepage> { return (await request.get('/api/homepage')).json(); }
async function preferences(request: APIRequestContext, patch: Partial<HomepagePreferences> = {}) {
  const current = await home(request);
  const response = await request.put('/api/homepage/preferences', { headers, data: { operationId: crypto.randomUUID(), baseRevision: current.revision, preferences: { ...DEFAULT_HOMEPAGE_PREFERENCES, ...patch } } });
  expect(response.ok()).toBe(true);
}
async function openSettings(page: Page, isMobile: boolean) {
  await page.getByRole('button', { name: isMobile ? '打开主页设置' : '主页设置', exact: true }).click();
  return page.getByRole('dialog', { name: '让主页更像你' });
}
async function add(request: APIRequestContext, title: string, groupId: string | null = null, pinned = false) {
  const response = await request.post('/api/bookmarks', { headers, data: { operationId: crypto.randomUUID(), url: `https://example.com/${crypto.randomUUID()}`, title, groupId, pinned, icon: { type: 'builtin', key: 'book' } } });
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}

test.beforeEach(async ({ request }) => preferences(request));

test('主页入口、轻量读取、站内搜索与管理页返回', async ({ page, request }) => {
  const title = `主页站内搜索 ${crypto.randomUUID()}`;
  await add(request, title, null, true);
  const paths: string[] = [];
  page.on('request', req => { if (req.url().includes('/api/')) paths.push(new URL(req.url()).pathname + new URL(req.url()).search); });
  await page.goto('/');
  await expect(page.getByRole('searchbox', { name: '主页搜索' })).toBeVisible();
  await expect(page.locator('.home-shortcuts').getByRole('link', { name: title, exact: true })).toBeVisible();
  expect(paths.some(path => path.startsWith('/api/layout'))).toBe(false);
  expect(paths.filter(path => path.startsWith('/api/bookmarks')).every(path => path.includes('pinned=true'))).toBe(true);
  await page.getByLabel('搜索方式', { exact: true }).selectOption('bookmarks');
  await page.getByRole('searchbox', { name: '主页搜索' }).fill(title);
  await page.getByRole('searchbox', { name: '主页搜索' }).press('Enter');
  await expect(page).toHaveURL(/view=library.*q=/);
  await expect(page.getByRole('link').filter({ hasText: title })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('searchbox', { name: '主页搜索' })).toBeVisible();
  await page.goto(`/?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole('searchbox', { name: '搜索收藏', exact: true })).toHaveValue(title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('文件夹按需分页、添加收藏并在管理页查看', async ({ page, request }) => {
  const name = `文件夹 ${crypto.randomUUID()}`;
  const response = await request.post('/api/groups', { headers, data: { operationId: crypto.randomUUID(), name } });
  const group = (await response.json()).data;
  for (let i = 0; i < 41; i++) await add(request, `分页网站 ${i}`, group.id);
  await page.goto('/');
  await page.getByRole('button', { name: `打开文件夹：${name}`, exact: true }).click();
  const folder = page.getByRole('dialog', { name, exact: true });
  await expect(folder.getByRole('link')).toHaveCount(40);
  await folder.getByRole('button', { name: '加载更多收藏' }).click();
  await expect(folder.getByRole('link')).toHaveCount(41);
  await folder.getByRole('button', { name: '添加收藏', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '添加收藏', exact: true });
  const title = `从主页添加 ${crypto.randomUUID()}`;
  await editor.locator('input[name=url]').fill(`https://example.org/${crypto.randomUUID()}`);
  await editor.locator('input[name=title]').fill(title);
  await editor.getByRole('button', { name: '保存收藏', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: `打开文件夹：${name}`, exact: true }).click();
  await expect(folder).toContainText('42 个网站');
  await folder.getByRole('button', { name: '管理这个分组' }).click();
  await expect(page).toHaveURL(new RegExp(`view=library.*groupId=${group.id}`));
  await expect(page.getByRole('link').filter({ hasText: title })).toBeVisible();
});

test('设置预览取消、保存失败保留与另一会话同步', async ({ page, request, browser, isMobile }) => {
  await page.goto('/');
  let modal = await openSettings(page, isMobile);
  await modal.getByRole('button', { name: '湖泊群山' }).click();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-blue-lake/);
  page.once('dialog', dialog => dialog.accept());
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-sunset-fields/);
  modal = await openSettings(page, isMobile);
  await modal.getByRole('button', { name: '夜色森林' }).click();
  await modal.getByLabel('默认搜索方式').selectOption('google');
  await modal.getByLabel('时钟', { exact: false }).uncheck();
  await page.route('**/api/homepage/preferences', route => route.abort('internetdisconnected'));
  await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal.getByRole('alert')).toBeVisible();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-night-forest/);
  expect((await home(request)).preferences.wallpaperId).toBe('sunset-fields');
  await page.unroute('**/api/homepage/preferences');
  await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal).not.toBeVisible();
  const second = await browser.newContext();
  try {
    const otherPage = await second.newPage();
    await otherPage.goto('http://127.0.0.1:5183/');
    await expect(otherPage.locator('.homepage')).toHaveClass(/wallpaper-night-forest/);
    await expect(otherPage.getByLabel('搜索方式', { exact: true })).toHaveValue('google');
    await expect(otherPage.getByRole('region', { name: '时钟', exact: true })).toHaveCount(0);
  } finally { await second.close(); }
  await page.reload();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-night-forest/);
});

test('设置冲突保留草稿并读取最新配置，返回受草稿保护', async ({ page, request, isMobile }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '整理我的收藏' }).click();
  if (isMobile) await page.getByRole('button', { name: '打开导航菜单' }).click();
  await page.getByRole('button', { name: '起始主页', exact: true }).click();
  const modal = await openSettings(page, isMobile);
  await modal.getByRole('button', { name: '夜色森林' }).click();
  const dismissed = new Promise<void>(resolve => page.once('dialog', async dialog => { expect(dialog.message()).toContain('主页设置'); await dialog.dismiss(); resolve(); }));
  await page.evaluate(() => history.back());
  await dismissed;
  await expect(modal).toBeVisible();
  await preferences(request, { wallpaperId: 'blue-lake' });
  await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal.getByRole('alert')).toContainText('冲突');
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-night-forest/);
  await modal.getByRole('button', { name: '读取最新设置' }).click();
  await expect(modal.getByText('账号中的最新设置')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await modal.getByRole('button', { name: '使用最新设置重新编辑' }).click();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-blue-lake/);
  await expect(modal.getByRole('button', { name: '保存主页设置' })).toBeDisabled();
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-blue-lake/);
});

test('日历、空状态、错误恢复和手机布局可用', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/homepage', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE', message: '暂时不可用' } }) }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('暂时不可用');
  await page.unroute('**/api/homepage');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开文件夹：未分组', exact: true })).toBeVisible();
  const today = await page.getByRole('button', { name: '返回今天' }).innerText();
  await page.getByRole('button', { name: '下个月', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回今天' })).not.toHaveText(today);
  await page.getByRole('button', { name: '返回今天' }).click();
  await expect(page.getByRole('button', { name: '返回今天' })).toHaveText(today);
  if (isMobile) {
    await page.getByRole('button', { name: '打开主页导航' }).click();
    await expect(page.getByRole('dialog', { name: '你的空间' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '收藏管理', exact: true }).click();
    await expect(page).toHaveURL(/view=library/);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});


test('外部搜索正确编码，中文输入期间不提交', async ({ page, context }) => {
  await context.route('https://www.bing.com/**', route => route.fulfill({ contentType: 'text/html', body: '<p>search destination</p>' }));
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: '主页搜索' });
  await expect(page.getByRole('button', { name: '执行搜索' })).toBeDisabled();
  await search.fill('猫 & q=另一个词 #');
  await search.dispatchEvent('compositionstart');
  await search.press('Enter');
  expect(context.pages()).toHaveLength(1);
  await search.dispatchEvent('compositionend');
  const popupPromise = page.waitForEvent('popup');
  await search.press('Enter');
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  const url = new URL(popup.url());
  expect(url.hostname).toBe('www.bing.com');
  expect(url.searchParams.get('q')).toBe('猫 & q=另一个词 #');
  await popup.close();
});

test('重新获得焦点同步设置，未保存预览保持独立', async ({ page, request, isMobile }) => {
  await page.goto('/');
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-sunset-fields/);
  await preferences(request, { wallpaperId: 'blue-lake' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-blue-lake/);
  const modal = await openSettings(page, isMobile);
  await modal.getByRole('button', { name: '夜色森林' }).click();
  await preferences(request, { wallpaperId: 'sunset-fields', showCalendar: false });
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/homepage'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-night-forest/);
  page.once('dialog', dialog => dialog.accept());
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.homepage')).toHaveClass(/wallpaper-sunset-fields/);
  await expect(page.getByRole('region', { name: '日历', exact: true })).toHaveCount(0);
});

test('空分组、无常用与长标题仍可操作，过期会话提供恢复入口', async ({ page, request }) => {
  const name = `空分组 ${crypto.randomUUID()}`;
  const response = await request.post('/api/groups', { headers, data: { operationId: crypto.randomUUID(), name } });
  expect(response.ok()).toBe(true);
  await page.route('**/api/bookmarks?*', async route => {
    if (new URL(route.request().url()).searchParams.get('pinned') === 'true') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, nextCursor: null, revision: 0 }) });
    } else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByText('把喜欢的网站设为常用，下次从这里出发。')).toBeVisible();
  await page.getByRole('button', { name: `打开文件夹：${name}`, exact: true }).click();
  const folder = page.getByRole('dialog', { name, exact: true });
  await expect(folder.getByText('这里还留着位置，给下一个好网站。')).toBeVisible();
  await expect(folder.getByRole('button', { name: '添加收藏', exact: true }).first()).toBeEnabled();
  await folder.getByRole('button', { name: '关闭弹窗' }).press('Escape');
  await expect(page.getByRole('button', { name: `打开文件夹：${name}`, exact: true })).toBeFocused();
  await page.unroute('**/api/bookmarks?*');
  const longTitle = '很长的中文网站标题与说明'.repeat(20).slice(0, 200);
  const groupId = (await response.json()).data.id as string;
  await add(request, longTitle, groupId);
  await page.reload();
  await page.getByRole('button', { name: `打开文件夹：${name}`, exact: true }).click();
  await expect(folder.getByRole('link', { name: longTitle, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await folder.getByRole('button', { name: '关闭弹窗' }).click();
  await page.route('**/api/session', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: '会话已过期' } }) }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: '新窗口重新认证' })).toBeVisible();
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: '我已登录，检查会话' }).click();
  await expect(page.getByRole('link', { name: '新窗口重新认证' })).toHaveCount(0);
});

test('常用收藏沿用顺序并分页加载', async ({ page, request }) => {
  const created: { id: string; version: number }[] = [];
  try {
    for (let index = 0; index < 21; index++) created.push(await add(request, `常用分页 ${index}`, null, true));
    const expected = await (await request.get('/api/bookmarks?pinned=true&sort=manual&limit=100')).json();
    await page.goto('/');
    const shortcuts = page.locator('.home-shortcuts').getByRole('link');
    await expect(shortcuts).toHaveCount(20);
    expect(await shortcuts.allTextContents()).toEqual(expected.items.slice(0, 20).map((item: { title: string }) => item.title));
    await page.getByRole('button', { name: '更多常用收藏' }).click();
    await expect(shortcuts).toHaveCount(Math.min(expected.total, 40));
    expect(await shortcuts.allTextContents()).toEqual(expected.items.slice(0, 40).map((item: { title: string }) => item.title));
  } finally {
    // Leave the shared test account below the first-page limit for the next device's regression cases.
    for (const bookmark of created) {
      const response = await request.post(`/api/bookmarks/${bookmark.id}/trash`, { headers, data: { operationId: crypto.randomUUID(), version: bookmark.version } });
      expect(response.ok()).toBe(true);
    }
  }
});
