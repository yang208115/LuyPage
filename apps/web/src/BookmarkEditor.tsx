import { useEffect, useState, type FormEvent, type RefObject } from 'react';
import { Check, Link2, Plus, Save, Star } from 'lucide-react';
import { bookmarkInputSchema, nameInputSchema, normalizeUrl, type Bookmark, type BookmarkInput, type Group, type MutationResult, type Tag } from '@luypage/contracts';
import { ApiError, useCommand } from './api';
import { useSession } from './session';
import { BUILTIN_ICONS, ErrorNotice, Modal, safeWebsite, useBeforeUnload } from './ui';

const emptyInput = (groupId: string | null): BookmarkInput => ({ url: '', title: '', note: '', groupId, tagIds: [], pinned: false, icon: { type: 'auto', key: null } });
function fromBookmark(bookmark: Bookmark): BookmarkInput {
  return { url: bookmark.url, title: bookmark.title, note: bookmark.note, groupId: bookmark.groupId, tagIds: [...bookmark.tagIds], pinned: bookmark.pinned, icon: { ...bookmark.icon } };
}

export function BookmarkEditor({ bookmark, latest, groupId = null, groups, tags, onSaved, onRefresh, onClose, onTrashView, navigationGuard }: {
  bookmark?: Bookmark; latest?: Bookmark; groupId?: string | null; groups: Group[]; tags: Tag[];
  onSaved: () => void; onRefresh: () => void; onClose: () => void; onTrashView: () => void;
  navigationGuard?: RefObject<() => boolean>;
}) {
  const { send } = useSession();
  const command = useCommand(send);
  const tagCommand = useCommand(send);
  const [input, setInput] = useState<BookmarkInput>(() => bookmark ? fromBookmark(bookmark) : emptyInput(groupId));
  const [original, setOriginal] = useState(() => JSON.stringify(input));
  const [version, setVersion] = useState(bookmark?.version);
  const [validation, setValidation] = useState<Error | null>(null);
  const [newTag, setNewTag] = useState('');
  const [createdTags, setCreatedTags] = useState<Tag[]>([]);
  const [compared, setCompared] = useState<Bookmark | null>(null);
  const [comparisonError, setComparisonError] = useState<Error | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const allTags = [...tags, ...createdTags.filter(tag => !tags.some(existing => existing.id === tag.id))];
  const dirty = JSON.stringify(input) !== original || newTag.trim().length > 0;
  useBeforeUnload(dirty);
  const busy = command.pending || tagCommand.pending;
  function mayLeave() { return !busy && (!dirty || window.confirm('放弃尚未保存的收藏草稿？')); }
  function close() { if (mayLeave()) onClose(); }
  useEffect(() => {
    if (!navigationGuard) return;
    navigationGuard.current = mayLeave;
    return () => { navigationGuard.current = () => true; };
  });
  function update<K extends keyof BookmarkInput>(key: K, value: BookmarkInput[K]) { setInput(current => ({ ...current, [key]: value })); setValidation(null); }
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const parsed = bookmarkInputSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map(issue => issue.message).join('；'));
      if (newTag.trim()) throw new Error('请先创建新标签，或清空新标签输入后再保存。');
      setValidation(null);
      const payload = { ...parsed.data, ...(version !== undefined ? { version } : {}) };
      await command.execute<MutationResult<Bookmark>>(bookmark ? `/api/bookmarks/${encodeURIComponent(bookmark.id)}` : '/api/bookmarks', bookmark ? 'PATCH' : 'POST', payload);
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError) { if (cause.status === 409) onRefresh(); }
      else setValidation(cause instanceof Error ? cause : new Error('请检查输入。'));
    }
  }
  async function createTag() {
    const parsedName = nameInputSchema.shape.name.safeParse(newTag);
    if (!parsedName.success) { setValidation(new Error(parsedName.error.issues.map(issue => issue.message).join('；'))); return; }
    const name = parsedName.data;
    if (input.tagIds.length >= 20) { setValidation(new Error('每条收藏最多选择 20 个标签。')); return; }
    try {
      const result = await tagCommand.execute<MutationResult<Tag>>('/api/tags', 'POST', { name });
      setCreatedTags(current => [...current, result.data]);
      update('tagIds', [...input.tagIds, result.data.id]); setNewTag(''); onRefresh();
    } catch { /* The command keeps its error and retry identity. */ }
  }
  const conflict = command.error instanceof ApiError && command.error.status === 409;
  const duplicate = command.error instanceof ApiError && command.error.code === 'DUPLICATE_URL';
  const details = command.error instanceof ApiError ? command.error.details : null;
  const existingId = details && typeof details === 'object' && 'id' in details && typeof details.id === 'string' ? details.id : bookmark?.id;
  const latestRecord = compared?.id === existingId ? compared : latest;
  async function compareLatest() {
    if (!existingId || comparisonLoading) return;
    setComparisonLoading(true); setComparisonError(null);
    try { setCompared(await send<Bookmark>(`/api/bookmarks/${encodeURIComponent(existingId)}`)); }
    catch (cause) { setComparisonError(cause instanceof Error ? cause : new Error('无法读取已有收藏，请重试。')); }
    finally { setComparisonLoading(false); }
  }
  return <Modal title={bookmark ? '编辑收藏' : '添加收藏'} subtitle="留住一个好网站，下次一眼就找到。" onClose={close} wide>
    <form onSubmit={event => void save(event)}>
      <fieldset disabled={busy}>
        <label className="field"><span>网站地址 <em>必填</em></span><div className="input-with-icon"><Link2 size={17} /><input autoFocus name="url" type="text" inputMode="url" autoComplete="url" placeholder="https://example.com" value={input.url} onChange={event => update('url', event.target.value)} onBlur={() => { try { if (input.url.trim()) update('url', normalizeUrl(input.url).url); } catch { /* Validate on submit. */ } }} /></div>
          <small>仅支持 HTTP / HTTPS；未填写协议时会补全 https://。</small></label>
        <label className="field"><span>标题</span><input name="title" value={input.title} onChange={event => update('title', event.target.value)} placeholder="留空将使用网站域名" /></label>
        <div className="form-two-columns">
          <label className="field"><span>分组</span><select value={input.groupId ?? ''} onChange={event => update('groupId', event.target.value || null)}><option value="">未分组</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label className="pin-field"><input type="checkbox" checked={input.pinned} onChange={event => update('pinned', event.target.checked)} /><Star size={17} />设为常用收藏</label>
        </div>
        <label className="field"><span>备注 <small>{[...input.note].length} / 2000</small></span><textarea name="note" rows={3} value={input.note} onChange={event => update('note', event.target.value)} placeholder="它有什么特别之处？" /></label>
        <div className="field"><span>标签 <small>已选 {input.tagIds.length} / 20</small></span>
          <div className="tag-choices">{allTags.length ? allTags.map(tag => <button type="button" key={tag.id} className={`chip ${input.tagIds.includes(tag.id) ? 'selected' : ''}`} aria-pressed={input.tagIds.includes(tag.id)} onClick={() => update('tagIds', input.tagIds.includes(tag.id) ? input.tagIds.filter(id => id !== tag.id) : [...input.tagIds, tag.id])}>{input.tagIds.includes(tag.id) && <Check size={12} />}{tag.name}</button>) : <small>还没有标签，可以直接创建。</small>}</div>
          <div className="inline-create"><input aria-label="新标签名称" placeholder="新标签名称" value={newTag} onChange={event => setNewTag(event.target.value)} /><button type="button" disabled={!newTag.trim()} onClick={() => void createTag()}><Plus size={15} />创建标签</button></div>
        </div>
        <div className="field"><span>卡片图标</span><div className="icon-choices">
          <button type="button" className={input.icon.type === 'auto' ? 'selected' : ''} aria-pressed={input.icon.type === 'auto'} onClick={() => update('icon', { type: 'auto', key: null })}>Aa<span>域名首字母</span></button>
          {BUILTIN_ICONS.map(({ key, label, icon: Icon }) => <button type="button" key={key} className={input.icon.type === 'builtin' && input.icon.key === key ? 'selected' : ''} aria-label={`${label}图标`} aria-pressed={input.icon.type === 'builtin' && input.icon.key === key} onClick={() => update('icon', { type: 'builtin', key })}><Icon size={20} /><span>{label}</span></button>)}
        </div><small>自动获取网站图标暂不可用。当前使用域名首字母或你选择的内置图标。</small></div>
      </fieldset>
      <ErrorNotice error={validation || command.error || tagCommand.error} />
      {conflict && <div className="conflict-tools">
        {existingId && <button type="button" disabled={comparisonLoading} onClick={() => void compareLatest()}>{comparisonLoading ? '正在读取…' : duplicate ? '查看已有收藏' : '查看最新数据'}</button>}
        <ErrorNotice error={comparisonError} />
        {latestRecord && (duplicate || latestRecord.version !== version) && <details open={compared !== null}><summary>{duplicate ? '已保存的收藏' : '其他设备上的最新内容'}</summary><p>{latestRecord.title}</p><p className="wrap-anywhere">{latestRecord.url}</p><p>{latestRecord.note || '没有备注'}</p>
          {safeWebsite(latestRecord.url) && <a href={safeWebsite(latestRecord.url)} target="_blank" rel="noreferrer">打开已有收藏</a>}
          {!duplicate && <button type="button" onClick={() => {
          if (window.confirm('放弃当前草稿，使用最新记录重新编辑？')) { const next = fromBookmark(latestRecord); setInput(next); setOriginal(JSON.stringify(next)); setVersion(latestRecord.version); command.clearError(); setCompared(null); }
        }}>使用最新内容重新编辑</button>}</details>}
        {command.error instanceof ApiError && /TRASH/i.test(command.error.code) && <button type="button" onClick={() => { if (!dirty || window.confirm('前往回收站将放弃当前草稿，是否继续？')) onTrashView(); }}>前往回收站恢复</button>}
      </div>}
      <footer className="modal-footer"><span className="muted">{dirty ? '草稿尚未保存' : '仅你可见'}</span><button type="button" disabled={busy} onClick={close}>取消</button><button className="primary" type="submit" disabled={busy}><Save size={16} />{command.pending ? '正在保存…' : '保存收藏'}</button></footer>
    </form>
  </Modal>;
}
