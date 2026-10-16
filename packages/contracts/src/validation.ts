import { caseFold } from 'unicode-case-folding';
import { z } from 'zod';
import { AppError } from './errors';
import { DEFAULT_PREFERENCES, WALLPAPER_IDS, SEARCH_PROVIDERS } from './types';

const URL_LIMIT = 8_192;
export const MAX_BATCH_ITEMS = 5_000;
export const MAX_LAYOUT_OPERATIONS = 10_000;
const hasInvalidUnicode = (value: string): boolean => /[\uD800-\uDFFF]/u.test(value);
const codePointLength = (value: string): number => Array.from(value).length;

function assertUnicode(value: string): void {
  if (typeof value !== 'string' || hasInvalidUnicode(value)) {
    throw new AppError('INVALID_UNICODE', '文本包含不合法的 Unicode 字符');
  }
}

/** Locale-independent canonical case folding; whitespace is significant in searchable text. */
export function searchKey(value: string): string {
  assertUnicode(value);
  return caseFold(value.normalize('NFC')).normalize('NFC');
}

export function nameKey(value: string): string {
  assertUnicode(value);
  return searchKey(value.trim());
}

function invalidUrl(message = '请输入有效的 HTTP 或 HTTPS 网址'): never {
  throw new AppError('INVALID_URL', message);
}

function validHostname(hostname: string): boolean {
  // URL has already validated and serialized IPv6 literals and international domain names.
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
  const domain = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  return domain.length > 0 && domain.length <= 253 && domain.split('.').every(
    (label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  );
}

export function normalizeUrl(value: string): { url: string; normalizedUrl: string; hostname: string } {
  assertUnicode(value);
  const input = value.trim();
  if (!input || /[\u0000-\u001F\u007F\\]/u.test(input)) invalidUrl();

  const explicitProtocol = /^https?:\/\//i.test(input);
  if (!explicitProtocol && (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) || /^[/?#]/.test(input))) invalidUrl();
  const url = explicitProtocol ? input : `https://${input}`;
  if (codePointLength(url) > URL_LIMIT) invalidUrl('网址不能超过 8192 个 Unicode 码点');

  const authority = url.slice(url.indexOf('://') + 3).split(/[/?#]/, 1)[0] ?? '';
  // Reject even empty userinfo, and syntax that URL would silently repair (e.g. extra slashes).
  if (authority.includes('@')) invalidUrl('网址不能包含用户名或密码');
  if (!/^(?:\[[^\]]+\]|[^:\s]+)(?::[0-9]{1,5})?$/u.test(authority)) invalidUrl();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return invalidUrl();
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) invalidUrl();
  if (!validHostname(parsed.hostname)) invalidUrl();
  if (!explicitProtocol && parsed.hostname !== 'localhost' && !parsed.hostname.includes('.') && !parsed.hostname.startsWith('[')) {
    invalidUrl('省略协议时请输入有效域名、localhost 或 IP 地址');
  }

  // Do not round-trip through URLSearchParams: it changes ordering and escaping of query values.
  const normalizedUrl = parsed.href;
  if (codePointLength(normalizedUrl) > URL_LIMIT) invalidUrl('规范化后的网址不能超过 8192 个 Unicode 码点');
  return { url, normalizedUrl, hostname: parsed.hostname };
}

function textSchema(max: number, trim = false, min = 0) {
  return z.string().refine((value) => !hasInvalidUnicode(value), '文本包含不合法的 Unicode 字符')
    .transform((value) => trim ? value.trim() : value)
    .refine((value) => codePointLength(value) >= min, '内容不能为空')
    .refine((value) => codePointLength(value) <= max, `内容不能超过 ${max} 个 Unicode 码点`);
}

// Entity IDs are opaque ASCII identifiers; only mutation operation IDs require UUID syntax.
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,36}$/, '标识必须是 1–36 个 ASCII 字母、数字、短横线或下划线');
const operationIdSchema = z.uuid();
const versionSchema = z.number().int().positive();

function uniqueIds(max?: number) {
  const schema = z.array(idSchema);
  return (max === undefined ? schema : schema.max(max))
    .refine((ids) => new Set(ids).size === ids.length, '标识不能重复');
}

const urlSchema = z.string().transform((value, context) => {
  try {
    return normalizeUrl(value).url;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    context.addIssue({ code: 'custom', message: error.message });
    return z.NEVER;
  }
});

const iconSchema = z.object({
  type: z.enum(['auto', 'builtin']),
  key: z.string().regex(/^[\x21-\x7E]{1,128}$/, '内置图标键必须是 1–128 个可见 ASCII 字符').nullable().default(null),
}).refine((icon) => icon.type === 'auto' ? icon.key === null : icon.key !== null, '自动图标的 key 必须为空，内置图标必须提供 key');

export const bookmarkInputSchema = z.object({
  url: urlSchema,
  title: textSchema(200, true).default(''),
  note: textSchema(2_000).default(''),
  groupId: idSchema.nullable().default(null),
  tagIds: uniqueIds(20).default(() => []),
  pinned: z.boolean().default(false),
  icon: iconSchema.default(() => ({ type: 'auto' as const, key: null })),
});

export const createBookmarkSchema = bookmarkInputSchema.extend({ operationId: operationIdSchema });
export const updateBookmarkSchema = createBookmarkSchema.extend({ version: versionSchema });
export const versionInputSchema = z.object({ operationId: operationIdSchema, version: versionSchema });
export const nameInputSchema = z.object({
  operationId: operationIdSchema,
  name: textSchema(40, true, 1),
  version: versionSchema.optional(),
});

export const batchInputSchema = z.object({
  operationId: operationIdSchema,
  action: z.enum(['trash', 'restore', 'delete', 'move', 'addTags', 'removeTags']),
  items: z.array(z.object({ id: idSchema, version: versionSchema })).min(1).max(MAX_BATCH_ITEMS)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, '收藏标识不能重复'),
  groupId: idSchema.nullable().optional(),
  tagIds: uniqueIds(20).optional(),
}).superRefine((input, context) => {
  if (input.action === 'move' && input.groupId === undefined) {
    context.addIssue({ code: 'custom', path: ['groupId'], message: '移动收藏必须指定目标分组，未分组使用 null' });
  }
  if (['addTags', 'removeTags'].includes(input.action) && !input.tagIds?.length) {
    context.addIssue({ code: 'custom', path: ['tagIds'], message: '请选择至少一个标签' });
  }
});

