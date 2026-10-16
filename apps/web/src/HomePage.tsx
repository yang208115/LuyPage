import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Bookmark, Check, ChevronLeft, ChevronRight, Folder, Home, LayoutGrid, Leaf, Menu, Plus, Search, Settings2, ShieldCheck, Star, X } from 'lucide-react';
import { DEFAULT_HOMEPAGE_PREFERENCES, type HomepageFolder, type HomepageShortcut, type HomepagePreferences } from '@luypage/contracts';
import { useBookmarks, useHomepage } from './data';
import { useSession, SessionNotice } from './session';
import { BUILTIN_ICONS, ErrorNotice, Modal, safeWebsite } from './ui';
import { HomepageSettings, type HomepageDraft } from './HomepageSettings';
import { calendarDays, externalSearchUrl, SEARCH_OPTIONS, WALLPAPERS } from './homepage-model';
import { useWallpaper } from './use-wallpaper';
import './homepage.css';
import { AutomaticIcon } from './AutomaticIcon';

type HomeProps = {
  onLibrary: (groupId?: string, query?: string) => void;
  onAdd: (groupId?: string | null) => void; onAccount: () => void;
  navigationGuard: RefObject<() => boolean>;
};

function useLocalTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, []);
  return now;
}
function ClockCard() {
  const now = useLocalTime();
  const hour = now.getHours();
  const greeting = hour < 6 ? '夜深了，记得好好休息' : hour < 12 ? '早上好，新的一天开始了' : hour < 18 ? '下午好，给自己一点闲暇' : '晚上好，欢迎回到自己的空间';
  return <section className="home-clock home-tile" aria-label="时钟">
    <span className="home-widget-label"><Leaf size={16} />此刻，刚刚好</span>
    <time dateTime={now.toISOString()} className="home-clock-time">{now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}<span>{String(now.getSeconds()).padStart(2, '0')}</span></time>
    <p>{greeting}</p><span className="home-clock-date">{now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>
  </section>;
}
function CalendarCard() {
  const now = useLocalTime();
  const [offset, setOffset] = useState(0);
  const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  return <section className="home-calendar home-tile" aria-label="日历">
    <header><button className="home-icon-button" aria-label="上个月" onClick={() => setOffset(value => value - 1)}><ChevronLeft size={16} /></button><button className="calendar-today" aria-label="返回今天" title="返回今天" onClick={() => setOffset(0)}>{year} 年 {monthIndex + 1} 月</button><button className="home-icon-button" aria-label="下个月" onClick={() => setOffset(value => value + 1)}><ChevronRight size={16} /></button></header>
    <div className="calendar-grid">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span className="calendar-weekday" key={day}>{day}</span>)}{calendarDays(year, monthIndex).map((day, index) => <span key={index} className={day === now.getDate() && monthIndex === now.getMonth() && year === now.getFullYear() ? 'calendar-current' : ''} aria-current={day === now.getDate() && offset === 0 ? 'date' : undefined}>{day}</span>)}</div>
  </section>;
}
function ShortcutIcon({ bookmark }: { bookmark: HomepageShortcut }) {
  const Icon = BUILTIN_ICONS.find(item => bookmark.icon.type === 'builtin' && item.key === bookmark.icon.key)?.icon ?? Bookmark;
  let hostname = bookmark.url;
  try { hostname = new URL(bookmark.url).hostname; } catch { /* Invalid links are inert. */ }
  const tone = [...hostname].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7;
  return <span className={`home-site-icon home-tone-${tone}`}><AutomaticIcon bookmark={bookmark}><Icon aria-hidden="true" size={29} strokeWidth={1.8} /></AutomaticIcon></span>;
}
function Shortcut({ bookmark }: { bookmark: HomepageShortcut }) {
  const href = safeWebsite(bookmark.url);
  const content = <><ShortcutIcon bookmark={bookmark} /><span className="home-shortcut-name">{bookmark.title}</span></>;
  return href ? <a className="home-shortcut" href={href} target="_blank" rel="noopener noreferrer" title={`${bookmark.title}\n${bookmark.url}`}>{content}</a> : <span className="home-shortcut invalid" title="网址无效，请在收藏管理中编辑">{content}</span>;
}
function FolderCard({ folder, onOpen }: { folder: HomepageFolder; onOpen: () => void }) {
  return <button className="home-folder home-tile" aria-label={`打开文件夹：${folder.name}`} onClick={onOpen}>
    <span className={`home-folder-preview ${!folder.preview.length ? 'is-empty' : ''}`}>{folder.preview.length ? folder.preview.map(item => <ShortcutIcon key={item.id} bookmark={item} />) : <Folder size={39} strokeWidth={1.3} />}</span>
    <span className="home-folder-caption"><strong title={folder.name}>{folder.name}</strong><small>{folder.count} 个网站<ChevronRight size={13} /></small></span>
  </button>;
}
function FolderDialog({ folder, onClose, onAdd, onLibrary }: { folder: HomepageFolder; onClose: () => void; onAdd: () => void; onLibrary: () => void }) {
  const query = useBookmarks({ groupId: folder.id ?? 'ungrouped', sort: 'manual', limit: 40 });
  const items = [...new Map((query.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.id, item])).values()];
  return <Modal title={folder.name} subtitle={`${query.data?.pages[0]?.total ?? folder.count} 个网站 · 留住喜欢，也随时出发`} onClose={onClose} wide className="home-folder-dialog">
    <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    {query.isPending ? <p className="home-dialog-status" role="status">正在打开文件夹…</p> : !query.error && !items.length ? <div className="home-folder-empty"><Folder size={38} /><p>这里还留着位置，给下一个好网站。</p><button className="primary" onClick={onAdd}><Plus size={16} />添加收藏</button></div> : <div className="home-dialog-shortcuts">{items.map(item => <Shortcut key={item.id} bookmark={item} />)}</div>}
    {query.hasNextPage && <button className="home-folder-more" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetching ? '正在加载…' : '加载更多收藏'}</button>}
    <footer className="modal-footer"><button onClick={onAdd}><Plus size={16} />添加收藏</button><button onClick={onLibrary}>管理这个分组<ArrowUpRight size={15} /></button></footer>
  </Modal>;
}

