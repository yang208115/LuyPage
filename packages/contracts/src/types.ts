import { DEFAULT_TILE_APPEARANCE, type TileAppearance } from './tile-appearance';
import type { HomepageLayout, HomepageDevice } from './homepage-layout';
import type { WeatherLocation } from './weather';
export type Id = string;
export interface Session { user: { id: Id; displayName: string }; local: boolean; loginUrl: string; logoutUrl: string }
export interface IconChoice { type: 'auto' | 'builtin'; key: string | null }
export const WALLPAPER_IDS = ['sunset-fields', 'blue-lake', 'night-forest'] as const;
export const SEARCH_PROVIDERS = ['bing', 'baidu', 'google', 'bookmarks'] as const;
export const DEFAULT_SHORTCUT_ICON_SIZE = 62;
export const MIN_SHORTCUT_ICON_SIZE = 40;
export const MAX_SHORTCUT_ICON_SIZE = 128;
export interface HomepagePreferences {
  wallpaperId: typeof WALLPAPER_IDS[number];
  searchProvider: typeof SEARCH_PROVIDERS[number];
  showClock: boolean;
  showCalendar: boolean;
  showWeather: boolean;
  weatherLocation: WeatherLocation | null;
  shortcutIconSize: number;
  tileAppearance: TileAppearance;
}
export const DEFAULT_HOMEPAGE_PREFERENCES: HomepagePreferences = {
  wallpaperId: 'sunset-fields', searchProvider: 'bing', showClock: true, showCalendar: true, showWeather: true, weatherLocation: null, shortcutIconSize: DEFAULT_SHORTCUT_ICON_SIZE, tileAppearance: DEFAULT_TILE_APPEARANCE,
};
export interface HomepageShortcut { id: Id; title: string; url: string; icon: IconChoice }
export interface HomepageFolder { id: Id | null; name: string; count: number; preview: HomepageShortcut[] }
export interface Homepage {
  revision: number; layout: HomepageLayout; pinnedIds: Id[]; preferences: HomepagePreferences; counts: { active: number; pinned: number }; folders: HomepageFolder[];
}
export interface HomepageSaveInput { operationId: Id; baseRevision: number; preferences: Omit<HomepagePreferences, 'tileAppearance' | 'showWeather' | 'weatherLocation' | 'shortcutIconSize'> & Partial<Pick<HomepagePreferences, 'tileAppearance' | 'showWeather' | 'weatherLocation' | 'shortcutIconSize'>> }
export interface Bookmark {
  id: Id; url: string; title: string; note: string; groupId: Id | null; tagIds: Id[]; pinned: boolean;
  icon: IconChoice; createdAt: string; updatedAt: string; deletedAt: string | null; version: number;
}
export interface Group { id: Id; name: string; count: number; createdAt: string; version: number }
export interface Tag { id: Id; name: string; count: number; version: number }
export interface LayoutPreferences {
  desktopColumns: 'auto' | 4 | 5 | 6; mobileColumns: 'auto' | 2 | 3; density: 'comfortable' | 'compact';
  collapsedGroupIds: Id[]; autoIcons: boolean;
}
export const DEFAULT_PREFERENCES: LayoutPreferences = { desktopColumns: 'auto', mobileColumns: 'auto', density: 'comfortable', collapsedGroupIds: [], autoIcons: false };
export interface LayoutIndex {
  revision: number; groupOrder: Id[]; groups: { groupId: Id | null; bookmarkIds: Id[] }[]; pinnedOrder: Id[]; preferences: LayoutPreferences;
}
export type Placement = { edge: 'start' | 'end' } | { beforeId: Id } | { afterId: Id };
export type LayoutOperation =
  | { type: 'bookmark'; id: Id; groupId: Id | null; placement: Placement }
  | { type: 'group'; id: Id; placement: Placement }
  | { type: 'pinned'; id: Id; placement: Placement };
export interface LayoutSaveInput { operationId: Id; baseRevision: number; operations: LayoutOperation[]; preferences: LayoutPreferences; reset?: boolean }
export interface BookmarkInput { url: string; title: string; note: string; groupId: Id | null; tagIds: Id[]; pinned: boolean; icon: IconChoice }
export interface CreateBookmarkInput extends BookmarkInput { operationId: Id }
export interface UpdateBookmarkInput extends CreateBookmarkInput { version: number }
export interface VersionInput { operationId: Id; version: number }
export interface NameInput { operationId: Id; name: string; version?: number }
export type Sort = 'manual' | 'created' | 'updated' | 'title';
export interface BookmarkQuery { homepageDevice?: HomepageDevice; q?: string; groupId?: string; tagIds?: string[]; pinned?: boolean; sort?: Sort; cursor?: string; limit?: number }
export interface BookmarkPage { items: Bookmark[]; total: number; nextCursor: string | null; revision: number }
export interface Bootstrap {
  revision: number; groups: Group[]; tags: Tag[]; preferences: LayoutPreferences;
  counts: { active: number; trash: number; pinned: number; ungrouped: number };
  capabilities: { transfers: boolean; automaticIcons: boolean };
}
export type BatchAction = 'trash' | 'restore' | 'delete' | 'move' | 'addTags' | 'removeTags';
export interface BatchInput { operationId: Id; action: BatchAction; items: { id: Id; version: number }[]; groupId?: Id | null; tagIds?: Id[] }
export interface BatchResult { items: { id: Id; success: boolean; code?: string; message?: string }[]; succeeded: number; failed: number }
export interface ApiErrorBody { error: { code: string; message: string; requestId: string; details?: unknown } }
export interface MutationResult<T> { data: T; revision: number }
