import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_HOMEPAGE_PREFERENCES } from '../../packages/contracts/src/types';
const headers = { Origin: 'http://127.0.0.1:5183' };
async function settings(page: Page, mobile: boolean) {
  await page.getByRole('button', { name: mobile ? '打开主页设置' : '主页设置', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '让主页更像你' });
  await expect(modal.getByLabel('磁贴外观调整范围')).toBeEnabled(); return modal;
}
async function range(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
}
test.beforeEach(async ({ request }) => {
  const current = await (await request.get('/api/homepage')).json();
  expect((await request.put('/api/homepage/preferences', { headers, data: { operationId: crypto.randomUUID(), baseRevision: current.revision, preferences: DEFAULT_HOMEPAGE_PREFERENCES } })).ok()).toBe(true);
});

test('appearance previews, cancels, saves global and individual styles and resets', async ({ page, request, isMobile }, info) => {
  await page.goto('/'); let modal = await settings(page, isMobile);
  await modal.getByRole('button', { name: '暮蓝磁贴配色' }).click();
  await range(page, '磁贴背景透明度', '20'); await range(page, '磁贴圆角', '32');
  const clock = page.locator('[data-tile-id="clock"] .home-clock'); const calendar = page.locator('[data-tile-id="calendar"] .home-calendar');
  await expect(clock).toHaveCSS('background-color', 'rgba(24, 54, 79, 0.8)');
  await expect(calendar).toHaveCSS('border-radius', '32px');
  page.once('dialog', dialog => dialog.accept()); await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(clock).toHaveCSS('background-color', 'rgba(35, 46, 39, 0.65)');
  modal = await settings(page, isMobile);
  await modal.getByRole('button', { name: '奶油磁贴配色' }).click();
  await range(page, '磁贴背景透明度', '0'); await range(page, '磁贴圆角', '30');
  await modal.getByLabel('磁贴外观调整范围').selectOption('clock');
  await modal.getByRole('button', { name: '葡萄磁贴配色' }).click();
  await range(page, '磁贴背景透明度', '40'); await range(page, '磁贴圆角', '8');
  await expect(clock).toHaveCSS('background-color', 'rgba(70, 51, 79, 0.6)');
  await expect(calendar).toHaveCSS('background-color', 'rgb(245, 236, 216)');
  await expect(calendar).toHaveCSS('color', 'rgb(25, 45, 43)');
  await modal.getByRole('button', { name: '保存主页设置' }).click(); await expect(modal).not.toBeVisible();
  await page.reload(); await expect(clock).toHaveCSS('border-radius', '8px'); await expect(calendar).toHaveCSS('border-radius', '30px');
  const preferences = (await (await request.get('/api/homepage')).json()).preferences;
  expect(preferences.tileAppearance.overrides.clock.background).toBe('#46334f');
  await page.screenshot({ path: info.outputPath('personalized-tiles.png'), fullPage: true });
  modal = await settings(page, isMobile); await modal.getByLabel('磁贴外观调整范围').selectOption('clock');
  await modal.getByRole('button', { name: '跟随统一样式', exact: true }).click();
  await expect(clock).toHaveCSS('background-color', 'rgb(245, 236, 216)');
  await modal.getByRole('button', { name: '恢复全部磁贴外观' }).click();
  await modal.getByRole('button', { name: '保存主页设置' }).click(); await expect(modal).not.toBeVisible();
  await expect(clock).toHaveCSS('background-color', 'rgba(35, 46, 39, 0.65)');
});

test('failed appearance save retains preview and can retry', async ({ page, isMobile }) => {
  await page.goto('/'); const modal = await settings(page, isMobile);
  await modal.getByRole('button', { name: '暮蓝磁贴配色' }).click();
  await page.route('**/api/homepage/preferences', route => route.abort('internetdisconnected'));
  await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-tile-id="clock"] .home-clock')).toHaveCSS('background-color', 'rgba(24, 54, 79, 0.65)');
  await page.unroute('**/api/homepage/preferences');
  await modal.getByRole('button', { name: '保存主页设置' }).click(); await expect(modal).not.toBeVisible();
  await page.reload(); await expect(page.locator('[data-tile-id="clock"] .home-clock')).toHaveCSS('background-color', 'rgba(24, 54, 79, 0.65)');
});