export const layoutPreferencesSchema = z.object({
  desktopColumns: z.union([z.literal('auto'), z.literal(4), z.literal(5), z.literal(6)]).default(DEFAULT_PREFERENCES.desktopColumns),
  mobileColumns: z.union([z.literal('auto'), z.literal(2), z.literal(3)]).default(DEFAULT_PREFERENCES.mobileColumns),
  density: z.enum(['comfortable', 'compact']).default(DEFAULT_PREFERENCES.density),
  collapsedGroupIds: uniqueIds().default(() => []),
  autoIcons: z.boolean().default(DEFAULT_PREFERENCES.autoIcons),
});

export const homepagePreferencesSchema = z.strictObject({
  wallpaperId: z.enum(WALLPAPER_IDS),
  searchProvider: z.enum(SEARCH_PROVIDERS),
  showClock: z.boolean(),
  showCalendar: z.boolean(),
});
export const homepageSaveSchema = z.strictObject({
  operationId: operationIdSchema,
  baseRevision: z.number().int().nonnegative(),
  preferences: homepagePreferencesSchema,
});

export const placementSchema = z.union([
  z.strictObject({ edge: z.enum(['start', 'end']) }),
  z.strictObject({ beforeId: idSchema }),
  z.strictObject({ afterId: idSchema }),
]);

export const layoutOperationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bookmark'), id: idSchema, groupId: idSchema.nullable(), placement: placementSchema }),
  z.strictObject({ type: z.literal('group'), id: idSchema, placement: placementSchema }),
  z.strictObject({ type: z.literal('pinned'), id: idSchema, placement: placementSchema }),
]);

// Allow several moves of the same item, but bound the work independently of HTTP body size.
export const layoutOperationsSchema = z.array(layoutOperationSchema).max(MAX_LAYOUT_OPERATIONS);

export const layoutSaveSchema = z.object({
  operationId: operationIdSchema,
  baseRevision: z.number().int().nonnegative(),
  operations: layoutOperationsSchema.default(() => []),
  preferences: layoutPreferencesSchema.prefault({}),
  reset: z.boolean().optional(),
}).refine((input) => !input.reset || input.operations.length === 0, {
  path: ['operations'], message: '恢复默认布局不能同时提交移动操作',
});
