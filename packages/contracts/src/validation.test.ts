import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { AppError } from './errors';
import {
  batchInputSchema, bookmarkInputSchema, createBookmarkSchema, layoutSaveSchema,
  MAX_BATCH_ITEMS, MAX_LAYOUT_OPERATIONS, nameInputSchema, nameKey, normalizeUrl,
  searchKey, updateBookmarkSchema, versionInputSchema,
} from './validation';
import {
  DEFAULT_PREFERENCES, type BatchInput, type BookmarkInput, type CreateBookmarkInput,
  type LayoutSaveInput, type NameInput, type UpdateBookmarkInput, type VersionInput,
} from './types';

const operationId = '98dd843d-c4ac-49a8-b5e8-47a98b849af4';

describe('normalizeUrl', () => {
  it('preserves user spelling while normalizing protocol, hostname and default port', () => {
    expect(normalizeUrl('  HTTP://EXAMPLE.com:80/Aa/?z=2&a=1&a=0&utm_source=X#Section  ')).toEqual({
      url: 'HTTP://EXAMPLE.com:80/Aa/?z=2&a=1&a=0&utm_source=X#Section',
      normalizedUrl: 'http://example.com/Aa/?z=2&a=1&a=0&utm_source=X#Section',
      hostname: 'example.com',
    });
  });

  it.each([
    ['example.com', 'https://example.com/'],
    ['Example.COM:8443/Path', 'https://example.com:8443/Path'],
    ['localhost:3000/a', 'https://localhost:3000/a'],
    ['127.0.0.1:8080/a', 'https://127.0.0.1:8080/a'],
    ['192.168.1.2', 'https://192.168.1.2/'],
    ['[::1]:8080/a', 'https://[::1]:8080/a'],
    ['[2001:db8::1]', 'https://[2001:db8::1]/'],
    ['例子.测试/路径', 'https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84'],
    ['https://router/admin', 'https://router/admin'],
    ['example.com/?next=https://other.example/A#part', 'https://example.com/?next=https://other.example/A#part'],
  ])('accepts %s without checking reachability', (input, normalizedUrl) => {
    expect(normalizeUrl(input).normalizedUrl).toBe(normalizedUrl);
  });

  it.each([
    '', '   ', 'not a url', 'example', '//example.com', '/relative', '?q=example.com',
    'javascript:alert(1)', 'JavaScript://example.com', 'data:text/html,hi', 'file:///tmp/a',
    'ftp://example.com', 'mailto:a@example.com', 'https:example.com', 'http:/example.com',
    'https:///example.com', 'https://', 'https://user:pass@example.com', 'https://user@example.com',
    'https://@example.com', 'user:pass@example.com', 'https://exa\nmple.com',
    'https://example.com/a\tb', 'https://example.com/\u0000', 'https://example.com\\evil',
    'https://example..com', 'https://-bad.example', 'https://bad_.example', 'https://example.com:',
    'https://example.com:65536', 'https://256.1.1.1', 'https://[invalid]',
    'https://example.com/\uD800', 'https://example.com/\uDC00',
  ])('rejects unsafe or invalid input %j', (input) => {
    expect(() => normalizeUrl(input)).toThrow(AppError);
    expect(bookmarkInputSchema.safeParse({ url: input }).success).toBe(false);
  });

  it('keeps query escaping, duplicates, separators, empty delimiters and path case exact', () => {
    const value = 'https://example.com/A//b/%2f/?b=2&a=1&a=3&q=a%20b+c&v=%7e&empty=#';
    expect(normalizeUrl(value).normalizedUrl).toBe(value);
    expect(normalizeUrl('https://example.com/?').normalizedUrl).toBe('https://example.com/?');
    for (const [left, right] of [
      ['a?x=1&y=2', 'a?y=2&x=1'], ['A', 'a'], ['a', 'a/'],
      ['a#first', 'a#second'], ['?q=a+b', '?q=a%20b'], ['?utm_source=x', ''],
    ]) {
      expect(normalizeUrl(`https://example.com/${left}`).normalizedUrl)
        .not.toBe(normalizeUrl(`https://example.com/${right}`).normalizedUrl);
    }
  });

  it('checks both stored input and percent-encoded lengths at the boundary', () => {
    const prefix = 'https://example.com/';
    const boundary = prefix + 'a'.repeat(8_192 - prefix.length);
    expect(normalizeUrl(boundary).normalizedUrl).toBe(boundary);
    expect(() => normalizeUrl(boundary + 'a')).toThrow(AppError);
    const expanded = prefix + '😀'.repeat(700);
    expect(Array.from(expanded).length).toBeLessThan(8_192);
    expect(() => normalizeUrl(expanded)).toThrow('规范化后');
    // URL collapses these dot segments, but the stored input must still fit the limit.
    expect(() => normalizeUrl(prefix + 'a/../'.repeat(1_640))).toThrow('8192');
    const unicodeBoundary = prefix + '😀'.repeat(680) + 'a'.repeat(12);
    expect(normalizeUrl(unicodeBoundary).normalizedUrl.length).toBe(8_192);
    expect(() => normalizeUrl(unicodeBoundary + 'a')).toThrow('规范化后');
  });
});

