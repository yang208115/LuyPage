import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark as BookmarkGlyph, Check, CheckSquare, ChevronDown, CircleHelp, Folder, LayoutGrid, LoaderCircle, Menu, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Star, Tag as TagGlyph, Trash2, X } from 'lucide-react';
import { MAX_LAYOUT_OPERATIONS, type Bookmark, type LayoutIndex, type LayoutOperation, type LayoutPreferences, type MutationResult } from '@luypage/contracts';
import { ApiError, useCommand } from './api';
import { useBookmarks, useWorkspace } from './data';
import { useSession, SessionNotice } from './session';
import { asQuery, emptyNavigation, hasFilters, useNavigation } from './NavigationState';
import { beginLayout, layoutChanged, moveInDraft, preferencesInDraft, type LayoutDraft } from './layout';
import { BookmarkBoard, BookmarkCard, type CardActions } from './BookmarkBoard';
import { BookmarkEditor } from './BookmarkEditor';
import { BatchEditor } from './BatchEditor';
import { CollectionManager } from './CollectionManager';
import { Settings } from './Settings';
import { HomePage } from './HomePage';
import { ConfirmDialog, EmptyState, ErrorNotice, LoadingCards, Modal, useBeforeUnload, type Confirmation } from './ui';

export function App() {
  const { session, send, expired } = useSession();
  const command = useCommand(send);
  const layoutCommand = useCommand(send);
  const [draft, setDraft] = useState<LayoutDraft | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [pageError, setPageError] = useState<Error | null>(null);
  const [notification, setNotification] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [editor, setEditor] = useState<{ bookmark?: Bookmark; groupId?: string | null } | null>(null);
  const [manager, setManager] = useState<'groups' | 'tags' | null>(null);
  const [settings, setSettings] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchItems, setBatchItems] = useState<Bookmark[] | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const homepageGuard = useRef<() => boolean>(() => true);
  const dirty = layoutChanged(draft);
  useBeforeUnload(dirty);
  function leaveLayout() {
    if (!homepageGuard.current()) return false;
    if (layoutCommand.pending || layoutLoading) return false;
    if (dirty && !window.confirm('布局尚未保存。放弃布局草稿并继续？')) return false;
    if (draft) { setDraft(null); layoutCommand.clearError(); }
    if (editor) setEditor(null);
    return true;
  }
  const { state: nav, navigate } = useNavigation(leaveLayout);
  const isHomepage = nav.view === 'home';
  useEffect(() => { document.title = `LuyPage · ${nav.view === 'home' ? '你的私人起始页' : nav.view === 'trash' ? '回收站' : '我的网站收藏'}`; }, [nav.view]);
  const { bootstrap, layout, refresh, freshLayout } = useWorkspace(!isHomepage || !!editor || !!manager || settings, !isHomepage);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, dialog'))) return;
      event.preventDefault(); document.querySelector<HTMLInputElement>('input[type=search]')?.focus();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  const navRef = useRef(navigate); navRef.current = navigate;
  const [searchText, setSearchText] = useState(nav.q);
  useEffect(() => setSearchText(nav.q), [nav.q]);
  useEffect(() => {
    if (searchText === nav.q) return;
    const timer = window.setTimeout(() => navRef.current({ q: searchText }, true), 150);
    return () => window.clearTimeout(timer);
  }, [searchText, nav.q]);
  const filters = useMemo(() => asQuery(nav), [nav]);
  const filtered = hasFilters(nav);
  const trash = nav.view === 'trash';
  const bookmarks = useBookmarks(filters, trash, !isHomepage);
  const pinned = useBookmarks({ pinned: true, sort: 'manual' }, false, !isHomepage && !trash && !filtered);
  const loaded = useMemo(() => [...new Map((bookmarks.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.id, item])).values()], [bookmarks.data]);
  const allLoaded = useMemo(() => [...new Map([...loaded, ...(!trash && !filtered ? pinned.data?.pages.flatMap(page => page.items) ?? [] : [])].map(item => [item.id, item])).values()], [loaded, pinned.data, trash, filtered]);
  const selectedItems = allLoaded.filter(bookmark => selected.has(bookmark.id));
  const total = bookmarks.data?.pages[0]?.total ?? 0;
  const data = bootstrap.data;
  const index = draft?.index ?? layout.data;
  const groups = data?.groups ?? [];
  const tags = data?.tags ?? [];
  const selectedGroup = groups.find(group => group.id === nav.groupId);
  const title = trash ? '回收站' : nav.q ? '寻找你的收藏' : nav.groupId ? selectedGroup?.name ?? (nav.groupId === 'ungrouped' ? '未分组' : '分组收藏') : nav.pinned === true ? '常用收藏' : nav.tagIds.length ? '标签收藏' : '我的导航';
  const navKey = JSON.stringify(nav);
  useEffect(() => { setSelected(new Set()); setSelectionMode(false); }, [navKey]);
  useEffect(() => { if (!notification) return; const timer = window.setTimeout(() => setNotification(''), 5000); return () => window.clearTimeout(timer); }, [notification]);

  function notify(message: string) { setNotification(message); }
  function navigateTo(patch: Parameters<typeof navigate>[0]) { if (navigate(patch)) setMobileMenu(false); }
  function add(groupId: string | null = null) { if (leaveLayout()) { setSelectionMode(false); setSelected(new Set()); setEditor({ groupId }); } }
  function openManager(type: 'groups' | 'tags') { if (leaveLayout()) { setSettings(false); setMobileMenu(false); setManager(type); } }
  function changePreference(patch: Partial<LayoutPreferences>) { setDraft(current => current && !current.reset ? preferencesInDraft(current, patch) : current); }
  function move(operation: LayoutOperation) { if (draft && draft.operations.length >= MAX_LAYOUT_OPERATIONS) { setPageError(new Error('本次调整已达到上限，请先保存布局再继续整理。')); return; } setDraft(current => current && !current.reset && !layoutCommand.pending ? moveInDraft(current, operation) : current); }
  function collapse(id: string) {
    if (draft) {
      if (draft.reset || layoutCommand.pending) return;
      const ids = draft.index.preferences.collapsedGroupIds;
      changePreference({ collapsedGroupIds: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] });
    } else setCollapsedOverrides(current => ({ ...current, [id]: !(current[id] ?? index?.preferences.collapsedGroupIds.includes(id)) }));
  }
  async function startLayout() {
    if (layoutLoading || draft) return;
    if ((isHomepage || trash || filtered) && !navigate({ ...emptyNavigation })) return;
    setSettings(false); setSelectionMode(false); setSelected(new Set()); setPageError(null); layoutCommand.clearError(); setLayoutLoading(true);
    try { setDraft(beginLayout(await freshLayout())); setCollapsedOverrides({}); }
    catch (cause) { setPageError(cause instanceof Error ? cause : new Error('无法加载完整布局索引。')); }
    finally { setLayoutLoading(false); }
  }
  async function saveLayout() {
    if (!draft) return;
    try {
      await layoutCommand.execute<MutationResult<LayoutIndex>>('/api/layout', 'PUT', { baseRevision: draft.base.revision, operations: draft.operations, preferences: draft.index.preferences, ...(draft.reset ? { reset: true } : {}) });
      setDraft(null); setCollapsedOverrides({}); notify('布局已保存'); void refresh();
    } catch { /* Keep the exact draft and operation receipt. */ }
  }
  async function previewDefault() {
    if (!draft || !window.confirm('预览默认布局？当前布局草稿将被替换；收藏归属保持已保存的状态，确认保存后才会生效。')) return;
    const base = draft.base;
    setLayoutLoading(true); setPageError(null);
    try {
      const preview = await send<LayoutIndex>('/api/layout/default-preview');
      if (preview.revision !== base.revision) throw new ApiError('数据已在其他设备更新。默认预览未应用，当前布局草稿仍保留；请查看最新布局后重新整理。', 'VERSION_CONFLICT', 409);
      setDraft({ base, index: preview, operations: [], reset: true }); layoutCommand.clearError();
    } catch (cause) { setPageError(cause instanceof Error ? cause : new Error('无法加载默认布局预览。')); }
    finally { setLayoutLoading(false); }
  }
  async function restartLayout() {
    if (!window.confirm('放弃当前布局草稿，重新加载最新布局？')) return;
    setLayoutLoading(true);
    try { const latest = await freshLayout(); setDraft(beginLayout(latest)); setPageError(null); layoutCommand.clearError(); void bootstrap.refetch(); }
    catch (cause) { setPageError(cause instanceof Error ? cause : new Error('无法读取最新布局。')); }
    finally { setLayoutLoading(false); }
  }
  function confirmBookmark(bookmark: Bookmark, action: 'trash' | 'restore' | 'delete') {
    command.clearError();
    setConfirmation({
      title: action === 'delete' ? '永久删除这条收藏？' : action === 'restore' ? '恢复这条收藏？' : '移入回收站？',
      description: action === 'delete' ? `“${bookmark.title}”将永久删除，此操作无法恢复。` : action === 'restore' ? `将恢复“${bookmark.title}”。原分组不存在时会放入未分组。` : `“${bookmark.title}”将移入回收站，可以随时恢复。`,
      label: action === 'delete' ? '确认永久删除' : action === 'restore' ? '恢复收藏' : '移入回收站', danger: action !== 'restore',
      run: async () => {
        const path = action === 'trash' ? `/api/bookmarks/${encodeURIComponent(bookmark.id)}/trash` : action === 'restore' ? `/api/trash/${encodeURIComponent(bookmark.id)}/restore` : `/api/trash/${encodeURIComponent(bookmark.id)}`;
        await command.execute(path, action === 'delete' ? 'DELETE' : 'POST', { version: bookmark.version });
        setConfirmation(null); setSelected(current => new Set([...current].filter(id => id !== bookmark.id))); notify(action === 'restore' ? '收藏已恢复' : action === 'delete' ? '收藏已永久删除' : '已移入回收站'); void refresh();
      },
    });
  }
  async function pin(bookmark: Bookmark) {
    try {
      await command.execute(`/api/bookmarks/${encodeURIComponent(bookmark.id)}`, 'PATCH', { url: bookmark.url, title: bookmark.title, note: bookmark.note, groupId: bookmark.groupId, tagIds: bookmark.tagIds, icon: bookmark.icon, pinned: !bookmark.pinned, version: bookmark.version });
      notify(bookmark.pinned ? '已取消常用' : '已加入常用收藏'); void refresh();
    } catch { /* A retry of this card uses the same operation ID. */ }
  }
  const actions: CardActions = {
    editing: !!draft, locked: layoutCommand.pending || layoutLoading || !!draft?.reset, selecting: selectionMode, selected, trash,
    onSelect: bookmark => setSelected(current => { const next = new Set(current); if (next.has(bookmark.id)) next.delete(bookmark.id); else next.add(bookmark.id); return next; }),
    onEdit: bookmark => { if (leaveLayout()) setEditor({ bookmark }); }, onPin: bookmark => void pin(bookmark),
    onTrash: bookmark => confirmBookmark(bookmark, 'trash'), onRestore: bookmark => confirmBookmark(bookmark, 'restore'), onDelete: bookmark => confirmBookmark(bookmark, 'delete'),
  };
  const latestRevision = Math.max(data?.revision ?? 0, layout.data?.revision ?? 0, bookmarks.data?.pages[0]?.revision ?? 0);
  const collapsed = index?.preferences.collapsedGroupIds ?? [];
  const effectiveCollapsed = draft ? collapsed : groups.filter(group => collapsedOverrides[group.id] ?? collapsed.includes(group.id)).map(group => group.id);

  const overlays = <>
    {notification && <div className="toast" role="status"><Check size={17} />{notification}<button aria-label="关闭提示" onClick={() => setNotification('')}><X size={14} /></button></div>}
    {editor && data && <BookmarkEditor navigationGuard={homepageGuard} bookmark={editor.bookmark} latest={allLoaded.find(bookmark => bookmark.id === editor.bookmark?.id)} groupId={editor.groupId} groups={groups} tags={tags} onSaved={() => { setEditor(null); notify('收藏已保存'); void refresh(); }} onRefresh={() => void refresh()} onClose={() => setEditor(null)} onTrashView={() => { setEditor(null); navigateTo({ ...emptyNavigation, view: 'trash' }); }} />}
    {manager && <CollectionManager initialTab={manager} groups={groups} tags={tags} onRefresh={() => void refresh()} onClose={() => setManager(null)} />}
    {settings && <Settings onClose={() => setSettings(false)} onManage={openManager} onLayout={() => void startLayout()} />}
    {batchItems && <BatchEditor selected={batchItems} latest={allLoaded} groups={groups} tags={tags} trash={trash} onRefresh={() => void refresh()} onSelection={ids => setSelected(new Set(ids))} onClose={() => setBatchItems(null)} />}
    {confirmation && <ConfirmDialog confirmation={confirmation} pending={command.pending} error={command.error} onClose={() => { setConfirmation(null); command.clearError(); }} />}
    {editor && !data && <Modal title="添加收藏" onClose={() => setEditor(null)}><ErrorNotice error={bootstrap.error} retry={() => void bootstrap.refetch()} />{bootstrap.isPending && <p role="status">正在读取分组和标签…</p>}</Modal>}
  </>;
  if (isHomepage) return <><HomePage onLibrary={(groupId, q) => navigateTo({ ...emptyNavigation, groupId: groupId ?? '', q: q ?? '' })} onAdd={add} onAccount={() => setSettings(true)} navigationGuard={homepageGuard} />{overlays}</>;

  const sidebar = <>
    <button className="brand" onClick={() => navigateTo({ ...emptyNavigation })}><span className="brand-mark"><BookmarkGlyph size={22} /></span><span>LuyPage<small>私藏美好，随手抵达</small></span></button>
    <div className="sidebar-main"><div className="nav-caption">你的空间</div><nav aria-label="主要导航">
      <button className="nav-item" onClick={() => navigateTo({ ...emptyNavigation, view: 'home' })}><Sparkles size={18} /><span>起始主页</span></button>
      <button className={`nav-item ${!trash && !filtered ? 'active' : ''}`} onClick={() => navigateTo({ ...emptyNavigation })}><LayoutGrid size={18} /><span>全部收藏</span><small>{data?.counts.active ?? '—'}</small></button>
      <button className={`nav-item ${!trash && nav.pinned === true ? 'active' : ''}`} onClick={() => navigateTo({ ...emptyNavigation, pinned: true })}><Star size={18} /><span>常用收藏</span><small>{data?.counts.pinned ?? '—'}</small></button>
    </nav>
    <div className="nav-caption">我的分组<button className="icon-button" aria-label="管理分组" onClick={() => openManager('groups')}><Plus size={15} /></button></div>
    <nav aria-label="分组导航">{(layout.data?.groupOrder ?? groups.map(group => group.id)).map(id => groups.find(group => group.id === id)).filter(group => group !== undefined).map(group => <button key={group.id} className={`nav-item ${!trash && nav.groupId === group.id ? 'active' : ''}`} onClick={() => navigateTo({ ...emptyNavigation, groupId: group.id })}><Folder size={17} /><span>{group.name}</span><small>{group.count}</small></button>)}
      {(data?.counts.ungrouped ?? 0) > 0 && <button className={`nav-item ${!trash && nav.groupId === 'ungrouped' ? 'active' : ''}`} onClick={() => navigateTo({ ...emptyNavigation, groupId: 'ungrouped' })}><Folder size={17} /><span>未分组</span><small>{data?.counts.ungrouped}</small></button>}
    </nav>
    <div className="nav-caption">标签<button className="icon-button" aria-label="管理标签" onClick={() => openManager('tags')}><Plus size={15} /></button></div>
    <div className="sidebar-tags">{tags.length ? tags.map(tag => <button key={tag.id} className={`chip ${nav.tagIds.includes(tag.id) ? 'selected' : ''}`} aria-pressed={nav.tagIds.includes(tag.id)} onClick={() => navigateTo({ tagIds: nav.tagIds.includes(tag.id) ? nav.tagIds.filter(id => id !== tag.id) : [...nav.tagIds, tag.id] })}><span>#</span>{tag.name}</button>) : <button className="text-button muted" onClick={() => openManager('tags')}>添加你的第一个标签</button>}</div>
    </div>
    <div className="sidebar-bottom"><button className={`nav-item ${trash ? 'active' : ''}`} onClick={() => navigateTo({ ...emptyNavigation, view: 'trash' })}><Trash2 size={17} /><span>回收站</span><small>{data?.counts.trash ?? '—'}</small></button><button className="nav-item" onClick={() => { if (leaveLayout()) { setSettings(true); setMobileMenu(false); } }}><Settings2 size={17} /><span>设置</span></button><div className="account"><span className="avatar">{session.user.displayName.charAt(0).toUpperCase()}</span><span><strong>{session.user.displayName}</strong><small><ShieldCheck size={11} />{session.local ? '本地开发身份' : '你的私有空间'}</small></span><span className="online-dot" /></div></div>
  </>;

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">跳转到主要内容</a>
    <aside className="sidebar">{sidebar}</aside>
    {mobileMenu && <Modal title="你的收藏空间" onClose={() => setMobileMenu(false)} className="mobile-nav-modal"><div className="mobile-nav-content">{sidebar}</div></Modal>}
    <main id="main-content" className="main-content">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu-button" aria-label="打开导航菜单" onClick={() => setMobileMenu(true)}><Menu size={21} /></button><span>私人空间</span><span className="breadcrumb-slash">/</span><strong>{trash ? '回收站' : '收藏导航'}</strong></div><span className="private-label"><ShieldCheck size={14} />仅你可见</span></header>
      <div className="page-body"><SessionNotice />
        <section className="page-heading"><div><p className="eyebrow">{trash ? 'A SECOND CHANCE' : 'YOUR LITTLE CORNER OF THE INTERNET'}</p><h1>{title}<span className="heading-dot">.</span></h1><p>{trash ? '暂时告别的收藏，都在这里等你。不会自动清空。' : '把喜欢的网站，安放在这里。'}</p></div><button className="primary add-bookmark" onClick={() => add(nav.groupId && nav.groupId !== 'ungrouped' ? nav.groupId : null)} disabled={layoutCommand.pending || layoutLoading}><Plus size={18} />添加收藏</button></section>
        <div className="search-toolbar"><div className="search-field"><Search size={19} /><input type="search" aria-label={trash ? '搜索回收站' : '搜索收藏'} placeholder={trash ? '搜索回收站中的收藏…' : '搜索标题、网址、备注或标签…'} value={searchText} onChange={event => { if (leaveLayout()) setSearchText(event.target.value); }} /><kbd>/</kbd></div><button className={`toolbar-button ${selectionMode ? 'selected' : ''}`} onClick={() => { if (leaveLayout()) { setSelectionMode(value => !value); setSelected(new Set()); } }} disabled={!allLoaded.length || layoutLoading || layoutCommand.pending}><CheckSquare size={17} /><span>{selectionMode ? '退出多选' : '批量管理'}</span></button>{!trash && <button className="toolbar-button" onClick={() => void startLayout()} disabled={!!draft || layoutLoading}><SlidersHorizontal size={17} /><span>{layoutLoading ? '正在读取…' : '编辑布局'}</span></button>}</div>
        <div className="filter-bar"><span className="filter-label">筛选</span><select aria-label="分组筛选" value={nav.groupId} onChange={event => navigateTo({ groupId: event.target.value })}><option value="">全部分组</option><option value="ungrouped">未分组</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><select aria-label="常用筛选" value={nav.pinned === undefined ? '' : String(nav.pinned)} onChange={event => navigateTo({ pinned: event.target.value === '' ? undefined : event.target.value === 'true' })}><option value="">全部收藏</option><option value="true">仅常用</option><option value="false">非常用</option></select>
          <details className="tag-filter"><summary><TagGlyph size={14} />标签{nav.tagIds.length ? ` · ${nav.tagIds.length}` : ''}<ChevronDown size={12} /></summary><div className="tag-filter-panel"><strong>包含全部所选标签</strong><div className="tag-choices">{tags.length ? tags.map(tag => <button key={tag.id} className={`chip ${nav.tagIds.includes(tag.id) ? 'selected' : ''}`} aria-pressed={nav.tagIds.includes(tag.id)} onClick={() => navigateTo({ tagIds: nav.tagIds.includes(tag.id) ? nav.tagIds.filter(id => id !== tag.id) : [...nav.tagIds, tag.id] })}>{tag.name}</button>) : <p className="muted">还没有标签</p>}</div></div></details>
          <label className="sort-filter"><span>排序</span><select aria-label="收藏排序" value={nav.sort} onChange={event => navigateTo({ sort: event.target.value as typeof nav.sort })}><option value="manual">手动顺序</option><option value="created">添加时间</option><option value="updated">修改时间</option><option value="title">标题</option></select></label>
          <button className="icon-button" aria-label="刷新收藏" disabled={bookmarks.isFetching} onClick={() => void refresh()}><RefreshCw size={15} className={bookmarks.isFetching ? 'spin' : ''} /></button>
        </div>
        {filtered && <div className="active-filters"><span>{nav.tagIds.length > 1 ? '包含全部所选标签 · ' : ''}{total} 条结果</span>{nav.q && <span className="chip">关键词：{nav.q}<button aria-label="清除关键词" onClick={() => { setSearchText(''); navigateTo({ q: '' }); }}><X size={12} /></button></span>}{nav.tagIds.map(id => <span className="chip" key={id}>#{tags.find(tag => tag.id === id)?.name ?? '已删除标签'}<button aria-label="移除标签筛选" onClick={() => navigateTo({ tagIds: nav.tagIds.filter(value => value !== id) })}><X size={12} /></button></span>)}<button className="text-button" onClick={() => { setSearchText(''); navigateTo({ ...emptyNavigation, view: nav.view }); }}>清除全部条件</button></div>}
        {draft && <section className="layout-toolbar"><div className="layout-status"><SlidersHorizontal size={18} /><strong>{draft.reset ? '默认布局预览' : '正在编辑布局'}</strong><span className="status-tag">{dirty ? '未保存' : '尚未修改'}</span></div><p>{draft.reset ? '已预览所有收藏的默认顺序。保存或取消后可继续调整。' : '拖动手柄整理卡片，或展开「调整位置」使用键盘操作。所有修改在保存后一起生效。'}</p><fieldset disabled={layoutCommand.pending || layoutLoading || draft.reset}><div className="layout-preferences"><label>桌面列数<select aria-label="桌面列数" value={draft.index.preferences.desktopColumns} onChange={event => changePreference({ desktopColumns: event.target.value === 'auto' ? 'auto' : Number(event.target.value) as 4 | 5 | 6 })}><option value="auto">自动</option><option value="4">4 列</option><option value="5">5 列</option><option value="6">6 列</option></select></label><label>手机列数<select aria-label="手机列数" value={draft.index.preferences.mobileColumns} onChange={event => changePreference({ mobileColumns: event.target.value === 'auto' ? 'auto' : Number(event.target.value) as 2 | 3 })}><option value="auto">自动</option><option value="2">2 列</option><option value="3">3 列</option></select></label><label>卡片密度<select aria-label="卡片密度" value={draft.index.preferences.density} onChange={event => changePreference({ density: event.target.value as LayoutPreferences['density'] })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label><button onClick={() => void previewDefault()}>恢复默认布局</button></div></fieldset><div className="layout-save-actions"><button disabled={layoutCommand.pending || layoutLoading} onClick={() => { if (leaveLayout()) setCollapsedOverrides({}); }}>取消布局编辑</button><button className="primary" disabled={layoutCommand.pending || layoutLoading || !dirty || expired} onClick={() => void saveLayout()}>{layoutCommand.pending ? '正在保存…' : '保存布局'}</button></div>
          {(latestRevision !== draft.base.revision || layoutCommand.error instanceof ApiError && layoutCommand.error.status === 409) && <div className="notice warning"><div><strong>已检测到其他更新</strong><p>当前草稿仍保留。基础版本 {draft.base.revision}，最新已知版本 {latestRevision}。</p><button className="small" disabled={layoutCommand.pending || layoutLoading} onClick={() => void restartLayout()}>放弃草稿并加载最新布局</button></div></div>}
          <ErrorNotice error={layoutCommand.error} />
        </section>}
        {selectionMode && <section className="selection-toolbar"><label className="checkbox-label"><input type="checkbox" checked={allLoaded.length > 0 && allLoaded.every(bookmark => selected.has(bookmark.id))} onChange={event => setSelected(event.target.checked ? new Set(allLoaded.map(bookmark => bookmark.id)) : new Set())} />全选已加载的 {allLoaded.length} 条</label><strong>已选 {selected.size} 条</strong><button className="primary small" disabled={!selectedItems.length} onClick={() => setBatchItems(selectedItems)}>处理所选收藏</button><button className="icon-button" aria-label="退出多选" onClick={() => { setSelectionMode(false); setSelected(new Set()); }}><X size={17} /></button></section>}
        <ErrorNotice error={pageError} />
        <ErrorNotice error={bootstrap.error} retry={() => void bootstrap.refetch()} />
        {!confirmation && <ErrorNotice error={command.error} retry={() => void refresh()} />}
        <ErrorNotice error={bookmarks.error} retry={() => void bookmarks.refetch()} />
        {!filtered && !trash && <><ErrorNotice error={layout.error} retry={() => void layout.refetch()} /><ErrorNotice error={pinned.error} retry={() => void pinned.refetch()} /></>}
        {(bootstrap.isPending || bookmarks.isPending || !trash && !filtered && layout.isPending) ? <LoadingCards /> : !bookmarks.error && !loaded.length && (!data?.counts.active || trash || filtered) ? <EmptyState type={filtered ? 'search' : 'bookmarks'} title={filtered ? '还没有找到匹配的收藏' : trash ? '回收站是空的' : '你的好网站，值得一个好位置'} description={filtered ? '试试更短的关键词，或放宽分组、标签与常用条件。' : trash ? '移入回收站的收藏会出现在这里，你可以随时恢复。' : '从一个常用网站开始，把工作、灵感与日常好物收进自己的导航。'} action={filtered ? () => { setSearchText(''); navigateTo({ ...emptyNavigation, view: nav.view }); } : trash ? () => navigateTo({ ...emptyNavigation }) : () => add()} label={filtered ? '清除全部条件' : trash ? '返回我的导航' : '添加第一条收藏'} /> : null}
        {!trash && !filtered && index && (allLoaded.length > 0 || index.groupOrder.length > 0 || !!draft) && <BookmarkBoard index={index} groups={groups} records={allLoaded} actions={actions} onMove={move} onCollapse={collapse} collapsedOverride={effectiveCollapsed} onAdd={add} onLoadMore={() => { if (!bookmarks.isFetching) void bookmarks.fetchNextPage(); }} hasMore={!!bookmarks.hasNextPage} onPinnedMore={() => { if (!pinned.isFetching) void pinned.fetchNextPage(); }} hasPinnedMore={!!pinned.hasNextPage} />}
        {(trash || filtered) && loaded.length > 0 && <div className={`results-grid card-grid ${trash ? 'trash-grid' : ''}`}>{loaded.map(bookmark => <BookmarkCard key={bookmark.id} bookmark={bookmark} actions={actions} />)}</div>}
        {bookmarks.hasNextPage && <div className="load-more"><button disabled={bookmarks.isFetching} onClick={() => void bookmarks.fetchNextPage()}>{bookmarks.isFetching ? <LoaderCircle className="spin" size={17} /> : <ChevronDown size={17} />}{bookmarks.isFetching ? '正在加载…' : '加载更多'}</button><small>已加载 {loaded.length} / {total} 条</small></div>}
        {!filtered && !trash && !data?.counts.active && data && <div className="empty-extra"><Sparkles size={15} /><span>先收藏，再慢慢整理。</span><button className="text-button" onClick={() => setSettings(true)}>导入与导出说明</button></div>}
        <footer className="page-footer"><span>LuyPage<span> · </span>为你喜欢的互联网，留一个位置。</span><button className="text-button" onClick={() => { if (leaveLayout()) setSettings(true); }}><CircleHelp size={13} />使用与设置</button></footer>
      </div>
    </main>
    {overlays}
  </div>;
}
