import { test, expect, type APIRequestContext } from '@playwright/test';
import type { Bookmark } from '../../packages/contracts/src/types';

const headers = { Origin: 'http://127.0.0.1:5183' };
async function seed(request: APIRequestContext, pinned = true) {
  const token = crypto.randomUUID();
  const groupResponse = await request.post('/api/groups', { headers, data: { operationId: crypto.randomUUID(), name: `右键分组 ${token.slice(0, 12)}` } });
  expect(groupResponse.ok(), await groupResponse.text()).toBe(true);
  const group = (await groupResponse.json()).data as { id: string; name: string };
  const response = await request.post('/api/bookmarks', { headers, data: {
    operationId: crypto.randomUUID(), title: `右键网站 ${token}`, url: `https://example.com/${token}`,
    note: '需要保留的备注', groupId: group.id, tagIds: [], pinned, icon: { type: 'builtin', key: 'book' },
  } });
  expect(response.ok()).toBe(true);
  return { bookmark: (await response.json()).data as Bookmark, group };
}

test('shortcut menu supports clipboard, keyboard, bounded positioning, editing and unpinning without losing metadata', async ({ page, request, context }) => {
  const { bookmark } = await seed(request);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const shortcut = page.locator('.home-shortcuts').getByRole('link', { name: bookmark.title, exact: true });
  await shortcut.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: '取消常用', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '永久删除' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: '复制链接' }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(bookmark.url);

  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<p>打开成功</p>' }));
  await shortcut.click({ button: 'right' });
  const opening = page.waitForEvent('popup');
  await menu.getByRole('menuitem', { name: '在新标签页打开' }).click();
  const opened = await opening;
  await expect(opened).toHaveURL(bookmark.url);
  await opened.close();

  await shortcut.press('Shift+F10');
  await expect(menu.getByRole('menuitem', { name: '在新标签页打开' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: '移入回收站' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(shortcut).toBeFocused();
  const viewport = page.viewportSize()!;
  await shortcut.evaluate((element, viewport) => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: viewport.width - 2, clientY: viewport.height - 2 })), viewport);
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 7);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 7);
  await menu.getByRole('menuitem', { name: '编辑收藏' }).click();
  const editor = page.getByRole('dialog', { name: '编辑收藏', exact: true });
  await expect(editor.locator('textarea[name=note]')).toHaveValue(bookmark.note);
  const title = `${bookmark.title} 已编辑`;
  await editor.locator('input[name=title]').fill(title);
  await editor.getByRole('button', { name: '保存收藏', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const updated = page.locator('.home-shortcuts').getByRole('link', { name: title, exact: true });
  await updated.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '取消常用', exact: true }).click();
  await expect(updated).toHaveCount(0);
  const saved = await (await request.get(`/api/bookmarks/${bookmark.id}`)).json();
  expect(saved).toMatchObject({ title, note: bookmark.note, groupId: bookmark.groupId, url: bookmark.url, icon: bookmark.icon, pinned: false });
});

test('folder and dialog menus add to the correct group and can pin lightweight previews', async ({ page, request }) => {
  const { bookmark, group } = await seed(request, false);
  await page.goto('/');
  const folder = page.getByRole('button', { name: `打开文件夹：${group.name}`, exact: true });
  await folder.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加收藏到此分组' }).click();
  const editor = page.getByRole('dialog', { name: '添加收藏', exact: true });
  await expect(editor.getByRole('combobox', { name: '分组', exact: true })).toHaveValue(group.id);
  await editor.getByRole('button', { name: '关闭弹窗' }).click();
  await folder.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: group.name, exact: true });
  const link = dialog.getByRole('link', { name: bookmark.title, exact: true });
  await link.click({ button: 'right' });
  await expect(dialog.getByRole('menu')).toBeVisible();
  await dialog.getByRole('menuitem', { name: '设为常用', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/bookmarks/${bookmark.id}`)).json()).pinned).toBe(true);
  await expect(dialog).toBeVisible();
  await link.click({ button: 'right' });
  await dialog.getByRole('menuitem', { name: '编辑收藏' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '编辑收藏', exact: true }).locator('input[name=title]')).toHaveValue(bookmark.title);
});

test('background menu works while input fields keep their native menu and failures remain visible', async ({ page, request }) => {
  const { bookmark } = await seed(request);
  await page.goto('/');
  const clock = page.getByRole('region', { name: '时钟', exact: true });
  await clock.click({ button: 'right' });
  await page.getByRole('searchbox', { name: '主页搜索' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await clock.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '主页设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '让主页更像你' });
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('searchbox', { name: '主页搜索' }).dispatchEvent('contextmenu', { clientX: 100, clientY: 100 });
  await expect(page.getByRole('menu')).toHaveCount(0);
  const shortcut = page.locator('.home-shortcuts').getByRole('link', { name: bookmark.title, exact: true });
  await page.route(`**/api/bookmarks/${bookmark.id}`, route => route.abort('internetdisconnected'));
  await shortcut.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑收藏' }).click();
  await expect(page.getByRole('alert')).toContainText('连接未完成');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.unroute(`**/api/bookmarks/${bookmark.id}`);
  await shortcut.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑收藏' }).click();
  await expect(page.getByRole('dialog', { name: '编辑收藏', exact: true })).toBeVisible();
});

test('library menu shares confirmed trash and restore actions and does not intercept multiselect', async ({ page, request }) => {
  const { bookmark } = await seed(request);
  await page.goto(`/?view=library&q=${encodeURIComponent(bookmark.title)}`);
  const card = page.getByRole('article').filter({ hasText: bookmark.title });
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移入回收站', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '移入回收站？', exact: true });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  expect((await (await request.get(`/api/bookmarks/${bookmark.id}`)).json()).deletedAt).toBeNull();
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移入回收站', exact: true }).click();
  await confirmation.getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await page.goto(`/?view=trash&q=${encodeURIComponent(bookmark.title)}`);
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '恢复收藏', exact: true }).click();
  const restore = page.getByRole('dialog', { name: '恢复这条收藏？', exact: true });
  await restore.getByRole('button', { name: '恢复收藏', exact: true }).click();
  await expect(restore).toHaveCount(0);
  await page.goto(`/?view=library&q=${encodeURIComponent(bookmark.title)}`);
  await page.getByRole('button', { name: '批量管理', exact: true }).click();
  await card.dispatchEvent('contextmenu', { clientX: 100, clientY: 100 });
  await expect(page.getByRole('menu')).toHaveCount(0);
});
