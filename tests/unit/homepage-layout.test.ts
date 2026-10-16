import { describe, expect, it } from 'vitest';
import { defaultHomepageProfile, clampTile, placeHomepageTile, reconcileHomepageProfile, reorderLoadedPins, tilesOverlap } from '@luypage/domain';
import { homepageLayoutSaveSchema, type HomepageLayoutProfile } from '@luypage/contracts';

function noOverlap(profile: HomepageLayoutProfile) {
  for (let i = 0; i < profile.items.length; i++) for (let j = i + 1; j < profile.items.length; j++) expect(tilesOverlap(profile.items[i]!, profile.items[j]!)).toBe(false);
}
describe('homepage grid', () => {
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
  it('rejects invalid sizes, duplicate identifiers and mobile overflow', () => {
    const profile = defaultHomepageProfile('mobile', [], []);
    for (const item of [{ ...profile.items[0]!, w: 5 }, { ...profile.items[0]!, h: 0 }, { ...profile.items[0]!, id: 'foreign' }]) {
      expect(homepageLayoutSaveSchema.safeParse({ operationId: crypto.randomUUID(), baseRevision: 0, device: 'mobile', profile: { ...profile, items: [item, ...profile.items.slice(1)] } }).success).toBe(false);
    }
  });
});
