import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type Homepage, type HomepageDevice, type HomepageLayout, type HomepageLayoutProfile, type HomepageLayoutSaveInput, type MutationResult } from '@luypage/contracts';
import { defaultHomepageProfile, reconcileHomepageProfile } from '@luypage/domain';
import { useSession } from './session';
import { ApiError } from './api';
import { useBeforeUnload } from './ui';

const fingerprint = (profile: HomepageLayoutProfile) => JSON.stringify(profile);
const folderIds = (home: Homepage) => home.folders.filter(folder => folder.id !== null || folder.count > 0).map(folder => folder.id === null ? 'ungrouped' : `folder:${folder.id}`);
const profileOf = (home: Homepage, device: HomepageDevice) => reconcileHomepageProfile(home.layout?.[device] ?? null, device, folderIds(home), home.pinnedIds ?? []);
interface Editing { device: HomepageDevice; profile: HomepageLayoutProfile; revision: number; saved: string; history: HomepageLayoutProfile[] }
export function useHomepageLayout(home: Homepage | undefined, guard: RefObject<() => boolean>, settingsOpen: boolean) {
  const { send, session } = useSession(); const client = useQueryClient();
  const [device, setDevice] = useState<HomepageDevice>(() => window.matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop');
  const [editing, setEditing] = useState<Editing | null>(null); const current = useRef(editing); current.current = editing;
  const [saving, setSaving] = useState(false); const inFlight = useRef(false);
  const [error, setError] = useState<Error | null>(null); const [retry, setRetry] = useState(0);
  const attempt = useRef<HomepageLayoutSaveInput | null>(null); const alive = useRef(true);
  const dirty = !!editing && fingerprint(editing.profile) !== editing.saved;
  useBeforeUnload(dirty || saving || !!attempt.current);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setDevice(media.matches ? 'mobile' : 'desktop');
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  function begin(nextDevice = device, latest = home) {
    if (!latest) return;
    const profile = profileOf(latest, nextDevice);
    attempt.current = null; setError(null);
    setEditing({ device: nextDevice, profile, revision: latest.revision, saved: fingerprint(profile), history: [] });
  }
  function leave() {
    if (inFlight.current) return false;
    const state = current.current;
    if (state && (fingerprint(state.profile) !== state.saved || attempt.current) && !window.confirm('布局尚未保存，离开将放弃未保存的调整，是否继续？')) return false;
    attempt.current = null; setError(null); setEditing(null); return true;
  }
  useEffect(() => {
    if (settingsOpen || !editing) return;
    guard.current = leave;
    return () => { if (guard.current === leave) guard.current = () => true; };
  });
  useEffect(() => {
    if (editing && device !== editing.device && !dirty && !saving && !error) begin(device);
  }, [device, editing, dirty, saving, error]);
  useEffect(() => {
    if (!editing || (!dirty && !attempt.current) || saving || error) return;
    const timer = window.setTimeout(() => { void save(); }, 300);
    return () => window.clearTimeout(timer);
  }, [editing, dirty, saving, error, retry]);
  async function save() {
    const state = current.current;
    if (!state || inFlight.current) return;
    const input = attempt.current ?? { operationId: crypto.randomUUID(), baseRevision: state.revision, device: state.device, profile: structuredClone(state.profile) };
    attempt.current = input; inFlight.current = true; setSaving(true);
    try {
      const result = await send<MutationResult<HomepageLayout>>('/api/homepage/layout', { method: 'PUT', body: JSON.stringify(input) });
      if (!alive.current) return;
      attempt.current = null;
      client.setQueryData<Homepage>(['private', session.user.id, 'homepage'], previous => previous && ({ ...previous, layout: result.data, revision: result.revision }));
      setEditing(previous => previous && ({ ...previous, revision: result.revision, saved: fingerprint(input.profile) }));
      void client.invalidateQueries({ queryKey: ['private', session.user.id, 'bootstrap'] });
      void client.invalidateQueries({ queryKey: ['private', session.user.id, 'bookmarks'] });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause : new Error('布局保存失败。')); }
    finally { inFlight.current = false; if (alive.current) setSaving(false); }
  }
  const blocked = !!editing && device !== editing.device;
  function change(profile: HomepageLayoutProfile) {
    if (blocked || error) return;
    setEditing(previous => !previous || fingerprint(profile) === fingerprint(previous.profile) ? previous : ({ ...previous, profile, history: [...previous.history.slice(-19), previous.profile] }));
  }
  async function resolveConflict(keep: boolean) {
    if (inFlight.current) return;
    inFlight.current = true; setSaving(true);
    try {
      const latest = await send<Homepage>('/api/homepage');
      if (!alive.current) return;
      const state = current.current; if (!state) return;
      const saved = profileOf(latest, state.device);
      const profile = keep ? reconcileHomepageProfile(state.profile, state.device, folderIds(latest), latest.pinnedIds) : saved;
      client.setQueryData(['private', session.user.id, 'homepage'], latest);
      attempt.current = null; setError(null);
      setEditing({ ...state, profile, revision: latest.revision, saved: fingerprint(saved), history: [] });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause : new Error('无法读取最新布局。')); }
    finally { inFlight.current = false; if (alive.current) setSaving(false); }
  }
  const profile = editing?.profile ?? (home ? profileOf(home, device) : defaultHomepageProfile(device, [], []));
  return { editing: !!editing, device: editing?.device ?? device, profile, saving, dirty, error, blocked,
    conflict: error instanceof ApiError && error.status === 409,
    begin: () => begin(), finish: leave, change,
    retry: () => { setError(null); setRetry(value => value + 1); }, resolveConflict,
    canUndo: !!editing?.history.length && !error && !blocked,
    undo: () => setEditing(previous => !previous?.history.length ? previous : ({ ...previous, profile: previous.history.at(-1)!, history: previous.history.slice(0, -1) })),
    reset: () => { if (home && window.confirm('恢复当前设备的默认主页布局？收藏和壁纸不会改变。')) change(defaultHomepageProfile(editing?.device ?? device, folderIds(home), home.pinnedIds)); },
  };
}
