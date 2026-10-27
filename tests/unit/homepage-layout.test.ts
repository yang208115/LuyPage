import { describe, expect, it } from 'vitest';
import { defaultHomepageProfile, clampTile, homepagePinSlots, placeHomepagePin, placeHomepageTile, reconcileHomepageProfile, reorderLoadedPins, resizeHomepagePin, tilesOverlap } from '@luypage/domain';
import { homepageLayoutSaveSchema, type HomepageLayoutProfile } from '@luypage/contracts';

function noOverlap(profile: HomepageLayoutProfile) {
  for (let i = 0; i < profile.items.length; i++) for (let j = i + 1; j < profile.items.length; j++) expect(tilesOverlap(profile.items[i]!, profile.items[j]!)).toBe(false);
}
describe('homepage grid', () => {
  it('sizes websites independently and keeps their sizes with their IDs through swaps and membership changes', () => {
    const original = defaultHomepageProfile('desktop', [], ['a', 'b', 'c']);
    const sized = resizeHomepagePin(resizeHomepagePin(original, 'a', 81.6), 'b', 110);
    expect(sized.pinnedSizes).toEqual({ a: 82, b: 110 });
    expect(original.pinnedSizes).toEqual({});
    expect(sized.pinnedSlots).toEqual(original.pinnedSlots);
    const swapped = placeHomepagePin(sized, 'a', 1);
    expect(swapped.pinnedOrder).toEqual(['b', 'a', 'c']);
    expect(swapped.pinnedSizes).toEqual({ a: 82, b: 110 });
    expect(reconcileHomepageProfile(swapped, 'desktop', [], ['b', 'c', 'new']).pinnedSizes).toEqual({ b: 110 });
    expect(resizeHomepagePin(sized, 'a', 82)).toBe(sized);
    expect(resizeHomepagePin(sized, 'missing', 80)).toBe(sized);
    expect(resizeHomepagePin(sized, 'a', NaN)).toBe(sized);
    expect(resizeHomepagePin(sized, 'a', 500).pinnedSizes?.a).toBe(128);
    expect(resizeHomepagePin(sized, 'a', -5).pinnedSizes?.a).toBe(40);
  });
  it('rejects invalid individual sizes and sizes for websites outside the profile', () => {
    const profile = defaultHomepageProfile('desktop', [], ['a']);
    for (const pinnedSizes of [{ a: 39 }, { a: 129 }, { a: 62.5 }, { a: '80' }, { foreign: 80 }]) {
      expect(homepageLayoutSaveSchema.safeParse({ operationId: crypto.randomUUID(), baseRevision: 0, device: 'desktop', profile: { ...profile, pinnedSizes } }).success).toBe(false);
    }
  });
  it.each(['desktop', 'mobile'] as const)('builds a valid %s layout with search above cards above favorites', device => {
    const profile = defaultHomepageProfile(device, ['folder:a', 'folder:b', 'ungrouped'], ['p1', 'p2']);
    noOverlap(profile);
    expect(homepageLayoutSaveSchema.safeParse({ operationId: crypto.randomUUID(), baseRevision: 0, device, profile }).success).toBe(true);
    expect(profile.items[0]!.id).toBe('search'); expect(profile.items.at(-1)!.id).toBe('favorites');
  });
  it('snaps, clamps and pushes collisions down without closing deliberate gaps', () => {
    const base = defaultHomepageProfile('desktop', ['folder:a'], []);
    const clock = base.items.find(item => item.id === 'clock')!;
    const moved = placeHomepageTile(base, { ...clock, x: 4.6, y: 2.2 }, 'desktop');
    expect(moved.items.find(item => item.id === 'clock')!.x).toBe(5); noOverlap(moved);
    expect(moved.items.find(item => item.id === 'calendar')!.y).toBeGreaterThan(2);
    const far = placeHomepageTile(moved, { ...clock, y: 25 }, 'desktop');
    expect(far.items.find(item => item.id === 'clock')!.y).toBe(25);
    expect(clampTile({ ...clock, w: 0, h: 0, x: -4, y: -4 }, 'mobile')).toMatchObject({ w: 4, h: 3, x: 0, y: 0 });
  });
  it('keeps dormant widgets, removes deleted folders, appends new members and prunes unpinned IDs', () => {
    const profile = defaultHomepageProfile('desktop', ['folder:old', 'ungrouped'], ['a', 'b']);
    const next = reconcileHomepageProfile(profile, 'desktop', ['folder:new'], ['b', 'c']);
    expect(next.items.some(item => item.id === 'folder:old')).toBe(false);
    expect(next.items.find(item => item.id === 'clock')).toEqual(profile.items.find(item => item.id === 'clock'));
    expect(next.items.some(item => item.id === 'ungrouped')).toBe(true);
    expect(next.items.some(item => item.id === 'folder:new')).toBe(true);
    expect(next.pinnedOrder).toEqual(['b', 'c']); noOverlap(next);
    expect(reconcileHomepageProfile(next, 'desktop', ['folder:new'], ['b', 'c'])).toEqual(next);
  });
  it('reorders loaded pins without moving unloaded slots', () => {
    expect(reorderLoadedPins(['a', 'hidden1', 'b', 'hidden2', 'c'], ['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'hidden1', 'a', 'hidden2', 'b']);
  });
  it('adds weather to older layouts without losing shortcut gaps or existing widget sizes', () => {
    const base = defaultHomepageProfile('desktop', ['folder:a'], ['a', 'b']);
    base.items = base.items.filter(item => item.id !== 'weather');
    base.pinnedSlots = [2, 16];
    const next = reconcileHomepageProfile(base, 'desktop', ['folder:a'], ['a', 'b']);
    expect(next.items.filter(item => item.id === 'weather')).toHaveLength(1);
    expect(next.pinnedSlots).toEqual([2, 16]);
    expect(next.items.find(item => item.id === 'clock')).toEqual(base.items.find(item => item.id === 'clock'));
    noOverlap(next);
    expect(reconcileHomepageProfile(next, 'desktop', ['folder:a'], ['a', 'b'])).toEqual(next);
  });
  it('moves a website into an empty cell without closing its original gap', () => {
    const base = defaultHomepageProfile('desktop', [], ['a', 'b', 'c']);
    const moved = placeHomepagePin(base, 'a', 15);
    expect([...homepagePinSlots(moved)]).toEqual([['b', 1], ['c', 2], ['a', 15]]);
    expect(base.pinnedOrder).toEqual(['a', 'b', 'c']);
    expect(base.pinnedSlots).toEqual([0, 1, 2]);
    expect(homepageLayoutSaveSchema.safeParse({ operationId: crypto.randomUUID(), baseRevision: 0, device: 'desktop', profile: moved }).success).toBe(true);
  });
  it('swaps occupied cells while preserving the positions of unloaded websites', () => {
    const base = defaultHomepageProfile('desktop', [], ['a', 'hidden', 'b', 'c']);
    const moved = placeHomepagePin(base, 'c', 0);
    expect([...homepagePinSlots(moved)]).toEqual([['c', 0], ['hidden', 1], ['b', 2], ['a', 3]]);
    expect(placeHomepagePin(moved, 'c', 0)).toBe(moved);
    expect(placeHomepagePin(moved, 'missing', 5)).toBe(moved);
    expect(placeHomepagePin(moved, 'a', NaN)).toBe(moved);
    expect(homepagePinSlots(placeHomepagePin(moved, 'a', -3)).get('a')).toBe(0);
  });
  it('preserves gaps through membership changes and appends new favorites after existing positions', () => {
    const base = { ...defaultHomepageProfile('desktop', [], ['a', 'b', 'c']), pinnedSlots: [1, 4, 7] };
    const next = reconcileHomepageProfile(base, 'desktop', [], ['a', 'c', 'new']);
    expect([...homepagePinSlots(next)]).toEqual([['a', 1], ['c', 7], ['new', 8]]);
    expect(reconcileHomepageProfile(next, 'desktop', [], ['a', 'c', 'new'])).toEqual(next);
  });
  it('upgrades legacy orders and rejects ambiguous, duplicate or out-of-range cell positions', () => {
    const { pinnedSlots: omitted, ...legacy } = defaultHomepageProfile('desktop', [], ['a', 'b']);
    expect([...homepagePinSlots(legacy)]).toEqual([['a', 0], ['b', 1]]);
    expect(reconcileHomepageProfile(legacy, 'desktop', [], ['a', 'b']).pinnedSlots).toEqual([0, 1]);
    for (const pinnedSlots of [[0], [0, 0], [2, 1], [-1, 3], [0, 100_001], [0, 1.5]]) {
      expect(homepageLayoutSaveSchema.safeParse({ operationId: crypto.randomUUID(), baseRevision: 0, device: 'desktop', profile: { ...legacy, pinnedSlots } }).success).toBe(false);
    }
  });
  it('rejects invalid sizes, duplicate identifiers and mobile overflow', () => {
    const profile = defaultHomepageProfile('mobile', [], []);
    for (const item of [{ ...profile.items[0]!, w: 5 }, { ...profile.items[0]!, h: 0 }, { ...profile.items[0]!, id: 'foreign' }]) {
      expect(homepageLayoutSaveSchema.safeParse({ operationId: crypto.randomUUID(), baseRevision: 0, device: 'mobile', profile: { ...profile, items: [item, ...profile.items.slice(1)] } }).success).toBe(false);
    }
  });
});
