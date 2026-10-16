import { Check, Trash2 } from 'lucide-react';
import { galleryBytes, type WallpaperDraft, type WallpaperItem } from './wallpaper-model';
import { useBlobUrl } from './use-wallpaper';

function WallpaperThumbnail({ item, selected, onSelect, onDelete }: {
  item: WallpaperItem; selected: boolean; onSelect: () => void; onDelete: () => void;
}) {
  const url = useBlobUrl(item.thumbnail);
  return <div className="local-wallpaper-card">
    <button className={`wallpaper-option ${selected ? 'chosen' : ''}`} aria-label={`使用背景：${item.name}`} aria-pressed={selected} onClick={onSelect}>
      {url && <img src={url} alt="" width="240" height="135" />}
      <span><span title={item.name}>{item.name}</span>{selected && <Check size={15} />}</span>
    </button>
    <button className="local-wallpaper-delete" aria-label={`删除背景：${item.name}`} onClick={onDelete}><Trash2 size={14} />删除</button>
  </div>;
}
export function WallpaperGallery({ draft, importing, errors, onImport, onSelect, onDelete }: {
  draft: WallpaperDraft | null; importing: boolean; errors: string[];
  onImport: (files: File[]) => void; onSelect: (id: string) => void; onDelete: (id: string) => void;
}) {
  return <section className="home-settings-section local-wallpaper-gallery" aria-label="本地图库">
    <h3>本地图库{draft && <small>{draft.items.length} 张 · {(galleryBytes(draft.items) / 1024 / 1024).toFixed(1)} / 100 MiB</small>}</h3>
    <p className="form-hint">图片仅保存在当前浏览器，不随账号同步。清除网站数据会删除图库。</p>
    <label className="field"><span>导入背景图片</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={!draft || importing} onChange={event => {
      const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) onImport(files);
    }} /></label>
    <p className="form-hint">支持 JPEG、PNG、WebP、GIF，单张原图最多 20 MiB、4000 万像素。自动压缩为静态 WebP，动态图仅保留首帧。导入与删除在保存后生效。</p>
    {importing && <p role="status">正在压缩背景图片…</p>}
    {!!errors.length && <div className="notice error" role="alert"><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
    {draft && !draft.items.length && <p className="form-hint">还没有本地图片，选择喜欢的风景开始吧。</p>}
    <div className="wallpaper-options">{draft?.items.map(item => <WallpaperThumbnail key={item.id} item={item} selected={draft.selectedId === item.id} onSelect={() => onSelect(item.id)} onDelete={() => onDelete(item.id)} />)}</div>
  </section>;
}