describe('Unicode keys and field limits', () => {
  it.each([
    ['Straße', 'STRASSE'], ['ΟΣ', 'ος'], ['ẞ', 'ss'], ['ﬃ', 'FFI'],
    ['École', 'E\u0301COLE'], ['𐐀', '𐐨'],
  ])('case folds %s and %s with the fixed Unicode package', (left, right) => {
    expect(nameKey(` ${left} `)).toBe(nameKey(right));
    expect(searchKey(left)).toBe(searchKey(right));
  });

  it('is locale-independent and preserves meaningful accents, width and whitespace', () => {
    expect(nameKey('İ')).toBe('i\u0307');
    expect(nameKey('ı')).not.toBe(nameKey('I'));
    expect(nameKey('café')).not.toBe(nameKey('cafe'));
    expect(nameKey('Ａ')).not.toBe(nameKey('A'));
    expect(searchKey('  STRASSE\n工具  ')).toBe('  strasse\n工具  ');
  });

  it.each(['\uD800', '\uDC00', 'valid\uD800text', '\uDC00\uD800'])('rejects malformed Unicode %j in every text surface', (value) => {
    expect(() => nameKey(value)).toThrow(AppError);
    expect(() => searchKey(value)).toThrow(AppError);
    expect(nameInputSchema.safeParse({ operationId, name: value }).success).toBe(false);
    for (const field of ['title', 'note']) {
      expect(bookmarkInputSchema.safeParse({ url: 'example.com', [field]: value }).success).toBe(false);
    }
  });

  it('counts astral characters as one code point and leaves note whitespace untouched', () => {
    const input = { url: 'example.com', title: `  ${'😀'.repeat(200)}  `, note: '😀'.repeat(2_000) };
    expect(bookmarkInputSchema.parse(input).title).toBe('😀'.repeat(200));
    expect(bookmarkInputSchema.safeParse({ ...input, title: '😀'.repeat(201) }).success).toBe(false);
    expect(bookmarkInputSchema.safeParse({ ...input, note: '😀'.repeat(2_001) }).success).toBe(false);
    expect(nameInputSchema.parse({ operationId, name: ` ${'😀'.repeat(40)} ` }).name).toBe('😀'.repeat(40));
    expect(nameInputSchema.safeParse({ operationId, name: '😀'.repeat(41) }).success).toBe(false);
    expect(nameInputSchema.safeParse({ operationId, name: ' \n ' }).success).toBe(false);
    expect(bookmarkInputSchema.parse({ url: 'example.com', note: ' \n note \n ' }).note).toBe(' \n note \n ');
  });
});

