import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, Bookmark, BookOpen, Code2, Compass, Folder, Globe2, Heart, Image, Layers3, Music2, Palette, Search, ShieldCheck, Sparkles, Terminal, X, type LucideIcon } from 'lucide-react';
import type { Bookmark as BookmarkData } from '@luypage/contracts';
import { ApiError } from './api';
import { SessionNotice } from './session';

export const BUILTIN_ICONS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'globe', label: '网站', icon: Globe2 }, { key: 'code', label: '开发', icon: Code2 },
  { key: 'book', label: '阅读', icon: BookOpen }, { key: 'palette', label: '设计', icon: Palette },
  { key: 'terminal', label: '终端', icon: Terminal }, { key: 'music', label: '音乐', icon: Music2 },
  { key: 'heart', label: '喜欢', icon: Heart }, { key: 'compass', label: '探索', icon: Compass },
  { key: 'layers', label: '工具', icon: Layers3 }, { key: 'image', label: '图片', icon: Image },
  { key: 'sparkles', label: '灵感', icon: Sparkles }, { key: 'shield', label: '安全', icon: ShieldCheck },
];

export function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '网址'; }
}
export function safeWebsite(url: string): string | undefined {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : undefined; }
  catch { return undefined; }
}
export function BookmarkIcon({ bookmark }: { bookmark: BookmarkData }) {
  const entry = BUILTIN_ICONS.find(icon => icon.key === bookmark.icon.key);
  const Glyph = entry?.icon;
  const hostname = domainOf(bookmark.url);
  const tone = [...hostname].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  return <span className={`site-icon tone-${tone}`} aria-hidden="true">
    {bookmark.icon.type === 'builtin' && Glyph ? <Glyph size={25} strokeWidth={1.8} /> : <span>{hostname.charAt(0).toUpperCase() || '↗'}</span>}
  </span>;
}

export function useBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

export function Modal({ title, subtitle, children, onClose, wide = false, className = '' }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const label = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''} ${className}`} aria-labelledby={label}
    onCancel={event => { event.preventDefault(); close.current(); }}>
    <header className="modal-heading"><div><h2 id={label}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button>
    </header>
    <SessionNotice />
    {children}
  </dialog>;
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  const conflict = error instanceof ApiError && error.status === 409;
  return <div className="notice error" role="alert"><AlertCircle size={19} /><div>
    <strong>{conflict ? '内容有冲突，尚未保存' : '操作未完成'}</strong>
    <p>{error instanceof Error ? error.message : '请稍后重试。'}</p>
    {conflict && <p>当前输入仍保留。请查看最新数据后再决定如何修改，不会自动覆盖其他设备的更改。</p>}
    {error instanceof ApiError && error.requestId && <small>请求编号：{error.requestId}</small>}
    {retry && <button className="small" onClick={retry}>重新加载</button>}
  </div></div>;
}

export function EmptyState({ type = 'bookmarks', title, description, action, label }: {
  type?: 'bookmarks' | 'search' | 'group'; title: string; description: string; action?: () => void; label?: string;
}) {
  const Icon = type === 'search' ? Search : type === 'group' ? Folder : Bookmark;
  return <div className="empty-state"><div className="empty-art"><span /><Icon size={38} strokeWidth={1.35} /><ArrowUpRight size={18} className="empty-arrow" /></div>
    <h2>{title}</h2><p>{description}</p>{action && <button className="primary" onClick={action}>{label}</button>}
  </div>;
}

export function LoadingCards() {
  return <div className="card-grid" aria-label="正在加载收藏" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div className="skeleton-card" key={i}><span /><i /><i /></div>)}</div>;
}

export interface Confirmation {
  title: string; description: string; label: string; danger?: boolean; run: () => Promise<void>;
}
export function ConfirmDialog({ confirmation, pending, error, onClose }: {
  confirmation: Confirmation; pending: boolean; error: unknown; onClose: () => void;
}) {
  return <Modal title={confirmation.title} onClose={() => { if (!pending) onClose(); }}>
    <p className="confirm-copy">{confirmation.description}</p>
    <ErrorNotice error={error} />
    <footer className="modal-footer"><button disabled={pending} onClick={onClose}>取消</button>
      <button className={confirmation.danger ? 'danger solid' : 'primary'} disabled={pending} onClick={() => void confirmation.run().catch(() => undefined)}>{pending ? '正在处理…' : confirmation.label}</button>
    </footer>
  </Modal>;
}
