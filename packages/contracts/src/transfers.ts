import { z } from 'zod';
import { bookmarkInputSchema, nameInputSchema, nameKey } from './validation';

export const MAX_TRANSFER_BOOKMARKS = 5_000;
export const MAX_TRANSFER_BYTES = 10 * 1024 * 1024;
const name = nameInputSchema.shape.name;
export const portableBookmarkSchema = bookmarkInputSchema.omit({ groupId: true, tagIds: true }).extend({
  group: name.nullable().default(null),
  tags: z.array(name).max(20).default(() => []),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
});
export const transferDocumentSchema = z.object({
  format: z.literal('luypage'), version: z.literal(1),
  exportedAt: z.iso.datetime().optional(),
  groups: z.array(name).max(MAX_TRANSFER_BOOKMARKS).default(() => []),
  tags: z.array(name).max(MAX_TRANSFER_BOOKMARKS).default(() => []),
  bookmarks: z.array(portableBookmarkSchema).max(MAX_TRANSFER_BOOKMARKS),
}).superRefine((document, context) => {
  const groups = new Set(document.groups.map(nameKey));
  const tags = new Set(document.tags.map(nameKey));
  for (const item of document.bookmarks) {
    if (item.group) groups.add(nameKey(item.group));
    for (const tag of item.tags) tags.add(nameKey(tag));
  }
  if (groups.size > MAX_TRANSFER_BOOKMARKS || tags.size > MAX_TRANSFER_BOOKMARKS) context.addIssue({ code: 'custom', message: '分组和标签分别最多 5000 个。' });
});
export const importInputSchema = z.object({ operationId: z.uuid(), document: transferDocumentSchema });
export type TransferDocument = z.infer<typeof transferDocumentSchema>;
export type PortableBookmark = z.infer<typeof portableBookmarkSchema>;
export interface ImportResult { imported: number; skipped: number; revision: number }

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function bookmarksHtml(document: TransferDocument): string {
  const rows = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
  const buckets = new Map<string | null, PortableBookmark[]>([[null, []], ...document.groups.map(group => [group, []] as [string, PortableBookmark[]])]);
  for (const bookmark of document.bookmarks) {
    if (!buckets.has(bookmark.group)) buckets.set(bookmark.group, []);
    buckets.get(bookmark.group)!.push(bookmark);
  }
  for (const [group, bookmarks] of buckets) {
    if (group) rows.push(`<DT><H3>${escapeHtml(group)}</H3>`, '<DL><p>');
    for (const bookmark of bookmarks) {
      const extra = escapeHtml(JSON.stringify({ tags: bookmark.tags, pinned: bookmark.pinned, icon: bookmark.icon, note: bookmark.note, createdAt: bookmark.createdAt, updatedAt: bookmark.updatedAt }));
      rows.push(`<DT><A HREF="${escapeHtml(bookmark.url)}" DATA-LUYPAGE="${extra}"${bookmark.createdAt ? ` ADD_DATE="${Math.floor(Date.parse(bookmark.createdAt) / 1000)}"` : ''}>${escapeHtml(bookmark.title)}</A>`);
      if (bookmark.note) rows.push(`<DD>${escapeHtml(bookmark.note)}`);
    }
    if (group) rows.push('</DL><p>');
  }
  rows.push('</DL><p>');
  return rows.join('\n');
}
