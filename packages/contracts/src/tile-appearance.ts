import { z } from 'zod';

export const tileStyleSchema = z.strictObject({
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/, '请选择有效的背景颜色'),
  transparency: z.number().int().min(0).max(100),
  radius: z.number().int().min(0).max(40),
});
export type TileStyle = z.infer<typeof tileStyleSchema>;
export const DEFAULT_TILE_STYLE: TileStyle = { background: '#16211b', transparency: 35, radius: 22 };
export const tileAppearanceSchema = z.strictObject({
  defaults: tileStyleSchema.nullable(),
  overrides: z.record(z.string().regex(/^(search|clock|calendar|weather|favorites|ungrouped|folder:[A-Za-z0-9_-]{1,36})$/), tileStyleSchema)
    .refine(value => Object.keys(value).length <= 5006, '自定义磁贴数量超过限制'),
});
export type TileAppearance = z.infer<typeof tileAppearanceSchema>;
export const DEFAULT_TILE_APPEARANCE: TileAppearance = { defaults: null, overrides: {} };
