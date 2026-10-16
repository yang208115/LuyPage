import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, LoaderCircle, LockKeyhole, RefreshCw } from 'lucide-react';
import type { Session } from '@luypage/contracts';
import { ApiError, isAuthenticationError, request, type PrivateRequest } from './api';

interface SessionContextValue {
  session: Session; expired: boolean; checking: boolean;
  send: PrivateRequest; verify: () => Promise<Session>; logout: () => void;
}
const SessionContext = createContext<SessionContextValue | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('缺少会话上下文');
  return value;
}

export function SessionBoundary({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const current = useRef<Session | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [expired, setExpired] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loggedOut, setLoggedOut] = useState(false);
  const [identityChanged, setIdentityChanged] = useState(false);
  const verification = useRef<Promise<Session> | null>(null);
  const generation = useRef(0);

  const verify = useCallback((): Promise<Session> => {
    if (verification.current) return verification.current;
    const startedAt = generation.current;
    setChecking(true);
    const work = request<Session>('/api/session').then(next => {
      if (generation.current !== startedAt) throw new ApiError('会话已结束。', 'SESSION_ENDED', 401);
      if (current.current && next.user.id !== current.current.user.id) {
        void client.cancelQueries();
        client.clear();
        setIdentityChanged(true);
      }
      current.current = next;
      setSession(next); setExpired(false); setError(null); setLoggedOut(false);
      return next;
    }).catch((cause: unknown) => {
      if (generation.current === startedAt) {
        setError(cause instanceof Error ? cause : new Error('无法确认身份。'));
        if (isAuthenticationError(cause)) setExpired(true);
      }
      throw cause;
    }).finally(() => { verification.current = null; setChecking(false); });
    verification.current = work;
    return work;
  }, [client]);

  useEffect(() => {
    void verify().catch(() => undefined);
    const recheck = () => { if (document.visibilityState === 'visible' && current.current) void verify().catch(() => undefined); };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => { window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck); };
  }, [verify]);

  const owner = session?.user.id;
  const send = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const identity = await verify();
    if (identity.user.id !== owner) throw new ApiError('登录身份已变化，已清除前一身份的内容与草稿。', 'IDENTITY_CHANGED', 401);
    try {
      const result = await request<T>(path, init);
      if (current.current?.user.id !== owner) throw new ApiError('身份已变化，请重新打开当前内容。', 'IDENTITY_CHANGED', 401);
      return result;
    } catch (cause) {
      if (isAuthenticationError(cause) && current.current?.user.id === owner) setExpired(true);
      throw cause;
    }
  }, [owner, verify]);

  function logout() {
    const url = current.current?.logoutUrl;
    generation.current += 1;
    current.current = null;
    void client.cancelQueries(); client.clear();
    setSession(null); setExpired(false); setError(null); setLoggedOut(true);
    window.history.replaceState(null, '', window.location.pathname);
    if (url) window.location.assign(url);
  }

  if (!session) return <main className="session-screen">
    <div className="session-card">
      <div className="brand-mark"><LockKeyhole size={26} /></div>
      <p className="eyebrow">LUYPAGE · 私人导航</p>
      <h1>{checking ? '正在打开你的小世界' : loggedOut ? '已退出登录' : '先确认是你，再打开收藏'}</h1>
      <p>{checking ? '正在安全地连接你的收藏空间…' : error?.message || '私有内容与草稿已从当前页面清除。'}</p>
      {checking ? <LoaderCircle className="spin" aria-label="正在连接" /> : <div className="button-row">
        <a className="button primary" href="/cdn-cgi/access/login" target="_blank" rel="noreferrer"><ArrowUpRight size={16} />新窗口登录</a>
        <button onClick={() => void verify().catch(() => undefined)}><RefreshCw size={16} />重新检查</button>
      </div>}
      {!checking && <small>生产认证尚未配置时无法进入。开发环境请使用 localhost 的本地服务。</small>}
    </div>
  </main>;

  return <SessionContext.Provider value={{ session, expired, checking, send, verify, logout }}>
    <div key={session.user.id}>
      {identityChanged && <div className="identity-notice" role="status">已切换登录身份，前一身份的缓存、选择和草稿已清除。<button onClick={() => setIdentityChanged(false)}>知道了</button></div>}
      {children}
    </div>
  </SessionContext.Provider>;
}

export function SessionNotice() {
  const { session, expired, checking, verify } = useSession();
  if (!expired) return null;
  return <div className="notice warning" role="alert">
    <LockKeyhole size={20} />
    <div><strong>需要重新认证</strong><p>当前表单与布局草稿仍保留。请在新窗口登录同一账号，再返回检查会话；切换账号会清除旧草稿。</p>
      <div className="button-row">
        <a className="button small" href={session.loginUrl} target="_blank" rel="noreferrer">新窗口重新认证<ArrowUpRight size={14} /></a>
        <button className="small" disabled={checking} onClick={() => void verify().catch(() => undefined)}>{checking ? '正在检查…' : '我已登录，检查会话'}</button>
      </div>
    </div>
  </div>;
}