describe('API schemas', () => {
  it('provides DTO-compatible defaults, leaving the empty title for the backend', () => {
    expect(createBookmarkSchema.parse({ operationId, url: ' example.com ', title: '  ' })).toEqual({
      operationId, url: 'https://example.com', title: '', note: '', groupId: null,
      tagIds: [], pinned: false, icon: { type: 'auto', key: null },
    });
    const first = bookmarkInputSchema.parse({ url: 'example.com' });
    first.tagIds.push('tag-1');
    first.icon.key = 'changed';
    expect(bookmarkInputSchema.parse({ url: 'example.com' }).tagIds).toEqual([]);
    expect(bookmarkInputSchema.parse({ url: 'example.com' }).icon.key).toBeNull();
    expect(layoutSaveSchema.parse({ operationId, baseRevision: 0 })).toEqual({
      operationId, baseRevision: 0, operations: [], preferences: DEFAULT_PREFERENCES,
    });
    expect(updateBookmarkSchema.parse({ operationId, version: 1, url: 'example.com' }).version).toBe(1);
  });

  it('infers exactly the existing public output types', () => {
    expectTypeOf<z.output<typeof bookmarkInputSchema>>().toEqualTypeOf<BookmarkInput>();
    expectTypeOf<z.output<typeof createBookmarkSchema>>().toEqualTypeOf<CreateBookmarkInput>();
    expectTypeOf<z.output<typeof updateBookmarkSchema>>().toEqualTypeOf<UpdateBookmarkInput>();
    expectTypeOf<z.output<typeof versionInputSchema>>().toEqualTypeOf<VersionInput>();
    expectTypeOf<z.output<typeof nameInputSchema>>().toEqualTypeOf<NameInput>();
    expectTypeOf<z.output<typeof batchInputSchema>>().toEqualTypeOf<BatchInput>();
    expectTypeOf<z.output<typeof layoutSaveSchema>>().toEqualTypeOf<LayoutSaveInput>();
  });

  it.each([0, -1, 1.5, '1', Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid version %s', (version) => {
    expect(versionInputSchema.safeParse({ operationId, version }).success).toBe(false);
    expect(nameInputSchema.safeParse({ operationId, name: 'name', version }).success).toBe(false);
    expect(updateBookmarkSchema.safeParse({ operationId, url: 'example.com', version }).success).toBe(false);
  });

  it('requires a UUID operation ID and a version for updates/deletes', () => {
    expect(createBookmarkSchema.safeParse({ operationId: 'op-1', url: 'example.com' }).success).toBe(false);
    expect(createBookmarkSchema.safeParse({ url: 'example.com' }).success).toBe(false);
    expect(versionInputSchema.safeParse({ operationId }).success).toBe(false);
    expect(updateBookmarkSchema.safeParse({ operationId, url: 'example.com' }).success).toBe(false);
    expect(nameInputSchema.parse({ operationId, name: '  Group  ' }).name).toBe('Group');
  });

  it('enforces unique tags and the 20-tag boundary', () => {
    const tagIds = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    expect(bookmarkInputSchema.parse({ url: 'example.com', tagIds }).tagIds).toEqual(tagIds);
    expect(bookmarkInputSchema.safeParse({ url: 'example.com', tagIds: [...tagIds, 'extra'] }).success).toBe(false);
    expect(bookmarkInputSchema.safeParse({ url: 'example.com', tagIds: ['same', 'same'] }).success).toBe(false);
    expect(bookmarkInputSchema.safeParse({ url: 'example.com', groupId: '' }).success).toBe(false);
  });

  it('validates icon choices and booleans without coercion', () => {
    expect(bookmarkInputSchema.parse({ url: 'example.com', icon: { type: 'builtin', key: 'globe' } }).icon.key).toBe('globe');
    for (const icon of [
      { type: 'builtin', key: null }, { type: 'builtin', key: '' },
      { type: 'builtin', key: 'a'.repeat(129) }, { type: 'builtin', key: '😀' },
      { type: 'auto', key: 'globe' }, { type: 'remote', key: null },
    ]) expect(bookmarkInputSchema.safeParse({ url: 'example.com', icon }).success).toBe(false);
    expect(bookmarkInputSchema.safeParse({ url: 'example.com', pinned: 'false' }).success).toBe(false);
  });

  it('validates required batch payloads, duplicate IDs, and per-item versions', () => {
    const base = { operationId, items: [{ id: 'bookmark-1', version: 1 }] };
    for (const action of ['trash', 'restore', 'delete']) expect(batchInputSchema.safeParse({ ...base, action }).success).toBe(true);
    expect(batchInputSchema.safeParse({ ...base, action: 'move' }).success).toBe(false);
    expect(batchInputSchema.parse({ ...base, action: 'move', groupId: null }).groupId).toBeNull();
    for (const action of ['addTags', 'removeTags']) {
      expect(batchInputSchema.safeParse({ ...base, action }).success).toBe(false);
      expect(batchInputSchema.safeParse({ ...base, action, tagIds: [] }).success).toBe(false);
      expect(batchInputSchema.safeParse({ ...base, action, tagIds: ['tag-1'] }).success).toBe(true);
    }
    expect(batchInputSchema.safeParse({ ...base, action: 'trash', items: [] }).success).toBe(false);
    expect(batchInputSchema.safeParse({ ...base, action: 'trash', items: [...base.items, ...base.items] }).success).toBe(false);
    expect(batchInputSchema.safeParse({ ...base, action: 'trash', items: [{ id: 'a', version: 0 }] }).success).toBe(false);
  });

  it('bounds batch items and layout actions, while allowing repeated moves', () => {
    const items = Array.from({ length: MAX_BATCH_ITEMS }, (_, i) => ({ id: `b-${i}`, version: 1 }));
    expect(batchInputSchema.safeParse({ operationId, action: 'trash', items }).success).toBe(true);
    expect(batchInputSchema.safeParse({ operationId, action: 'trash', items: [...items, { id: 'extra', version: 1 }] }).success).toBe(false);
    const operation = { type: 'bookmark', id: 'a', groupId: null, placement: { edge: 'end' } };
    const operations = Array.from({ length: MAX_LAYOUT_OPERATIONS }, () => operation);
    expect(layoutSaveSchema.safeParse({ operationId, baseRevision: 0, operations }).success).toBe(true);
    expect(layoutSaveSchema.safeParse({ operationId, baseRevision: 0, operations: [...operations, operation] }).success).toBe(false);
  });

  it('accepts every supported preference and rejects unsupported or ambiguous layouts', () => {
    const base = { operationId, baseRevision: 0 };
    for (const desktopColumns of ['auto', 4, 5, 6]) {
      for (const mobileColumns of ['auto', 2, 3]) {
        expect(layoutSaveSchema.safeParse({ ...base, preferences: { desktopColumns, mobileColumns, density: 'compact' } }).success).toBe(true);
      }
    }
    for (const preferences of [
      { desktopColumns: 3 }, { desktopColumns: '4' }, { mobileColumns: 4 },
      { density: 'dense' }, { autoIcons: 'false' }, { collapsedGroupIds: ['g', 'g'] },
    ]) expect(layoutSaveSchema.safeParse({ ...base, preferences }).success).toBe(false);
    for (const placement of [{}, { edge: 'middle' }, { beforeId: 'b', afterId: 'c' }, { edge: 'end', beforeId: 'b' }]) {
      expect(layoutSaveSchema.safeParse({ ...base, operations: [{ type: 'group', id: 'g', placement }] }).success).toBe(false);
    }
    expect(layoutSaveSchema.safeParse({ ...base, baseRevision: -1 }).success).toBe(false);
    expect(layoutSaveSchema.safeParse({ ...base, reset: true }).success).toBe(true);
    expect(layoutSaveSchema.safeParse({ ...base, reset: true, operations: [{ type: 'group', id: 'g', placement: { edge: 'end' } }] }).success).toBe(false);
  });
});
