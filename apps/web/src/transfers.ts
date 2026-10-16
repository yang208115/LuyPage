import { MAX_TRANSFER_BOOKMARKS, MAX_TRANSFER_BYTES, portableBookmarkSchema, transferDocumentSchema, type PortableBookmark, type TransferDocument } from '@luypage/contracts';

export interface ImportPreview { document: TransferDocument; ignored: number; filename: string }
export async function readImportFile(file: File): Promise<ImportPreview> {
  if (file.size > MAX_TRANSFER_BYTES) throw new Error('文件不能超过 10 MiB。');
  const text = (await file.text()).replace(/^\uFEFF/, '');
  let document: TransferDocument; let ignored = 0;
  if (/\.json$/i.test(file.name) || /^\s*[\[{]/.test(text)) {
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error('JSON 文件不完整或格式无效。'); }
    const parsed = transferDocumentSchema.safeParse(value);
    if (!parsed.success) throw new Error(`请选择 LuyPage JSON 导出文件（版本 1）。${parsed.error.issues[0]?.message ?? ''}`);
    document = parsed.data;
  } else {
    // Template contents are inert: no scripts execute and no imported resources load.
    const template = window.document.createElement('template'); template.innerHTML = text;
    const anchors = template.content.querySelectorAll('dl a[href]');
    if (!anchors.length) throw new Error('未找到书签，请选择浏览器导出的书签 HTML 文件。');
    if (anchors.length > MAX_TRANSFER_BOOKMARKS) throw new Error('单次最多导入 5000 条收藏。');
    const bookmarks: PortableBookmark[] = [];
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href)) { ignored++; continue; }
      const path: string[] = [];
      let list = anchor.closest('dl');
      while (list) {
        const previous = list.previousElementSibling;
        const heading = previous?.matches('h3') ? previous : list.parentElement?.matches('dt') ? list.parentElement.querySelector(':scope > h3') : null;
        if (heading?.textContent?.trim()) path.unshift(heading.textContent.trim());
        list = list.parentElement?.closest('dl') ?? null;
      }
      let extra: Record<string, unknown> = {};
      const metadata = anchor.getAttribute('data-luypage');
      if (metadata) {
        try { const value: unknown = JSON.parse(metadata); if (value && typeof value === 'object' && !Array.isArray(value)) extra = value as Record<string, unknown>; }
        catch { throw new Error('书签附加信息已损坏，请重新导出后重试。'); }
      }
      const description = anchor.parentElement?.nextElementSibling;
      const date = Number(anchor.getAttribute('add_date'));
      const createdAt = date > 0 && Number.isFinite(date) && date < 253402300800 ? new Date(date * 1000).toISOString() : undefined;
      const parsed = portableBookmarkSchema.safeParse({ url: href, title: anchor.textContent ?? '', group: path.length ? path.join(' / ') : null,
        tags: extra.tags ?? anchor.getAttribute('tags')?.split(',').filter(Boolean) ?? [], pinned: extra.pinned ?? false,
        icon: extra.icon, note: extra.note ?? (description?.matches('dd') ? description.textContent ?? '' : ''), createdAt: extra.createdAt ?? createdAt, updatedAt: extra.updatedAt });
      if (!parsed.success) throw new Error(`书签「${(anchor.textContent ?? '').slice(0, 40)}」无法导入：${parsed.error.issues[0]?.message ?? '格式无效'}。嵌套文件夹合并为路径，名称最多 40 字。`);
      bookmarks.push(parsed.data);
    }
    document = transferDocumentSchema.parse({ format: 'luypage', version: 1, bookmarks,
      groups: [...new Set(bookmarks.flatMap(item => item.group ? [item.group] : []))], tags: [...new Set(bookmarks.flatMap(item => item.tags))] });
  }
  if (new TextEncoder().encode(JSON.stringify(document)).length > MAX_TRANSFER_BYTES) throw new Error('解析后的数据超过 10 MiB，请拆分文件后导入。');
  return { document, ignored, filename: file.name };
}

export function downloadFile(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  // Keep the URL alive long enough for the browser to start its download.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
