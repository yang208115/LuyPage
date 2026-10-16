import { test, expect, type Page } from '@playwright/test';

async function openNavigation(page: Page) {
  await page.goto('/?view=library');
  await expect(page.getByRole('button', { name: '添加收藏', exact: true }).first()).toBeVisible();
}

test('添加校验、失败草稿、持久化和搜索', async ({ page }, testInfo) => {
  const token = `${testInfo.project.name}-${Date.now()}`;
  const title = `验证收藏 ${token}`;
  const url = `https://example.com/${token}`;
  await openNavigation(page);
  await page.getByRole('button', { name: '添加收藏', exact: true }).first().click();
  const editor = page.getByRole('dialog');
  await editor.locator('input[name="url"]').fill('javascript:alert(1)');
  await editor.getByRole('button', { name: '保存收藏', exact: true }).click();
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(editor.locator('input[name="url"]')).toHaveValue('javascript:alert(1)');

  await editor.locator('input[name="url"]').fill(url);
  await editor.locator('input[name="title"]').fill(title);
  await editor.locator('textarea[name="note"]').fill('只用于自动化验收的隔离数据');
  // Simulate a lost connection before the server receives the write.
  await page.route('**/api/bookmarks', route => route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue());
  await editor.getByRole('button', { name: '保存收藏', exact: true }).click();
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(editor.locator('input[name="title"]')).toHaveValue(title);
  await page.unroute('**/api/bookmarks');
  await page.route('**/api/bookmarks', route => route.request().method() === 'POST' ? route.fulfill({ status: 302, headers: { Location: '/cdn-cgi/access/login' } }) : route.continue());
  await editor.getByRole('button', { name: '保存收藏', exact: true }).click();
  await expect(editor.getByText('需要重新认证', { exact: true })).toBeVisible();
  await expect(editor.locator('input[name="title"]')).toHaveValue(title);
  await page.unroute('**/api/bookmarks');
  await editor.getByRole('button', { name: '我已登录，检查会话', exact: true }).click();
  await expect(editor.getByText('需要重新认证', { exact: true })).not.toBeVisible();
  await editor.getByRole('button', { name: '保存收藏', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('link').filter({ hasText: title }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link').filter({ hasText: title }).first()).toBeVisible();
  const search = page.locator('input[type="search"]').first();
  await search.fill(token);
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByRole('link').filter({ hasText: title }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-collection.png`, fullPage: true });
});

test('布局草稿取消、失败保留、跨组保存和回收站恢复', async ({ page, request }, testInfo) => {
  const token = `${testInfo.project.name}-${Date.now()}`;
  const title = `整理验证 ${token}`;
  const headers = { Origin: 'http://127.0.0.1:5183' };
  const groupResponse = await request.post('/api/groups', { headers, data: { operationId: crypto.randomUUID(), name: `分组 ${token}` } });
  expect(groupResponse.ok()).toBe(true);
  const group = (await groupResponse.json()).data as { id: string };
  const bookmarkResponse = await request.post('/api/bookmarks', { headers, data: { operationId: crypto.randomUUID(), url: `https://example.net/${token}`, title } });
  expect(bookmarkResponse.ok()).toBe(true);
  const bookmark = (await bookmarkResponse.json()).data as { id: string };
  const current = async () => (await (await request.get(`/api/bookmarks/${bookmark.id}`)).json()) as { groupId: string | null; version: number };
  await openNavigation(page);
  async function movePreview() {
    await page.getByRole('button', { name: '编辑布局', exact: true }).click();
    const card = page.locator('article.bookmark-card').filter({ hasText: title });
    const summary = card.locator('.order-controls > summary');
    await expect(summary).toBeVisible();
    const controls = page.getByLabel(`将${title}移动到分组`);
    if (!(await controls.isVisible())) await summary.click();
    await controls.selectOption(group.id);
  }
  await movePreview();
  expect((await current()).groupId).toBeNull();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '取消布局编辑', exact: true }).click();
  expect((await current()).groupId).toBeNull();
  await movePreview();
  await page.route('**/api/layout', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: '布局已更新，请保留草稿后重新检查。', requestId: 'test-conflict' } }) }));
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '布局已更新' })).toBeVisible();
  expect((await current()).groupId).toBeNull();
  await page.unroute('**/api/layout');
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑布局', exact: true })).toBeEnabled();
  await expect.poll(async () => (await current()).groupId).toBe(group.id);
  const card = page.locator('article.bookmark-card').filter({ hasText: title });
  await card.getByLabel(`${title}的更多操作`).click();
  await card.getByRole('button', { name: '移入回收站', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  await confirmation.getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(card).toHaveCount(0);
  // The mobile navigation uses its own drawer. URL restoration is also a supported entry.
  await page.goto('/?view=trash');
  const trashCard = page.locator('article.bookmark-card').filter({ hasText: title });
  await expect(trashCard).toBeVisible();
  await trashCard.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '恢复收藏', exact: true }).click();
  await expect(trashCard).toHaveCount(0);
  expect((await current()).groupId).toBe(group.id);
});

