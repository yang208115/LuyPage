import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('HTML import preview, duplicate retry, JSON/HTML export and persisted automatic icon toggle', async ({ page }, testInfo) => {
  const token = `${testInfo.project.name}-${Date.now()}`;
  const title = `迁移 ${token}`;
  let untrustedRequests = 0;
  await page.route('https://untrusted-import.invalid/**', route => { untrustedRequests++; return route.abort(); });
  await page.goto('/?view=library');
  await page.getByRole('button', { name: '使用与设置' }).click();
  const modal = page.getByRole('dialog');
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>研发</H3><DL><p><DT><H3>文档</H3><DL><p><DT><A HREF="https://example.com/${token}">${title}</A><DD>备注 &amp; 说明</DL><p></DL><p><DT><A HREF="javascript:alert(1)">危险链接</A></DL><p><img src="https://untrusted-import.invalid/image"><script>window.__importScriptRan=true</script>`;
  const upload = { name: 'bookmarks.html', mimeType: 'text/html', buffer: Buffer.from(html) };
  await modal.getByLabel('选择书签文件').setInputFiles(upload);
  await expect(modal.getByText(/待导入 1 条收藏/)).toBeVisible();
  await expect(modal.getByText(/忽略 1 条非 HTTP/)).toBeVisible();
  expect(untrustedRequests).toBe(0);
  expect(await page.evaluate(() => '__importScriptRan' in window)).toBe(false);
  await modal.getByRole('button', { name: '确认导入' }).click();
  await expect(modal.getByRole('status')).toContainText('新增 1 条');
  await modal.getByLabel('选择书签文件').setInputFiles(upload);
  await modal.getByRole('button', { name: '确认导入' }).click();
  await expect(modal.getByRole('status')).toContainText('跳过 1 条重复链接');

  const jsonDownload = page.waitForEvent('download');
  await modal.getByRole('button', { name: '导出收藏' }).click();
  const jsonFile = await jsonDownload; const json = JSON.parse(await readFile((await jsonFile.path())!, 'utf8'));
  expect(json.bookmarks).toEqual(expect.arrayContaining([expect.objectContaining({ title, group: '研发 / 文档', note: '备注 & 说明' })]));
  await modal.getByLabel('导出格式').selectOption('html');
  const htmlDownload = page.waitForEvent('download');
  await modal.getByRole('button', { name: '导出收藏' }).click();
  const htmlFile = await htmlDownload;
  await modal.getByLabel('选择书签文件').setInputFiles({ name: 'roundtrip.html', mimeType: 'text/html', buffer: await readFile((await htmlFile.path())!) });
  await expect(modal.getByText(/待导入/)).toBeVisible();
  await modal.getByRole('button', { name: '确认导入' }).click();
  await expect(modal.getByRole('status')).toContainText('新增 0 条');
  // JSON import also preserves the existing metadata and does not duplicate records.
  await modal.getByLabel('选择书签文件').setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: await readFile((await jsonFile.path())!) });
  await modal.getByRole('button', { name: '确认导入' }).click();
  await expect(modal.getByRole('status')).toContainText('新增 0 条');

  let iconsRequested = 0;
  await page.route('**/api/bookmarks/*/icon', route => { iconsRequested++; return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); });
  const checkbox = modal.getByRole('checkbox', { name: '自动获取网站图标' });
  await checkbox.check(); await expect(checkbox).toBeChecked(); await expect(checkbox).toBeEnabled();
  await expect.poll(() => iconsRequested).toBeGreaterThan(0);
  await page.reload();
  await page.getByRole('button', { name: '使用与设置' }).click();
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck(); await expect(checkbox).not.toBeChecked(); await expect(checkbox).toBeEnabled();
  await expect(page.locator('img.automatic-site-icon')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('transfer-settings.png'), fullPage: true });
});
