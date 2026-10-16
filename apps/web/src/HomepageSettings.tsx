import { TileAppearanceSettings } from './TileAppearanceSettings';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Check, Monitor, Save } from 'lucide-react';
import type { Homepage, HomepagePreferences, MutationResult } from '@luypage/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, useCommand } from './api';
import { useSession } from './session';
import { ErrorNotice, Modal, useBeforeUnload } from './ui';
import { SEARCH_OPTIONS, WALLPAPERS } from './homepage-model';
import { addWallpaper, removeWallpaper, wallpaperDirty, wallpaperDraft, WallpaperError, type WallpaperDraft } from './wallpaper-model';
import { readWallpaperGallery, saveWallpaperGallery } from './wallpaper-storage';
import { prepareWallpaper } from './wallpaper-image';
import { WallpaperGallery } from './WallpaperGallery';

export interface HomepageDraft { preferences: HomepagePreferences; baseRevision: number; local: WallpaperDraft | null }
export function HomepageSettings({ draft, onChange, onClose, onSaved, onAccount, navigationGuard, appearanceTargets }: {
  appearanceTargets: { id: string; label: string }[];
  draft: HomepageDraft; onChange: (draft: HomepageDraft) => void; onClose: () => void;
  onSaved: () => void; onAccount: () => void; navigationGuard: RefObject<() => boolean>;
}) {
  const { session, send, expired, verify } = useSession();
  const command = useCommand(send);
  const client = useQueryClient();
  const initial = useRef(JSON.stringify(draft.preferences));
  const savedBuiltin = useRef(draft.preferences.wallpaperId);
  const current = useRef(draft); current.current = draft;
  const live = useRef(true);
  const galleryLoad = useRef(0);
  const inFlight = useRef(false);
  const accountDirty = initial.current !== JSON.stringify(draft.preferences);
  const dirty = accountDirty || wallpaperDirty(draft.local);
  const [latest, setLatest] = useState<Homepage | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<Error | null>(null);
  const [localReading, setLocalReading] = useState(true);
  const [localError, setLocalError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [partialSave, setPartialSave] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const busy = saving || reading || localReading || importing;
  useBeforeUnload(dirty);
  function change(next: HomepageDraft) { current.current = next; onChange(next); }
  function mayLeave() { return !busy && (!dirty || window.confirm('放弃尚未保存的主页设置？')); }
  useEffect(() => {
    navigationGuard.current = mayLeave;
    return () => { navigationGuard.current = () => true; };
  });
  useEffect(() => {
    live.current = true;
    void loadGallery();
    return () => { live.current = false; galleryLoad.current += 1; };
  }, [session.user.id]);
  async function loadGallery() {
    const generation = ++galleryLoad.current;
    setLocalReading(true); setLocalError(null);
    try {
      const gallery = await readWallpaperGallery(session.user.id);
      if (!live.current || generation !== galleryLoad.current) return;
      change({ ...current.current, local: wallpaperDraft(gallery) });
      setImportErrors([]); setSaveError(null);
    } catch (cause) { if (live.current && generation === galleryLoad.current) setLocalError(cause instanceof Error ? cause : new Error('无法读取本地图库。')); }
    finally { if (live.current && generation === galleryLoad.current) setLocalReading(false); }
  }
  function update(patch: Partial<HomepagePreferences>) { change({ ...current.current, preferences: { ...current.current.preferences, ...patch } }); }
  async function importImages(files: File[]) {
    if (!current.current.local || inFlight.current) return;
    inFlight.current = true; setImporting(true); setImportErrors([]);
    const errors: string[] = [];
    try {
      for (const file of files) {
        if (!live.current) return;
        try {
          const image = await prepareWallpaper(file, session.user.id);
          if (!live.current) return;
          change({ ...current.current, local: addWallpaper(current.current.local!, image) });
        } catch (cause) { errors.push(`${file.name}：${cause instanceof Error ? cause.message : '图片导入失败。'}`); }
      }
    } finally {
      inFlight.current = false;
      if (live.current) { setImportErrors(errors); setImporting(false); }
    }
  }
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true; setSaving(true); setSaveError(null);
    try {
      const identity = await verify();
      if (!live.current || identity.user.id !== session.user.id) return;
      let next = current.current;
      if (initial.current !== JSON.stringify(next.preferences)) {
        // Only the public account fields belong in this request, never local IDs or Blobs.
        const result = await command.execute<MutationResult<HomepagePreferences>>('/api/homepage/preferences', 'PUT', {
          baseRevision: next.baseRevision, preferences: next.preferences,
        });
        if (!live.current) return;
        initial.current = JSON.stringify(result.data); savedBuiltin.current = result.data.wallpaperId;
        next = { ...next, preferences: result.data, baseRevision: result.revision };
        change(next);
        client.setQueryData<Homepage>(['private', session.user.id, 'homepage'], previous => previous && ({ ...previous, preferences: result.data, revision: result.revision }));
        void client.invalidateQueries({ queryKey: ['private', session.user.id] });
        setPartialSave(wallpaperDirty(next.local));
      }
      if (wallpaperDirty(next.local)) {
        const saved = await saveWallpaperGallery(next.local!);
        if (!live.current) return;
        change({ ...next, local: wallpaperDraft(saved) });
      }
      if (live.current) onSaved();
    } catch (cause) { if (live.current) setSaveError(cause instanceof Error ? cause : new Error('主页设置未保存，请重试。')); }
    finally { inFlight.current = false; if (live.current) setSaving(false); }
  }
  async function readLatest() {
    setReading(true); setReadError(null);
    try {
      const latestHome = await send<Homepage>('/api/homepage');
      if (!live.current) return;
      setLatest(latestHome);
      client.setQueryData(['private', session.user.id, 'homepage'], latestHome);
    }
    catch (cause) { if (live.current) setReadError(cause instanceof Error ? cause : new Error('无法读取最新设置。')); }
    finally { if (live.current) setReading(false); }
  }
  return <Modal title="让主页更像你" subtitle="内置壁纸与主页偏好随账号同步，自定义图片仅保存在当前浏览器。" onClose={() => { if (mayLeave()) onClose(); }} wide className="homepage-settings">
    <fieldset disabled={busy}>
      <section className="home-settings-section"><h3>窗外的风景</h3><div className="wallpaper-options">
        {WALLPAPERS.map(wallpaper => {
          const selected = !draft.local?.selectedId && draft.preferences.wallpaperId === wallpaper.id;
          return <button key={wallpaper.id} className={`wallpaper-option ${selected ? 'chosen' : ''}`} aria-pressed={selected} disabled={!draft.local} onClick={() => change({ ...current.current,
            preferences: { ...current.current.preferences, wallpaperId: wallpaper.id }, local: { ...current.current.local!, selectedId: null },
          })}>
            <img src={`/wallpapers/${wallpaper.id}-thumb.webp`} alt="" width="240" height="135" />
            <span>{wallpaper.name}{selected && <Check size={15} />}</span>
          </button>;
        })}
      </div></section>
      <WallpaperGallery draft={draft.local} importing={importing} errors={importErrors} onImport={files => void importImages(files)} onSelect={id => change({ ...current.current, local: { ...current.current.local!, selectedId: id } })} onDelete={id => {
        const local = current.current.local!;
        change({ ...current.current, local: removeWallpaper(local, id), preferences: local.selectedId === id ? { ...current.current.preferences, wallpaperId: savedBuiltin.current } : current.current.preferences });
      }} />
      <label className="field"><span>默认搜索方式</span><select aria-label="默认搜索方式" value={draft.preferences.searchProvider} onChange={event => update({ searchProvider: event.target.value as HomepagePreferences['searchProvider'] })}>{SEARCH_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      <TileAppearanceSettings value={draft.preferences.tileAppearance} targets={appearanceTargets} onChange={tileAppearance => update({ tileAppearance })} />
      <section className="home-settings-section"><h3>主页组件</h3><label className="home-toggle"><span>时钟<small>此刻的时间与一句问候</small></span><input type="checkbox" checked={draft.preferences.showClock} onChange={event => update({ showClock: event.target.checked })} /></label><label className="home-toggle"><span>日历<small>看看今天，也安排下一天</small></span><input type="checkbox" checked={draft.preferences.showCalendar} onChange={event => update({ showCalendar: event.target.checked })} /></label></section>
    </fieldset>
    {localReading && <p role="status">正在读取本地图库…</p>}
    <ErrorNotice error={localError} retry={() => void loadGallery()} />
    <p className="form-hint"><Monitor size={14} /> 当前正在预览，取消后恢复已保存的主页。</p>
    {partialSave && saveError && <p className="notice warning" role="status">账号设置已保存，本地背景未保存。重试只保存尚未完成的更改；取消不会撤销已保存的账号设置。</p>}
    <ErrorNotice error={saveError} />
    {saveError instanceof WallpaperError && <button disabled={busy} onClick={() => {
      if (wallpaperDirty(current.current.local) && !window.confirm('重新载入本地图库？未保存的本地图片、选择和删除将被放弃，账号设置草稿会保留。')) return;
      void loadGallery();
    }}>重新载入本地图库</button>}
    {command.error instanceof ApiError && command.error.status === 409 && <button disabled={busy} onClick={() => void readLatest()}>{reading ? '正在读取…' : '读取最新设置'}</button>}
    <ErrorNotice error={readError} retry={() => void readLatest()} />
    {latest && <section className="home-settings-comparison"><strong>账号中的最新设置</strong><p>{WALLPAPERS.find(item => item.id === latest.preferences.wallpaperId)?.name} · {SEARCH_OPTIONS.find(item => item.id === latest.preferences.searchProvider)?.name} · 时钟{latest.preferences.showClock ? '显示' : '隐藏'} · 日历{latest.preferences.showCalendar ? '显示' : '隐藏'}</p><button disabled={busy} onClick={() => {
      if (!window.confirm('使用最新账号设置替换当前账号设置预览？本地图库草稿会保留。')) return;
      initial.current = JSON.stringify(latest.preferences); savedBuiltin.current = latest.preferences.wallpaperId;
      change({ ...current.current, preferences: { ...latest.preferences }, baseRevision: latest.revision }); setLatest(null); command.clearError(); setSaveError(null);
    }}>使用最新设置重新编辑</button></section>}
    <footer className="modal-footer"><button className="text-button home-account-link" disabled={busy} onClick={() => { if (mayLeave()) { onClose(); onAccount(); } }}>账号与更多设置</button><button disabled={busy} onClick={() => { if (mayLeave()) onClose(); }}>取消</button><button className="primary" disabled={!dirty || busy || expired} onClick={() => void save()}><Save size={16} />{saving ? '正在保存…' : '保存主页设置'}</button></footer>
  </Modal>;
}
