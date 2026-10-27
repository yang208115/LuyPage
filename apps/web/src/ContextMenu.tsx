import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, X, type LucideIcon } from 'lucide-react';
import './context-menu.css';

export interface ContextMenuItem {
  label: string;
  icon: LucideIcon;
  href?: string;
  newTab?: boolean;
  run?: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}
type MenuEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;
interface MenuState {
  x: number; y: number; title: string; items: ContextMenuItem[];
  trigger: HTMLElement; container: HTMLElement;
}
interface MenuContext {
  open: (event: MenuEvent, title: string, items: ContextMenuItem[]) => void;
  notify: (message: string, error?: boolean) => void;
}
const Context = createContext<MenuContext | null>(null);

export function isContextMenuKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10';
}
export function useContextMenu(): MenuContext {
  const context = useContext(Context);
  if (!context) throw new Error('右键菜单缺少 ContextMenuProvider。');
  return context;
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean; container: HTMLElement } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const noticeContainer = useRef<HTMLElement | null>(null);
  const notify = (message: string, error = false) => setNotice({ message, error, container: noticeContainer.current?.isConnected ? noticeContainer.current : document.body });
  function close(restoreFocus = true) {
    if (restoreFocus && menu?.trigger.isConnected) menu.trigger.focus({ preventScroll: true });
    setMenu(null);
  }
  function open(event: MenuEvent, title: string, items: ContextMenuItem[]) {
    if ('button' in event && event.shiftKey && event.button === 2) return;
    event.preventDefault(); event.stopPropagation();
    const origin = event.currentTarget;
    const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>('a, button, [tabindex]') ?? origin : origin;
    const rect = trigger.getBoundingClientRect();
    const pointer = 'clientX' in event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && (event.clientX !== 0 || event.clientY !== 0);
    const container = origin.closest<HTMLDialogElement>('dialog[open]') ?? document.body;
    noticeContainer.current = container;
    setMenu({ title, items, trigger, container,
      x: pointer ? event.clientX : rect.left, y: pointer ? event.clientY : rect.bottom });
  }
  useLayoutEffect(() => {
    if (!menu || !panel.current) return;
    const element = panel.current;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) setMenu(null); };
    const dismiss = () => setMenu(null);
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) dismiss(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    // Opening a menu can follow a scroll that revealed its trigger; ignore that queued event.
    const frame = window.requestAnimationFrame(() => window.addEventListener('scroll', scroll, true));
    window.addEventListener('wheel', scroll, true);
    window.addEventListener('touchmove', scroll, true);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss);
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('wheel', scroll, true);
      window.removeEventListener('touchmove', scroll, true);
      window.removeEventListener('blur', dismiss);
    };
  }, [menu]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next !== null) { event.preventDefault(); items[next]?.focus(); }
  }
  function choose(item: ContextMenuItem) {
    close();
    if (item.run) {
      try { void Promise.resolve(item.run()).catch(cause => notify(cause instanceof Error ? cause.message : '操作未完成，请重试。', true)); }
      catch (cause) { notify(cause instanceof Error ? cause.message : '操作未完成，请重试。', true); }
    }
  }
  return <Context.Provider value={{ open, notify }}>{children}
    {menu && createPortal(<div ref={panel} className="context-menu" role="menu" aria-label={`${menu.title}的右键菜单`} style={{ left: menu.x, top: menu.y }} onKeyDown={keyboard} onContextMenu={event => event.preventDefault()}>
      <div className="context-menu-title" title={menu.title}>{menu.title}</div>
      {menu.items.map((item, index) => <div role="none" key={`${index}:${item.label}`}>
        {item.divider && <div role="separator" className="context-menu-separator" />}
        {item.href && !item.disabled ? <a role="menuitem" href={item.href} target={item.newTab ? '_blank' : undefined} rel={item.newTab ? 'noopener noreferrer' : undefined} onClick={() => choose(item)}><item.icon size={16} aria-hidden="true" />{item.label}</a>
          : <button role="menuitem" type="button" disabled={item.disabled} className={item.danger ? 'context-menu-danger' : ''} onClick={() => choose(item)}><item.icon size={16} aria-hidden="true" />{item.label}</button>}
      </div>)}
    </div>, menu.container)}
    {notice && createPortal(<div className="toast context-menu-toast" role={notice.error ? 'alert' : 'status'}>{notice.error ? <AlertCircle size={17} /> : <Check size={17} />}<span>{notice.message}</span><button aria-label="关闭右键操作提示" onClick={() => setNotice(null)}><X size={14} /></button></div>, notice.container.isConnected ? notice.container : document.body)}
  </Context.Provider>;
}