test('重复收藏可查看，编辑冲突可读取被筛选隐藏的最新记录', async ({ page, request }, testInfo) => {
  const token = `${testInfo.project.name}-${Date.now()}`;
  const title = `冲突验证 ${token}`;
  const url = `https://example.org/${token}`;
  const headers = { Origin: 'http://127.0.0.1:5183' };
  const response = await request.post('/api/bookmarks', { headers, data: { operationId: crypto.randomUUID(), url, title } });
  expect(response.ok()).toBe(true);
  const bookmark = (await response.json()).data;
  await openNavigation(page);
  await page.getByRole('button', { name: '添加收藏', exact: true }).first().click();
  let editor = page.getByRole('dialog');
  await editor.locator('input[name="url"]').fill(url);
  await editor.getByRole('button', { name: '保存收藏', exact: true }).click();
  await editor.getByRole('button', { name: '查看已有收藏', exact: true }).click();
  await expect(editor.getByRole('link', { name: '打开已有收藏' })).toHaveAttribute('href', url);
  await expect(editor.getByText(title, { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('input[type="search"]').fill(title);
  await expect(page).toHaveURL(/q=/);
  const card = page.locator('article.bookmark-card').filter({ hasText: title });
  await card.getByLabel(`${title}的更多操作`).click();
  await card.getByRole('button', { name: '编辑收藏', exact: true }).click();
  editor = page.getByRole('dialog');
  await editor.locator('textarea[name="note"]').fill('保留的本地草稿');
  const updated = await request.patch(`/api/bookmarks/${bookmark.id}`, { headers, data: { ...bookmark, title: '另一个设备的新标题', operationId: crypto.randomUUID() } });
  expect(updated.ok()).toBe(true);
  await editor.getByRole('button', { name: '保存收藏', exact: true }).click();
  await editor.getByRole('button', { name: '查看最新数据', exact: true }).click();
  await expect(editor.getByText('另一个设备的新标题', { exact: true })).toBeVisible();
  await expect(editor.locator('textarea[name="note"]')).toHaveValue('保留的本地草稿');
  page.once('dialog', dialog => dialog.accept());
  await editor.getByRole('button', { name: '使用最新内容重新编辑', exact: true }).click();
  await expect(editor.locator('input[name="title"]')).toHaveValue('另一个设备的新标题');
});

test('拖动手柄将卡片放入空分组后原子保存', async ({ page, request, isMobile }) => {
  test.skip(isMobile, '触摸设备本轮通过无拖拽替代操作验证；实机触摸另行验收。');
  const token = Date.now();
  const headers = { Origin: 'http://127.0.0.1:5183' };
  async function group(name: string) {
    const response = await request.post('/api/groups', { headers, data: { operationId: crypto.randomUUID(), name } });
    expect(response.ok()).toBe(true); return (await response.json()).data as { id: string; name: string };
  }
  const source = await group(`拖动来源 ${token}`);
  const target = await group(`空白落点 ${token}`);
  const title = `拖动卡片 ${token}`;
  const response = await request.post('/api/bookmarks', { headers, data: { operationId: crypto.randomUUID(), url: `https://drag.example/${token}`, title, groupId: source.id } });
  expect(response.ok()).toBe(true);
  const bookmark = (await response.json()).data;
  await openNavigation(page);
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  const handle = page.getByRole('button', { name: `拖动${title}`, exact: true });
  const targetSection = page.locator('section.bookmark-section').filter({ has: page.getByRole('heading', { name: target.name, exact: true }) });
  const drop = targetSection.locator('.empty-drop');
  await drop.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const to = await drop.boundingBox();
  expect(from).not.toBeNull(); expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2 + 12, from!.y + from!.height / 2, { steps: 3 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(targetSection.locator('article.bookmark-card').filter({ hasText: title })).toBeVisible();
  expect((await (await request.get(`/api/bookmarks/${bookmark.id}`)).json()).groupId).toBe(source.id);
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑布局', exact: true })).toBeEnabled();
  await expect.poll(async () => (await (await request.get(`/api/bookmarks/${bookmark.id}`)).json()).groupId).toBe(target.id);
});
