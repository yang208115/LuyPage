import { useState, type FormEvent } from 'react';
import { Check, Folder, Pencil, Plus, Tag as TagIcon, Trash2, X } from 'lucide-react';
import { nameInputSchema, type Group, type Tag } from '@luypage/contracts';
import { useCommand } from './api';
import { useSession } from './session';
import { ErrorNotice, Modal, useBeforeUnload } from './ui';

export function CollectionManager({ groups, tags, initialTab, onRefresh, onClose }: {
  groups: Group[]; tags: Tag[]; initialTab: 'groups' | 'tags'; onRefresh: () => void; onClose: () => void;
}) {
  const { send } = useSession();
  const command = useCommand(send);
  const [tab, setTab] = useState(initialTab);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Group | Tag | null>(null);
  const [rename, setRename] = useState('');
  const [deleting, setDeleting] = useState<Group | Tag | null>(null);
  const [impact, setImpact] = useState<{ active: number; trash: number; total: number } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<Error | null>(null);
  const [validation, setValidation] = useState<Error | null>(null);
  const dirty = name.length > 0 || !!editing && rename !== editing.name;
  useBeforeUnload(dirty);
  const close = () => { if (!command.pending && (!dirty || window.confirm('放弃尚未保存的名称修改？'))) onClose(); };
  const items = tab === 'groups' ? groups : tags;
  function valid(value: string): boolean {
    const result = nameInputSchema.shape.name.safeParse(value);
    if (!result.success) { setValidation(new Error(result.error.issues.map(issue => issue.message).join('；'))); return false; }
    setValidation(null); return true;
  }
  async function create(event: FormEvent) {
    event.preventDefault(); if (!valid(name)) return;
    try { await command.execute(`/api/${tab}`, 'POST', { name: name.trim() }); setName(''); onRefresh(); } catch { /* Retain input. */ }
  }
  async function saveName() {
    if (!editing || !valid(rename)) return;
    try { await command.execute(`/api/${tab}/${encodeURIComponent(editing.id)}`, 'PATCH', { name: rename.trim(), version: editing.version }); setEditing(null); onRefresh(); } catch { onRefresh(); }
  }
  async function remove() {
    if (!deleting || !impact) return;
    try { await command.execute(`/api/${tab}/${encodeURIComponent(deleting.id)}`, 'DELETE', { version: deleting.version }); setDeleting(null); onRefresh(); } catch { onRefresh(); }
  }
  async function requestDelete(item: Group | Tag) {
    setDeleting(item); setImpact(null); setImpactError(null); setImpactLoading(true); command.clearError();
    try { setImpact(await send<{ active: number; trash: number; total: number }>(`/api/${tab}/${encodeURIComponent(item.id)}/impact`)); }
    catch (cause) { setImpactError(cause instanceof Error ? cause : new Error('无法读取影响数量。')); }
    finally { setImpactLoading(false); }
  }
  return <Modal title="整理你的收藏目录" subtitle="分组让收藏各归其位，标签让灵感彼此相连。" onClose={close}>
    <div className="tabs" role="tablist" aria-label="管理类别">{(['groups', 'tags'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} disabled={command.pending} className={tab === value ? 'active' : ''} onClick={() => {
      if (tab === value || dirty && !window.confirm('切换类别将放弃尚未保存的名称，是否继续？')) return;
      setTab(value); setName(''); setEditing(null); setDeleting(null); command.clearError(); setValidation(null);
    }}>{value === 'groups' ? <Folder size={16} /> : <TagIcon size={16} />}{value === 'groups' ? '分组管理' : '标签管理'}</button>)}</div>
    <form className="inline-create manager-create" onSubmit={event => void create(event)}><input aria-label={tab === 'groups' ? '新分组名称' : '新标签名称'} placeholder={tab === 'groups' ? '新分组名称' : '新标签名称'} value={name} disabled={command.pending} onChange={event => setName(event.target.value)} /><button type="submit" className="primary" disabled={command.pending || !name.trim()}><Plus size={16} />创建</button></form>
    <ErrorNotice error={validation || command.error} />
    {deleting && <section className="delete-confirm" role="alert"><strong>确认删除“{deleting.name}”？</strong>
      {impactLoading && <p>正在读取有效收藏与回收站的影响数量…</p>}
      <ErrorNotice error={impactError} retry={() => void requestDelete(deleting)} />
      {impact && <p>共影响 {impact.total} 条收藏（有效 {impact.active} 条，回收站 {impact.trash} 条）。{tab === 'groups' ? '这些收藏将移入未分组，收藏本身不会删除。' : '仅移除这些收藏的标签关联，收藏本身不会删除。'}</p>}
      <div className="button-row"><button disabled={command.pending || impactLoading} onClick={() => setDeleting(null)}>取消</button><button className="danger" disabled={command.pending || !impact || impactLoading} onClick={() => void remove()}>确认删除{tab === 'groups' ? '分组' : '标签'}</button></div></section>}
    <fieldset disabled={impactLoading}><div className="manager-list">{items.length ? items.map(item => <div className="manager-row" key={item.id}>
      {tab === 'groups' ? <Folder size={18} /> : <TagIcon size={18} />}
      {editing?.id === item.id ? <form className="rename-form" onSubmit={event => { event.preventDefault(); void saveName(); }}><input aria-label="新名称" autoFocus value={rename} onChange={event => setRename(event.target.value)} disabled={command.pending} /><button className="icon-button" type="submit" aria-label="保存名称" disabled={command.pending}><Check size={17} /></button><button type="button" className="icon-button" aria-label="取消改名" disabled={command.pending} onClick={() => setEditing(null)}><X size={17} /></button></form> : <><span className="manager-name">{item.name}<small>{item.count} 条收藏</small></span><button className="icon-button" aria-label={`重命名${item.name}`} disabled={command.pending} onClick={() => { setEditing(item); setRename(item.name); setDeleting(null); command.clearError(); }}><Pencil size={16} /></button><button className="icon-button danger" aria-label={`删除${item.name}`} disabled={command.pending} onClick={() => void requestDelete(item)}><Trash2 size={16} /></button></>}
    </div>) : <p className="muted manager-empty">还没有{tab === 'groups' ? '分组' : '标签'}，从上方创建第一个吧。</p>}</div></fieldset>
    <p className="form-hint">{tab === 'groups' ? '“未分组”是系统区域，始终保留；分组顺序可在首页「编辑布局」中调整。' : '一条收藏可以有多个标签；筛选多个标签时需同时包含全部标签。'}</p>
    <footer className="modal-footer"><button onClick={close} disabled={command.pending}>完成</button></footer>
  </Modal>;
}
