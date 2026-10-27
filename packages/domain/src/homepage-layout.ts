import { MAX_HOMEPAGE_PIN_SLOT, MAX_SHORTCUT_ICON_SIZE, MIN_SHORTCUT_ICON_SIZE, homepageColumns, homepageTileMinimum, type HomepageDevice, type HomepageLayoutProfile, type HomepageTile } from '@luypage/contracts';

export const tilesOverlap = (a: HomepageTile, b: HomepageTile) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export function clampTile(tile: HomepageTile, device: HomepageDevice): HomepageTile {
  const columns = homepageColumns(device); const min = homepageTileMinimum(tile.id, device);
  const w = Math.max(min.w, Math.min(columns, Math.round(tile.w)));
  return { ...tile, w, h: Math.max(min.h, Math.min(20, Math.round(tile.h))), x: Math.max(0, Math.min(columns - w, Math.round(tile.x))), y: Math.max(0, Math.min(100_000, Math.round(tile.y))) };
}

// The moved tile has priority. Remaining tiles retain their horizontal position and
// original reading order, moving down only when needed; intentional gaps survive.
export function placeHomepageTile(profile: HomepageLayoutProfile, tile: HomepageTile, device: HomepageDevice): HomepageLayoutProfile {
  const placed = [clampTile(tile, device)];
  const others = profile.items.filter(item => item.id !== tile.id).map(item => clampTile(item, device)).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (const item of others) {
    let collisions = placed.filter(other => tilesOverlap(item, other));
    while (collisions.length) { item.y = Math.max(...collisions.map(other => other.y + other.h)); collisions = placed.filter(other => tilesOverlap(item, other)); }
    placed.push(item);
  }
  const byId = new Map(placed.map(item => [item.id, item]));
  return { ...profile, items: profile.items.map(item => byId.get(item.id)!) };
}
export function defaultHomepageProfile(device: HomepageDevice, folderIds: string[], pinnedIds: string[]): HomepageLayoutProfile {
  const columns = homepageColumns(device);
  const items: HomepageTile[] = [{ id: 'search', x: device === 'desktop' ? 3 : 0, y: 0, w: device === 'desktop' ? 6 : 4, h: 1 }];
  let x = 0; let y = 2;
  for (const id of ['clock', 'calendar', 'weather', ...folderIds]) {
    const min = homepageTileMinimum(id, device);
    if (x + min.w > columns) { x = 0; y += 3; }
    items.push({ id, x, y, ...min }); x += min.w;
  }
  items.push({ id: 'favorites', x: 0, y: y + 4, w: columns, h: 5 });
  return { items, pinnedOrder: [...pinnedIds], pinnedSlots: pinnedIds.map((_, index) => index), pinnedSizes: {} };
}
export function reconcileHomepageProfile(profile: HomepageLayoutProfile | null, device: HomepageDevice, folderIds: string[], pinnedIds: string[]): HomepageLayoutProfile {
  if (!profile) return defaultHomepageProfile(device, folderIds, pinnedIds);
  const valid = new Set(['search', 'clock', 'calendar', 'weather', 'favorites', ...folderIds, 'ungrouped']);
  const next: HomepageLayoutProfile = { items: profile.items.filter(item => valid.has(item.id)).map(item => clampTile(item, device)), pinnedOrder: mergePinnedOrder(profile.pinnedOrder, pinnedIds) };
  const pinned = new Set(next.pinnedOrder);
  next.pinnedSizes = Object.fromEntries(Object.entries(profile.pinnedSizes ?? {}).filter(([id]) => pinned.has(id)));
  const slots = homepagePinSlots(profile);
  let last = Math.max(-1, ...slots.values());
  const used = new Set(slots.values());
  let free = 0;
  next.pinnedSlots = next.pinnedOrder.map(id => {
    const saved = slots.get(id);
    if (saved !== undefined) return saved;
    if (last < MAX_HOMEPAGE_PIN_SLOT) { used.add(++last); return last; }
    while (used.has(free)) free++;
    used.add(free); return free;
  });
  sortHomepagePins(next);
  const defaults = defaultHomepageProfile(device, folderIds, pinnedIds);
  for (const item of defaults.items) {
    if (next.items.some(existing => existing.id === item.id)) continue;
    if (item.id === 'weather') {
      next.items.push({ ...item });
      next.items = placeHomepageTile(next, item, device).items;
      continue;
    }
    const added = { ...item, x: 0, y: Math.max(0, ...next.items.map(existing => existing.y + existing.h)) };
    next.items.push(added);
  }
  // Reconcile stored layouts after visibility/membership changes without overwriting positions.
  const settled: HomepageTile[] = [];
  for (const item of [...next.items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let collisions = settled.filter(other => tilesOverlap(item, other));
    while (collisions.length) { item.y = Math.max(...collisions.map(other => other.y + other.h)); collisions = settled.filter(other => tilesOverlap(item, other)); }
    settled.push(item);
  }
  return next;
}
export function mergePinnedOrder(order: string[], validIds: string[]): string[] {
  const valid = new Set(validIds); const kept = order.filter(id => valid.has(id)); const seen = new Set(kept);
  return [...kept, ...validIds.filter(id => !seen.has(id))];
}
export function reorderLoadedPins(order: string[], loadedIds: string[], active: string, over: string): string[] {
  const loaded = new Set(loadedIds); const visible = order.filter(id => loaded.has(id));
  const from = visible.indexOf(active); const to = visible.indexOf(over);
  if (from < 0 || to < 0) return order;
  visible.splice(to, 0, ...visible.splice(from, 1));
  let cursor = 0;
  return order.map(id => loaded.has(id) ? visible[cursor++]! : id);
}

// Slots are compact row-major cell indices. Keeping gaps makes responsive wrapping
// deterministic without storing a second copy of every bookmark ID.
export function homepagePinSlots(profile: HomepageLayoutProfile): Map<string, number> {
  return new Map(profile.pinnedOrder.map((id, index) => [id, profile.pinnedSlots?.[index] ?? index]));
}
function sortHomepagePins(profile: HomepageLayoutProfile): void {
  const entries = [...homepagePinSlots(profile)].sort((a, b) => a[1] - b[1]);
  profile.pinnedOrder = entries.map(([id]) => id);
  profile.pinnedSlots = entries.map(([, slot]) => slot);
}
export function placeHomepagePin(profile: HomepageLayoutProfile, id: string, target: number): HomepageLayoutProfile {
  const slots = homepagePinSlots(profile);
  const previous = slots.get(id);
  if (previous === undefined || !Number.isFinite(target)) return profile;
  const slot = Math.max(0, Math.min(MAX_HOMEPAGE_PIN_SLOT, Math.round(target)));
  if (slot === previous) return profile;
  const occupied = [...slots].find(([otherId, position]) => otherId !== id && position === slot);
  if (occupied) slots.set(occupied[0], previous);
  slots.set(id, slot);
  const entries = [...slots].sort((a, b) => a[1] - b[1]);
  return { ...profile, pinnedOrder: entries.map(([key]) => key), pinnedSlots: entries.map(([, position]) => position) };
}

export function resizeHomepagePin(profile: HomepageLayoutProfile, id: string, size: number): HomepageLayoutProfile {
  if (!profile.pinnedOrder.includes(id) || !Number.isFinite(size)) return profile;
  const next = Math.max(MIN_SHORTCUT_ICON_SIZE, Math.min(MAX_SHORTCUT_ICON_SIZE, Math.round(size)));
  if (profile.pinnedSizes?.[id] === next) return profile;
  return { ...profile, pinnedSizes: { ...profile.pinnedSizes, [id]: next } };
}