export function HomePage({ onLibrary, onAdd, onAccount, navigationGuard }: HomeProps) {
  const { session } = useSession();
  const homepage = useHomepage();
  const pinned = useBookmarks({ pinned: true, sort: 'manual', limit: 20 });
  const [folderId, setFolderId] = useState<string | null | undefined>(undefined);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [draft, setDraft] = useState<HomepageDraft | null>(null);
  const localWallpaper = useWallpaper(session.user.id, draft?.local ? { id: draft.local.selectedId, blob: draft.local.additions.find(item => item.id === draft.local?.selectedId)?.blob } : undefined);
  const [providerOverride, setProviderOverride] = useState<HomepagePreferences['searchProvider'] | null>(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const composing = useRef(false);
  const data = homepage.data;
  const preferences = draft?.preferences ?? data?.preferences ?? DEFAULT_HOMEPAGE_PREFERENCES;
  const provider = providerOverride ?? preferences.searchProvider;
  const folders = (data?.folders ?? []).filter(folder => folder.id !== null || folder.count > 0);
  const activeFolder = folderId !== undefined ? folders.find(folder => folder.id === folderId) : undefined;
  const shortcuts = [...new Map((pinned.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.id, item])).values()];
  useEffect(() => setProviderOverride(null), [preferences.searchProvider]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4500); return () => window.clearTimeout(timer); }, [notice]);
  function openFolder(folder: HomepageFolder) { setMobileMenu(false); setFolderId(folder.id); }
  function settings() { if (data) { setMobileMenu(false); setDraft({ baseRevision: data.revision, preferences: { ...data.preferences }, local: null }); } }
  function submit(event: FormEvent) {
    event.preventDefault();
    const query = search.trim();
    if (!query || composing.current) return;
    if (provider === 'bookmarks') onLibrary(undefined, query);
    else { const url = externalSearchUrl(provider, query); if (url) window.open(url, '_blank', 'noopener,noreferrer'); }
  }
  const navigation = <>
    <button className="home-brand" aria-label="LuyPage 主页" onClick={() => { setMobileMenu(false); setFolderId(undefined); }}><Leaf size={25} strokeWidth={1.7} /><span>LuyPage</span></button>
    <nav aria-label="主页导航" className="home-primary-nav"><button className="home-nav-item active" aria-label="主页" aria-current="page" onClick={() => setMobileMenu(false)}><Home size={21} /><span>主页</span></button><button className="home-nav-item" aria-label="收藏管理" onClick={() => onLibrary()}><LayoutGrid size={21} /><span>收藏管理</span></button></nav>
    <div className="home-nav-separator" /><nav aria-label="主页分组" className="home-folder-nav">{folders.map(folder => <button key={folder.id ?? 'ungrouped'} className="home-nav-item" aria-label={`打开分组：${folder.name}`} title={folder.name} onClick={() => openFolder(folder)}><Folder size={19} /><span>{folder.name}</span></button>)}</nav>
    <div className="home-rail-bottom"><button className="home-nav-item" aria-label="添加收藏" onClick={() => { setMobileMenu(false); onAdd(); }}><Plus size={22} /><span>添加收藏</span></button><button className="home-nav-item" aria-label="主页设置" disabled={!data} onClick={settings}><Settings2 size={20} /><span>主页设置</span></button><button className="home-avatar" aria-label="账号与设置" title={session.user.displayName} onClick={() => { setMobileMenu(false); onAccount(); }}><ShieldCheck size={19} /><span>{session.user.displayName}</span></button></div>
  </>;
  const wallpaper = WALLPAPERS.find(item => item.id === preferences.wallpaperId)!;
  return <div className={`homepage wallpaper-${localWallpaper.url ? 'custom' : preferences.wallpaperId}`} style={{ '--home-wallpaper': `url("${localWallpaper.url ?? `/wallpapers/${preferences.wallpaperId}.webp`}")` } as CSSProperties}>
    <a href="#home-content" className="skip-link">跳转到主要内容</a>
    <aside className="home-rail">{navigation}</aside>
    <header className="home-mobile-header"><button className="home-icon-button" aria-label="打开主页导航" onClick={() => setMobileMenu(true)}><Menu size={22} /></button><span><Leaf size={17} />LuyPage</span><button className="home-icon-button" aria-label="打开主页设置" disabled={!data} onClick={settings}><Settings2 size={21} /></button></header>
    <main className="home-content" id="home-content">
      <form className="home-search" role="search" onSubmit={submit}>
        <label className="home-search-provider"><Search size={20} /><select aria-label="搜索方式" value={provider} onChange={event => setProviderOverride(event.target.value as HomepagePreferences['searchProvider'])}>{SEARCH_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
        <input type="search" aria-label="主页搜索" maxLength={2000} placeholder={provider === 'bookmarks' ? '在收藏里，找点喜欢的…' : '输入搜索内容，去看看更大的世界…'} value={search} onChange={event => setSearch(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
        <button type="submit" className="home-icon-button" aria-label="执行搜索" disabled={!search.trim()}><ArrowRight size={20} /></button>
      </form>
      <div className="home-notices"><SessionNotice /><ErrorNotice error={homepage.error} retry={() => void homepage.refetch()} /><ErrorNotice error={localWallpaper.error} retry={localWallpaper.reload} /></div>
      <section className="home-dashboard" aria-label="我的主页组件">
        {preferences.showClock && <ClockCard />}{preferences.showCalendar && <CalendarCard />}
        {data && folders.map(folder => <FolderCard key={folder.id ?? 'ungrouped'} folder={folder} onOpen={() => openFolder(folder)} />)}
        {homepage.isPending && <div className="home-tile home-loading" role="status">正在准备你的空间…</div>}
      </section>
      <section className="home-favorites" aria-labelledby="home-favorites-title"><header><h1 id="home-favorites-title"><Star size={16} />常用收藏</h1><button onClick={() => onLibrary()}>整理我的收藏<ArrowUpRight size={14} /></button></header>
        <ErrorNotice error={pinned.error} retry={() => void pinned.refetch()} />
        {pinned.isPending ? <p className="home-pinned-status" role="status">正在加载常用收藏…</p> : <>
          {!pinned.error && !shortcuts.length && <p className="home-pinned-status">{data?.counts.active ? '把喜欢的网站设为常用，下次从这里出发。' : '从第一个网站开始，收藏自己的小小世界。'}</p>}
          <div className="home-shortcuts">{shortcuts.map(bookmark => <Shortcut key={bookmark.id} bookmark={bookmark} />)}<button className="home-shortcut home-add-shortcut" onClick={() => onAdd()}><span className="home-site-icon"><Plus size={29} strokeWidth={1.5} /></span><span className="home-shortcut-name">添加收藏</span></button></div>
        </>}
        {pinned.hasNextPage && <button className="home-load-more" disabled={pinned.isFetching} onClick={() => void pinned.fetchNextPage()}><ArrowDown size={15} />{pinned.isFetching ? '正在加载…' : '更多常用收藏'}</button>}
      </section>
      <footer className="home-footer"><span><Leaf size={13} />{localWallpaper.url ? '属于你的风景' : wallpaper.caption}</span><span><ShieldCheck size={12} />你的私有空间</span></footer>
    </main>
    {mobileMenu && <Modal title="你的空间" onClose={() => setMobileMenu(false)} className="home-mobile-menu"><div className="home-mobile-nav">{navigation}</div></Modal>}
    {activeFolder && <FolderDialog key={activeFolder.id ?? 'ungrouped'} folder={activeFolder} onClose={() => setFolderId(undefined)} onAdd={() => { setFolderId(undefined); onAdd(activeFolder.id); }} onLibrary={() => onLibrary(activeFolder.id ?? 'ungrouped')} />}
    {draft && <HomepageSettings draft={draft} onChange={setDraft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); localWallpaper.reload(); setNotice('主页设置已保存'); }} onAccount={onAccount} navigationGuard={navigationGuard} />}
    {notice && <div className="toast home-toast" role="status"><Check size={17} />{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
  </div>;
}
