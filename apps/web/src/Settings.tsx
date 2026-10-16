import { ArrowDownToLine, ArrowUpFromLine, Folder, ImageOff, LogOut, Monitor, ShieldCheck, Tags } from 'lucide-react';
import { useSession } from './session';
import { Modal } from './ui';

export function Settings({ onClose, onManage, onLayout }: { onClose: () => void; onManage: (type: 'groups' | 'tags') => void; onLayout: () => void }) {
  const { session, logout } = useSession();
  return <Modal title="设置" subtitle="你的私人空间，由你打理。" onClose={onClose}>
    <section className="settings-section"><h3>收藏与外观</h3><button className="settings-row" onClick={() => onManage('groups')}><Folder size={19} /><span>分组管理<small>创建、改名和删除分组</small></span></button><button className="settings-row" onClick={() => onManage('tags')}><Tags size={19} /><span>标签管理<small>为收藏添加跨分组的线索</small></span></button><button className="settings-row" onClick={onLayout}><Monitor size={19} /><span>收藏布局<small>列数、密度、折叠与手动顺序</small></span></button></section>
    <section className="settings-section"><h3>数据迁移 <span className="status-tag">暂不可用</span></h3><p>当前版本暂不支持 HTML / JSON 导入导出，请稍后使用此功能。</p><div className="button-row"><button disabled><ArrowUpFromLine size={16} />导入书签</button><button disabled><ArrowDownToLine size={16} />导出收藏</button></div></section>
    <section className="settings-section"><h3><ImageOff size={17} />自动网站图标 <span className="status-tag">暂不可用</span></h3><p>当前使用域名首字母或内置图标，自动网站图标暂不可用。</p><label className="checkbox-label"><input type="checkbox" disabled checked={false} readOnly />自动获取网站图标</label></section>
    <section className="settings-section"><h3><ShieldCheck size={17} />账号与隐私</h3><div className="account-detail"><strong>{session.user.displayName}</strong><span className="status-tag">{session.local ? '本地开发身份' : '私有账号'}</span></div><p>{session.local ? '当前由 localhost 本地服务提供固定身份；生产认证尚未配置。' : '收藏仅对当前账号可见。退出后清除本页私有缓存、选择和草稿。'}</p><p>已保存的本地背景图库会保留在当前浏览器，重新登录同一账号可继续使用；清除网站数据会删除图库。</p><button className="danger" onClick={() => { if (window.confirm('确认退出登录？当前页面的私有缓存与草稿将被清除。')) logout(); }}><LogOut size={16} />退出登录</button></section>
  </Modal>;
}
