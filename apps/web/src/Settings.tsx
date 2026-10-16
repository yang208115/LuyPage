import { useState } from 'react';
import { useCommand } from './api';
import { useWorkspace } from './data';
import { TransferSettings } from './TransferSettings';
import { Folder, Image, LogOut, Monitor, ShieldCheck, Tags } from 'lucide-react';
import { useSession } from './session';
import { ErrorNotice, Modal } from './ui';

export function Settings({ onClose, onManage, onLayout }: { onClose: () => void; onManage: (type: 'groups' | 'tags') => void; onLayout: () => void }) {
  const { session, logout, send } = useSession();
  const { bootstrap, freshLayout, refresh } = useWorkspace(true, false);
  const command = useCommand(send);
  const [transferBusy, setTransferBusy] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  const [pendingIcons, setPendingIcons] = useState<boolean | null>(null);
  const [iconError, setIconError] = useState<Error | null>(null);
  const busy = transferBusy || iconBusy;
  async function toggleIcons(enabled: boolean) {
    setIconBusy(true); setPendingIcons(enabled); setIconError(null);
    try {
      const layout = await freshLayout();
      await command.execute('/api/layout', 'PUT', { baseRevision: layout.revision, operations: [], preferences: { ...layout.preferences, autoIcons: enabled } });
      await refresh();
    } catch (cause) { setIconError(cause instanceof Error ? cause : new Error('设置保存失败。')); }
    finally { setIconBusy(false); setPendingIcons(null); }
  }
  return <Modal title="设置" subtitle="你的私人空间，由你打理。" onClose={() => { if (!busy) onClose(); }}>
    <section className="settings-section"><h3>收藏与外观</h3><button className="settings-row" disabled={busy} onClick={() => onManage('groups')}><Folder size={19} /><span>分组管理<small>创建、改名和删除分组</small></span></button><button className="settings-row" disabled={busy} onClick={() => onManage('tags')}><Tags size={19} /><span>标签管理<small>为收藏添加跨分组的线索</small></span></button><button className="settings-row" disabled={busy} onClick={onLayout}><Monitor size={19} /><span>收藏布局<small>列数、密度、折叠与手动顺序</small></span></button></section>
    <TransferSettings onBusy={setTransferBusy} />
    <section className="settings-section"><h3><Image size={17} />自动网站图标</h3><p>开启后通过 DuckDuckGo 获取网站图标，仅发送域名；获取失败时使用默认图标。内置图标不受影响。</p><label className="checkbox-label"><input type="checkbox" disabled={busy || !bootstrap.data} checked={pendingIcons ?? bootstrap.data?.preferences.autoIcons ?? false} onChange={event => void toggleIcons(event.target.checked)} />自动获取网站图标</label>{iconBusy && <p role="status">正在保存图标设置…</p>}<ErrorNotice error={iconError || bootstrap.error} /></section>
    <section className="settings-section"><h3><ShieldCheck size={17} />账号与隐私</h3><div className="account-detail"><strong>{session.user.displayName}</strong><span className="status-tag">{session.local ? '本地开发身份' : '私有账号'}</span></div><p>{session.local ? '当前由 localhost 本地服务提供固定身份；生产认证尚未配置。' : '收藏仅对当前账号可见。退出后清除本页私有缓存、选择和草稿。'}</p><p>已保存的本地背景图库会保留在当前浏览器，重新登录同一账号可继续使用；清除网站数据会删除图库。</p><button className="danger" disabled={busy} onClick={() => { if (window.confirm('确认退出登录？当前页面的私有缓存与草稿将被清除。')) logout(); }}><LogOut size={16} />退出登录</button></section>
  </Modal>;
}
