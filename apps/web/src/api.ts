import { useRef, useState } from 'react';
import type { ApiErrorBody } from '@luypage/contracts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code = 'NETWORK_ERROR',
    readonly status = 0,
    readonly requestId?: string,
    readonly details?: unknown,
  ) { super(message); this.name = 'ApiError'; }
}

export const isAuthenticationError = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store', ...init, redirect: 'manual',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('连接未完成，请检查网络后重试。若登录已过期，请重新认证；当前草稿仍保留。');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (response.status === 401 || response.redirected || response.type === 'opaqueredirect' || contentType.includes('text/html')) {
    throw new ApiError('会话已失效或请求被转到登录页。请在新窗口重新认证，然后返回继续。', 'AUTH_REQUIRED', 401);
  }
  if (!contentType.includes('application/json')) {
    throw new ApiError('服务返回了无法识别的响应，请稍后重试。', 'INVALID_RESPONSE', response.status);
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ApiError('服务响应不完整，请重试。', 'INVALID_RESPONSE', response.status); }
  if (!response.ok) {
    const envelope = body as Partial<ApiErrorBody> | null;
    const error = envelope?.error;
    throw new ApiError(error?.message || '操作未完成，请稍后重试。', error?.code || 'REQUEST_FAILED', response.status, error?.requestId, error?.details);
  }
  return body as T;
}

export type PrivateRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

// Keep the exact operation ID after an uncertain response; a changed payload is a new intent.
export function useCommand(send: PrivateRequest) {
  const receipt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function execute<T>(path: string, method: string, input: object): Promise<T> {
    if (inFlight.current) throw new ApiError('操作正在进行，请稍候。', 'BUSY');
    const fingerprint = JSON.stringify([path, method, input]);
    if (receipt.current?.fingerprint !== fingerprint) {
      receipt.current = { fingerprint, operationId: crypto.randomUUID() };
    }
    inFlight.current = true; setPending(true); setError(null);
    try {
      const result = await send<T>(path, { method, body: JSON.stringify({ ...input, operationId: receipt.current.operationId }) });
      receipt.current = null;
      return result;
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error('操作未完成。');
      setError(failure); throw failure;
    } finally { inFlight.current = false; setPending(false); }
  }
  return { execute, pending, error, clearError: () => setError(null) };
}
