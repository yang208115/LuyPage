import { useState } from 'react';
import { Check, FolderInput, Tags, Trash2 } from 'lucide-react';
import { batchInputSchema, type BatchAction, type BatchResult, type Bookmark, type Group, type Tag } from '@luypage/contracts';
import { useCommand } from './api';
import { useSession } from './session';
import { ErrorNotice, Modal } from './ui';

export function BatchEditor({ selected, latest, groups, tags, trash, onRefresh, onSelection, onClose }: {
  selected: Bookmark[]; latest: Bookmark[]; groups: Group[]; tags: Tag[]; trash: boolean;
  onRefresh: () => void; onSelection: (ids: string[]) => void; onClose: () => void;
}) {
  const { send } = useSession();
  const command = useCommand(send);
  const [items, setItems] = useState(selected);
  const [action, setAction] = useState<BatchAction>(trash ? 'restore' : 'move');
  const [groupId, setGroupId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [validation, setValidation] = useState<Error | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  async function apply() {
    const input = { action, items: items.map(({ id, version }) => ({ id, version })), ...(action === 'move' ? { groupId: groupId || null } : {}), ...(['addTags', 'removeTags'].includes(action) ? { tagIds } : {}) };
    const parsed = batchInputSchema.safeParse({ ...input, operationId: crypto.randomUUID() });
    if (!parsed.success) { setValidation(new Error(parsed.error.issues.map(issue => issue.message).join('；'))); return; }
    setValidation(null);
    try {
      const outcome = await command.execute<BatchResult>('/api/bookmarks/batch', 'POST', input);
      setResult(outcome);
      const failed = new Set(outcome.items.filter(item => !item.success).map(item => item.id));
      setItems(current => current.filter(item => failed.has(item.id)));
      onSelection([...failed]); onRefresh();
      setConfirmed(false);
    } catch { /* Preserve selected versions and operation ID when the outcome is unknown. */ }
  }
  return <Modal title="批量整理" subtitle={`本次仅处理明确选择的 ${selected.length} 条收藏，不包含尚未加载的结果。`} onClose={() => { if (!command.pending) onClose(); }}>
    <fieldset disabled={command.pending || items.length === 0}>
      <label className="field"><span>操作</span><select value={action} onChange={event => { setAction(event.target.value as BatchAction); setConfirmed(false); setResult(null); command.clearError(); }}>
        {trash ? <><option value="restore">恢复所选收藏</option><option value="delete">永久删除所选收藏</option></> : <><option value="move">移动到分组</option><option value="addTags">添加指定标签</option><option value="removeTags">移除指定标签</option><option value="trash">移入回收站</option></>}
      </select></label>
      {action === 'move' && <label className="field"><span><FolderInput size={15} />目标分组</span><select value={groupId} onChange={event => setGroupId(event.target.value)}><option value="">未分组</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
      {['addTags', 'removeTags'].includes(action) && <div className="field"><span><Tags size={15} />选择标签</span><div className="tag-choices">{tags.map(tag => <button key={tag.id} className={`chip ${tagIds.includes(tag.id) ? 'selected' : ''}`} aria-pressed={tagIds.includes(tag.id)} onClick={() => setTagIds(current => current.includes(tag.id) ? current.filter(id => id !== tag.id) : [...current, tag.id])}>{tagIds.includes(tag.id) && <Check size={12} />}{tag.name}</button>)}</div><small>仅{action === 'addTags' ? '添加' : '移除'}选中标签，其他标签保持不变。</small></div>}
      {action === 'delete' && <div className="delete-confirm"><strong><Trash2 size={17} />永久删除 {items.length} 条收藏</strong><p>这些收藏及其信息将无法恢复。</p><label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我确认永久删除这 {items.length} 条收藏</label></div>}
    </fieldset>
    <ErrorNotice error={validation || command.error} />
    {result && <div className={`notice ${result.failed ? 'warning' : 'success'}`} role="status"><div><strong>本次成功 {result.succeeded} 条，失败 {result.failed} 条</strong>{result.failed > 0 && <><p>失败条目仍选中，可检查原因后重试。</p><ul>{result.items.filter(item => !item.success).map(item => <li key={item.id}>{selected.find(bookmark => bookmark.id === item.id)?.title ?? '收藏'}：{item.message || item.code || '未完成'}</li>)}</ul><button className="small" onClick={() => {
      if (window.confirm('使用最新读取的版本重新确认失败项？请先检查其他设备的修改。')) setItems(current => current.map(item => latest.find(bookmark => bookmark.id === item.id) ?? item));
    }}>使用最新版本重新确认</button></>}</div></div>}
    <footer className="modal-footer"><button disabled={command.pending} onClick={onClose}>{items.length ? '关闭' : '完成'}</button>{items.length > 0 && <button className={action === 'delete' ? 'danger solid' : 'primary'} disabled={command.pending || action === 'delete' && !confirmed} onClick={() => void apply()}>{command.pending ? '正在处理…' : result?.failed ? `重试 ${items.length} 条失败项` : `确认处理 ${items.length} 条`}</button>}</footer>
  </Modal>;
}
