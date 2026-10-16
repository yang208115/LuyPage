import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Grip, MoveDiagonal2 } from 'lucide-react';
import { homepageColumns, type HomepageDevice, type HomepageLayoutProfile, type HomepageTile } from '@luypage/contracts';
import { placeHomepageTile } from '@luypage/domain';

const ROW = 56; const GAP = 16;
interface GridProps {
  device: HomepageDevice; profile: HomepageLayoutProfile; editing: boolean; disabled: boolean;
  contents: Map<string, { label: string; node: ReactNode }>; onChange: (profile: HomepageLayoutProfile) => void;
}
export function HomepageGrid({ device, profile, editing, disabled, contents, onChange }: GridProps) {
  const ref = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(1000);
  const [preview, setPreview] = useState<HomepageLayoutProfile | null>(null);
  const columns = homepageColumns(device); const stepX = (width + GAP) / columns;
  const metrics = useRef(stepX); metrics.current = stepX;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, {
    coordinateGetter: (event, { currentCoordinates }) => {
      const shifts: Record<string, [number, number]> = { ArrowRight: [metrics.current, 0], ArrowLeft: [-metrics.current, 0], ArrowDown: [0, ROW + GAP], ArrowUp: [0, -ROW - GAP] };
      const shift = shifts[event.code]; if (!shift) return undefined;
      event.preventDefault(); return { x: currentCoordinates.x + shift[0], y: currentCoordinates.y + shift[1] };
    },
  }));
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(entries => { const entry = entries[0]; if (entry) setWidth(entry.contentRect.width); });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  useEffect(() => setPreview(null), [device, profile, editing]);
  function moved(event: DragEndEvent) {
    const item = profile.items.find(item => item.id === event.active.id);
    return item ? placeHomepageTile(profile, { ...item, x: item.x + Math.round(event.delta.x / stepX), y: item.y + Math.round(event.delta.y / (ROW + GAP)) }, device) : profile;
  }
  const displayed = preview ?? profile;
  return <DndContext sensors={sensors} onDragMove={event => setPreview(moved(event))} onDragCancel={() => setPreview(null)} onDragEnd={event => { setPreview(null); onChange(moved(event)); }}>
    <div ref={ref} className={`homepage-grid ${editing ? 'is-grid-editing' : ''}`} aria-label="我的主页组件" style={{ '--grid-columns': columns, '--grid-step-x': `${stepX}px` } as CSSProperties}>
      {displayed.items.filter(item => contents.has(item.id)).map(item => {
        const content = contents.get(item.id)!;
        return <GridTile key={item.id} item={item} label={content.label} editing={editing} disabled={disabled} stepX={stepX}
          onResize={(w, h, commit) => {
            const original = profile.items.find(tile => tile.id === item.id)!;
            const next = placeHomepageTile(profile, { ...original, w, h }, device);
            if (commit) { setPreview(null); onChange(next); } else setPreview(next);
          }} onCancel={() => setPreview(null)}>{content.node}</GridTile>;
      })}
    </div>
  </DndContext>;
}
function GridTile({ item, label, children, editing, disabled, stepX, onResize, onCancel }: {
  item: HomepageTile; label: string; children: ReactNode; editing: boolean; disabled: boolean; stepX: number;
  onResize: (w: number, h: number, commit: boolean) => void; onCancel: () => void;
}) {
  const drag = useDraggable({ id: item.id, disabled: !editing || disabled });
  const resize = useRef<{ pointer: number; x: number; y: number; w: number; h: number } | null>(null);
  return <div ref={drag.setNodeRef} className={`homepage-grid-item tile-${item.id.split(':')[0]} ${drag.isDragging ? 'is-dragging' : ''}`} data-tile-id={item.id}
    style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}` }}>
    <div className="homepage-grid-content" inert={editing && item.id !== 'favorites' ? true : undefined}>{children}</div>
    {editing && <>
      <button ref={drag.setActivatorNodeRef} className="grid-drag-handle" aria-label={`移动${label}`} disabled={disabled} {...drag.attributes} {...drag.listeners}><Grip size={16} /><span>{label}</span></button>
      <button className="grid-resize-handle" aria-label={`调整${label}大小`} title="拖动调整大小，或使用方向键" disabled={disabled}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, w: item.w, h: item.h }; }}
        onPointerMove={event => { const start = resize.current; if (start?.pointer === event.pointerId) onResize(start.w + Math.round((event.clientX - start.x) / stepX), start.h + Math.round((event.clientY - start.y) / (ROW + GAP)), false); }}
        onPointerUp={event => { const start = resize.current; if (!start || start.pointer !== event.pointerId) return; resize.current = null; onResize(start.w + Math.round((event.clientX - start.x) / stepX), start.h + Math.round((event.clientY - start.y) / (ROW + GAP)), true); }}
        onPointerCancel={() => { resize.current = null; onCancel(); }}
        onKeyDown={event => {
          const shift: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
          const delta = shift[event.key]; if (delta) { event.preventDefault(); onResize(item.w + delta[0], item.h + delta[1], true); }
          if (event.key === 'Escape') { resize.current = null; onCancel(); }
        }}><MoveDiagonal2 size={16} /></button>
    </>}
  </div>;
}
export function SortableHomepagePins({ ids, disabled, onMove, children }: { ids: string[]; disabled: boolean; onMove: (active: string, over: string) => void; children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <DndContext sensors={sensors} onDragEnd={({ active, over }) => { if (!disabled && over && active.id !== over.id) onMove(String(active.id), String(over.id)); }}><SortableContext items={ids} strategy={rectSortingStrategy}>{children}</SortableContext></DndContext>;
}
export function SortableHomepagePin({ id, title, editing, disabled, children }: { id: string; title: string; editing: boolean; disabled: boolean; children: ReactNode }) {
  const sort = useSortable({ id, disabled: !editing || disabled });
  return <div ref={sort.setNodeRef} className="sortable-home-pin" style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition }}>
    <div inert={editing ? true : undefined}>{children}</div>
    {editing && <button ref={sort.setActivatorNodeRef} className="pin-drag-handle" aria-label={`排序${title}`} disabled={disabled} {...sort.attributes} {...sort.listeners}><Grip size={16} /></button>}
  </div>;
}
