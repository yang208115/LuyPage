import { z } from 'zod';
import { idSchema } from './validation';

export type HomepageDevice = 'desktop' | 'mobile';
export interface HomepageTile { id: string; x: number; y: number; w: number; h: number }
export interface HomepageLayoutProfile { items: HomepageTile[]; pinnedOrder: string[] }
export interface HomepageLayout { version: 1; desktop: HomepageLayoutProfile | null; mobile: HomepageLayoutProfile | null }
export const DEFAULT_HOMEPAGE_LAYOUT: HomepageLayout = { version: 1, desktop: null, mobile: null };
export const homepageColumns = (device: HomepageDevice) => device === 'mobile' ? 4 : 12;
export function homepageTileMinimum(id: string, device: HomepageDevice) {
  const mobile = device === 'mobile';
  return { w: id === 'search' ? (mobile ? 4 : 6) : id === 'favorites' ? 4 : id === 'clock' ? (mobile ? 4 : 5) : id === 'calendar' ? (mobile ? 2 : 4) : mobile ? 2 : 3,
    h: id === 'search' ? 1 : id === 'favorites' ? 4 : 3 };
}
export const homepageLayoutProfileSchema = z.strictObject({
  items: z.array(z.strictObject({
    id: z.string().regex(/^(search|clock|calendar|favorites|ungrouped|folder:[A-Za-z0-9_-]{1,36})$/),
    x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(100_000),
    w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(20),
  })).max(5005).refine(items => new Set(items.map(item => item.id)).size === items.length, '组件不能重复'),
  pinnedOrder: z.array(idSchema).max(50_000).refine(ids => new Set(ids).size === ids.length, '常用网站不能重复'),
});
export const homepageLayoutSchema = z.strictObject({ version: z.literal(1), desktop: homepageLayoutProfileSchema.nullable(), mobile: homepageLayoutProfileSchema.nullable() });
export const homepageLayoutSaveSchema = z.strictObject({
  operationId: z.uuid(), baseRevision: z.number().int().nonnegative(), device: z.enum(['desktop', 'mobile']), profile: homepageLayoutProfileSchema,
}).superRefine(({ device, profile }, context) => {
  const columns = homepageColumns(device);
  for (const item of profile.items) {
    const min = homepageTileMinimum(item.id, device);
    if (item.x + item.w > columns || item.w < min.w || item.h < min.h) context.addIssue({ code: 'custom', message: '组件超出网格边界或小于最小尺寸' });
  }
});
export type HomepageLayoutSaveInput = z.infer<typeof homepageLayoutSaveSchema>;
