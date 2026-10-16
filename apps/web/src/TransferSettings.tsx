import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { bookmarksHtml, MAX_TRANSFER_BYTES, type ImportResult, type TransferDocument } from '@luypage/contracts';
import { useSession } from './session';
import { useCommand } from './api';
import { useWorkspace } from './data';
import { ErrorNotice, useBeforeUnload } from './ui';
import { downloadFile, readImportFile, type ImportPreview } from './transfers';

export function TransferSettings({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const { send } = useSession(); const { refresh } = useWorkspace(false, false);
  const command = useCommand(send); const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState(''); const [format, setFormat] = useState<'json' | 'html'>('json');
  useBeforeUnload(busy);
  function working(value: boolean) { setBusy(value); onBusy(value); }
  async function choose(file: File) {
    working(true); setError(null); setMessage(''); setPreview(null); command.clearError();
    try { setPreview(await readImportFile(file)); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error('无法读取文件。')); }
    finally { working(false); }
  }
  async function confirmImport() {
    if (!preview || busy) return;
    working(true); setError(null);
    try {
      const result = await command.execute<ImportResult>('/api/imports', 'POST', { document: preview.document });
      setMessage(`导入完成：新增 ${result.imported} 条，跳过 ${result.skipped} 条重复链接${preview.ignored ? `及 ${preview.ignored} 条非 HTTP / HTTPS 书签` : ''}。`);
      setPreview(null); await refresh();
    } catch { /* Preserve the preview and command ID for retry after a lost response. */ }
    finally { working(false); }
  }
  async function exportFile() {
    if (busy) return;
    working(true); setError(null); setMessage(''); command.clearError();
    try {
      const document = await send<TransferDocument>('/api/exports');
      const content = format === 'json' ? JSON.stringify(document) : bookmarksHtml(document);
      if (new TextEncoder().encode(content).length > MAX_TRANSFER_BYTES) throw new Error('文件超过 10 MiB，请尝试 JSON 格式。');
      downloadFile(content, `luypage-bookmarks-${new Date().toISOString().slice(0, 10)}.${format}`, format === 'json' ? 'application/json;charset=utf-8' : 'text/html;charset=utf-8');
      setMessage(`已生成 ${document.bookmarks.length} 条收藏的 ${format.toUpperCase()} 文件。`);
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('导出失败，请重试。')); }
    finally { working(false); }
  }
  return <section className="settings-section"><h3>数据迁移</h3>
    <p>导入浏览器书签 HTML 或 LuyPage JSON。单次最多 5000 条、10 MiB；导出全部有效收藏，不含回收站与页面布局。</p>
    <input ref={fileInput} type="file" accept=".html,.htm,.json,text/html,application/json" aria-label="选择书签文件" hidden disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void choose(file); }} />
    <div className="button-row"><button disabled={busy} onClick={() => fileInput.current?.click()}><ArrowUpFromLine size={16} />导入书签</button>
      <select aria-label="导出格式" value={format} disabled={busy} onChange={event => setFormat(event.target.value as 'json' | 'html')}><option value="json">JSON</option><option value="html">HTML</option></select>
      <button disabled={busy} onClick={() => void exportFile()}><ArrowDownToLine size={16} />导出收藏</button></div>
    {preview && <div className="transfer-preview"><strong className="wrap-anywhere">{preview.filename}</strong><p>待导入 {preview.document.bookmarks.length} 条收藏、{preview.document.groups.length} 个分组、{preview.document.tags.length} 个标签。{preview.ignored > 0 && `忽略 ${preview.ignored} 条非 HTTP / HTTPS 书签。`}</p>
      <p>同名分组和标签将合并；已有链接（含回收站）将跳过，保留原有内容。嵌套文件夹按路径合并为分组。</p>
      <ul>{preview.document.bookmarks.slice(0, 5).map((item, index) => <li key={index}>{item.title || item.url}</li>)}</ul>
      <div className="button-row"><button className="primary" disabled={busy || !preview.document.bookmarks.length} onClick={() => void confirmImport()}>确认导入</button><button disabled={busy} onClick={() => { setPreview(null); command.clearError(); }}>取消导入</button></div></div>}
    {(busy || message) && <p role="status">{busy ? '正在处理，请稍候…' : message}</p>}
    <ErrorNotice error={error || command.error} />
  </section>;
}
