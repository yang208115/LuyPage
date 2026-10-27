import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEFAULT_HOMEPAGE_PREFERENCES } from '@luypage/contracts';

const headers = { Origin: 'http://127.0.0.1:5183' };
const city = { name: '台北 · 台湾', latitude: 25.03, longitude: 121.56 };
const conditions = { temperature: 23.4, apparentTemperature: 24.1, humidity: 68, windSpeed: 8.2, code: 2, isDay: true, low: 20, high: 26, observedAt: Date.now(), fetchedAt: Date.now() };
const home = async (request: APIRequestContext) => (await request.get('/api/homepage')).json();
async function settings(page: Page) {
  await page.getByRole('button', { name: '选择天气城市', exact: true }).click();
  return page.getByRole('dialog', { name: '让主页更像你' });
}
test.beforeEach(async ({ page, request }) => {
  const current = await home(request);
  expect((await request.put('/api/homepage/preferences', { headers, data: { operationId: crypto.randomUUID(), baseRevision: current.revision, preferences: DEFAULT_HOMEPAGE_PREFERENCES } })).ok()).toBe(true);
  await page.route('**/api/weather/locations?*', route => route.fulfill({ json: { locations: [city] } }));
  await page.route('**/api/weather?*', route => route.fulfill({ json: conditions }));
  await page.route('**/api/weather/location', route => route.fulfill({ json: { location: { name: 'Tokyo · JP（网络估算）', latitude: 35.68, longitude: 139.69 } } }));
});

test('city preview can be cancelled, saved and reloaded while weather supports layout editing', async ({ page, request, isMobile }, info) => {
  let weatherCalls = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/weather') weatherCalls++; });
  await page.goto('/');
  await expect(page.getByRole('region', { name: '天气', exact: true })).toContainText('选择城市或定位');
  expect(weatherCalls).toBe(0);
  let modal = await settings(page);
  await modal.getByLabel('天气城市', { exact: true }).fill('台北');
  await modal.getByRole('button', { name: '搜索城市', exact: true }).click();
  await modal.getByRole('button', { name: city.name, exact: true }).click();
  await expect(page.getByRole('region', { name: '天气', exact: true })).toContainText('23');
  page.once('dialog', dialog => dialog.accept());
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  expect((await home(request)).preferences.weatherLocation).toBeNull();
  await expect(page.getByRole('region', { name: '天气', exact: true })).toContainText('选择城市或定位');
  modal = await settings(page);
  await modal.getByLabel('天气城市', { exact: true }).fill('台北');
  await modal.getByRole('button', { name: '搜索城市', exact: true }).click();
  await modal.getByRole('button', { name: city.name, exact: true }).click();
  await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal).not.toBeVisible(); await page.reload();
  const card = page.getByRole('region', { name: '天气', exact: true });
  await expect(card).toContainText('多云'); await expect(card).toContainText('20° / 26°'); await expect(card).toContainText('体感 24°');
  expect((await home(request)).preferences.weatherLocation).toEqual(city);
  if (isMobile) await page.getByRole('button', { name: '打开主页导航' }).click();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  const before = await home(request);
  const move = page.getByRole('button', { name: '移动天气', exact: true });
  const device = isMobile ? 'mobile' : 'desktop';
  const start = Number(await page.locator('[data-tile-id="weather"]').evaluate(element => getComputedStyle(element).gridRowStart));
  await move.focus(); await page.keyboard.press('Space'); await expect(move).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-tile-id="weather"]')).toHaveCSS('grid-row-start', String(start + 1));
  await page.keyboard.press('Space');
  await expect(page.locator('.homepage-layout-toolbar')).toContainText('已保存');
  const after = await home(request);
  expect(after.layout[device].items.find((item: { id: string }) => item.id === 'weather').y).toBe(start);
  expect(after.layout[device].pinnedSlots).toEqual(before.layout[device]?.pinnedSlots ?? []);
  await page.getByRole('button', { name: '完成编辑' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('weather.png'), fullPage: true });
});

test('current location is requested on click, rounded and saved; hiding weather stops requests', async ({ page, context, request }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 25.033964, longitude: 121.564468 });
  await page.goto('/');
  const modal = await settings(page);
  await modal.getByRole('button', { name: '使用当前位置', exact: true }).click();
  await expect(modal.getByText('已选择：当前位置', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: '保存主页设置' }).click();
  await expect(modal).not.toBeVisible();
  expect((await home(request)).preferences.weatherLocation).toEqual({ name: '当前位置', latitude: 25.03, longitude: 121.56 });
  await expect(page.getByRole('region', { name: '天气', exact: true })).toContainText('23');
  const again = await settings(page);
  await again.getByRole('checkbox', { name: '天气 当前温度、体感与今日高低温', exact: true }).uncheck();
  await again.getByRole('button', { name: '保存主页设置' }).click();
  await expect(again).not.toBeVisible();
  let calls = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/api/weather') calls++; });
  await page.reload(); await expect(page.getByRole('searchbox', { name: '主页搜索' })).toBeVisible();
  await expect(page.getByRole('region', { name: '天气', exact: true })).toHaveCount(0); expect(calls).toBe(0);
});

test('denied location and upstream failures leave manual city selection and retry available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { value: (_success: PositionCallback, error: PositionErrorCallback) => error({ code: 1 } as GeolocationPositionError) });
  });
  await page.goto('/');
  const modal = await settings(page);
  await modal.getByRole('button', { name: '使用当前位置', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('定位权限未开启');
  await modal.getByRole('button', { name: '按网络估算城市', exact: true }).click();
  await expect(modal.getByText('已选择：Tokyo · JP（网络估算）', { exact: true })).toBeVisible();
  await modal.getByLabel('天气城市', { exact: true }).fill('台北');
  await modal.getByRole('button', { name: '搜索城市', exact: true }).click();
  await page.route('**/api/weather?*', route => route.fulfill({ status: 503, json: { error: { code: 'WEATHER_UNAVAILABLE', message: '服务暂不可用' } } }));
  await modal.getByRole('button', { name: city.name, exact: true }).click();
  await modal.getByRole('button', { name: '保存主页设置' }).click(); await expect(modal).not.toBeVisible();
  const card = page.getByRole('region', { name: '天气', exact: true });
  await expect(card.getByRole('alert')).toContainText('天气暂时不可用');
  await page.route('**/api/weather?*', route => route.fulfill({ json: conditions }));
  await card.getByRole('button', { name: '重试', exact: true }).click(); await expect(card).toContainText('23');
});
