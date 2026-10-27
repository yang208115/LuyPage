import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Grip, MoveDiagonal2 } from 'lucide-react';
import { MAX_HOMEPAGE_PIN_SLOT, MIN_SHORTCUT_ICON_SIZE, MAX_SHORTCUT_ICON_SIZE, homepageColumns, type HomepageDevice, type HomepageLayoutProfile, type HomepageTile, type TileAppearance, type TileStyle } from '@luypage/contracts';
import { tileStyleVariables } from './tile-appearance';
import { homepagePinSlots, placeHomepagePin, placeHomepageTile, resizeHomepagePin } from '@luypage/domain';

const ROW = 56; const GAP = 16;
interface GridProps {
  appearance: TileAppearance; device: HomepageDevice; profile: HomepageLayoutProfile; editing: boolean; disabled: boolean;
  contents: Map<string, { label: string; node: ReactNode }>; onChange: (profile: HomepageLayoutProfile) => void;
}
export function HomepageGrid({ appearance, device, profile, editing, disabled, contents, onChange }: GridProps) {
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
        return <GridTile appearance={appearance.overrides[item.id] ?? appearance.defaults} key={item.id} item={item} label={content.label} editing={editing} disabled={disabled} stepX={stepX}
          onResize={(w, h, commit) => {
            const original = profile.items.find(tile => tile.id === item.id)!;
            const next = placeHomepageTile(profile, { ...original, w, h }, device);
            if (commit) { setPreview(null); onChange(next); } else setPreview(next);
          }} onCancel={() => setPreview(null)}>{content.node}</GridTile>;
      })}
    </div>
  </DndContext>;
}
function GridTile({ appearance, item, label, children, editing, disabled, stepX, onResize, onCancel }: {
  appearance: TileStyle | null; item: HomepageTile; label: string; children: ReactNode; editing: boolean; disabled: boolean; stepX: number;
  onResize: (w: number, h: number, commit: boolean) => void; onCancel: () => void;
}) {
  const drag = useDraggable({ id: item.id, disabled: !editing || disabled });
  const resize = useRef<{ pointer: number; x: number; y: number; w: number; h: number } | null>(null);
  return <div ref={drag.setNodeRef} className={`homepage-grid-item tile-${item.id.split(':')[0]} ${drag.isDragging ? 'is-dragging' : ''} ${appearance ? 'tile-customized' : ''}`} data-tile-id={item.id}
    style={{ ...(appearance ? tileStyleVariables(appearance) : {}), gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}` }}>
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
export function HomepagePins({ items, profile, device, iconSize, editing, disabled, onChange, addButton }: {
  items: { id: string; title: string; node: ReactNode }[]; profile: HomepageLayoutProfile; device: HomepageDevice;
  iconSize: number; editing: boolean; disabled: boolean; onChange: (profile: HomepageLayoutProfile) => void; addButton: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [sizePreview, setSizePreview] = useState<{ id: string; size: number } | null>(null);
  const sizeOf = (id: string) => sizePreview?.id === id ? sizePreview.size : profile.pinnedSizes?.[id] ?? iconSize;
  // Each website keeps its own square. Reserve enough room for the largest one
  // so resizing cannot cover a neighbor or create a second draggable cell.
  const largest = Math.max(iconSize, ...items.map(item => sizeOf(item.id)));
  const columns = Math.max(1, Math.floor((width + 12) / (Math.max(device === 'mobile' ? 64 : 76, largest) + 12)));
  const row = largest + 42;
  const stepX = (width + 12) / columns;
  const slots = useMemo(() => homepagePinSlots(profile), [profile]);
  const [preview, setPreview] = useState<number | null>(null);
  const origin = useRef<{ id: string; slot: number; columns: number; stepX: number; row: number; keyboard: boolean; target: number } | null>(null);
  const metrics = useRef({ stepX, row }); metrics.current = { stepX, row };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, {
    scrollBehavior: 'auto',
    coordinateGetter: (event, { currentCoordinates }) => {
      const shifts: Record<string, [number, number]> = { ArrowRight: [metrics.current.stepX, 0], ArrowLeft: [-metrics.current.stepX, 0], ArrowDown: [0, metrics.current.row], ArrowUp: [0, -metrics.current.row] };
      const shift = shifts[event.code]; if (!shift) return undefined;
      const start = origin.current;
      if (start?.keyboard) {
        // Keyboard movement addresses cells directly: scrolling must not consume a step.
        const x = Math.max(0, Math.min(start.columns - 1, start.target % start.columns + Math.sign(shift[0])));
        const y = Math.max(0, Math.floor(start.target / start.columns) + Math.sign(shift[1]));
        start.target = Math.min(MAX_HOMEPAGE_PIN_SLOT, y * start.columns + x);
        setPreview(start.target);
      }
      event.preventDefault(); return { x: currentCoordinates.x + shift[0], y: currentCoordinates.y + shift[1] };
    },
  }));
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(entries => { const entry = entries[0]; if (entry) setWidth(entry.contentRect.width); });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { origin.current = null; setPreview(null); }, [columns, editing, device, iconSize]);
  useEffect(() => setSizePreview(null), [profile, editing, device, disabled]);
  function target(event: DragMoveEvent | DragEndEvent): number | null {
    const start = origin.current;
    if (!start) return null;
    if (start.keyboard) return start.target;
    const x = Math.max(0, Math.min(start.columns - 1, start.slot % start.columns + Math.round(event.delta.x / start.stepX)));
    const y = Math.max(0, Math.floor(start.slot / start.columns) + Math.round(event.delta.y / start.row));
    return Math.min(MAX_HOMEPAGE_PIN_SLOT, y * start.columns + x);
  }
  const last = Math.max(-1, ...items.map((item, index) => slots.get(item.id) ?? index));
  const addSlot = last + 1;
  const rows = Math.ceil((Math.max(addSlot, preview ?? 0) + 1) / columns) + (editing ? 1 : 0);
  const cell = (slot: number) => ({ gridColumn: slot % columns + 1, gridRow: Math.floor(slot / columns) + 1 });
  return <DndContext sensors={sensors}
    onDragStart={({ active, activatorEvent }) => { const slot = slots.get(String(active.id)); if (slot !== undefined) { origin.current = { id: String(active.id), slot, columns, stepX, row, keyboard: activatorEvent.type === 'keydown', target: slot }; setPreview(slot); } }}
    onDragMove={event => setPreview(target(event))}
    onDragCancel={() => { origin.current = null; setPreview(null); }}
    onDragEnd={event => { const slot = target(event); const id = origin.current?.id; origin.current = null; setPreview(null); if (!disabled && editing && id && slot !== null) onChange(placeHomepagePin(profile, id, slot)); }}>
    <div ref={ref} className={`home-shortcuts home-pin-grid ${editing ? 'is-pin-editing' : ''}`} data-pin-columns={columns}
      style={{ '--pin-columns': columns, '--pin-row': `${row}px`, '--pin-step-x': `${stepX}px`, minHeight: rows * row } as CSSProperties}>
      {items.map((item, index) => <HomepagePin key={item.id} id={item.id} title={item.title} slot={slots.get(item.id) ?? index} position={cell(slots.get(item.id) ?? index)} iconSize={sizeOf(item.id)} editing={editing} disabled={disabled}
        onResize={(size, commit) => {
          const bounded = Math.max(MIN_SHORTCUT_ICON_SIZE, Math.min(MAX_SHORTCUT_ICON_SIZE, Math.round(size)));
          if (commit) { setSizePreview(null); if (editing && !disabled) onChange(resizeHomepagePin(profile, item.id, bounded)); }
          else setSizePreview({ id: item.id, size: bounded });
        }} onCancelResize={() => setSizePreview(null)}>{item.node}</HomepagePin>)}
      <div className="home-pin-add" style={cell(addSlot)}>{addButton}</div>
      {editing && preview !== null && <div className="home-pin-drop-preview" aria-hidden="true" style={cell(preview)}><span>放在这里</span></div>}
    </div>
  </DndContext>;
}
function HomepagePin({ id, title, slot, position, iconSize, editing, disabled, children, onResize, onCancelResize }: {
  id: string; title: string; slot: number; position: CSSProperties; iconSize: number; editing: boolean; disabled: boolean; children: ReactNode;
  onResize: (size: number, commit: boolean) => void; onCancelResize: () => void;
}) {
  const drag = useDraggable({ id, disabled: !editing || disabled });
  const resize = useRef<{ pointer: number; x: number; y: number; size: number } | null>(null);
  useEffect(() => { resize.current = null; }, [editing, disabled]);
  const resized = (x: number, y: number) => {
    const start = resize.current!;
    // Project movement onto the square's diagonal: both axes control one side.
    return start.size + Math.round((x - start.x + y - start.y) / 2);
  };
  return <div ref={drag.setNodeRef} className={`sortable-home-pin ${drag.isDragging ? 'is-dragging' : ''}`} data-pin-id={id} data-pin-slot={slot} data-pin-size={iconSize}
    style={{ ...position, '--home-icon-size': `${iconSize}px`, transform: CSS.Transform.toString(drag.transform) } as CSSProperties}>
    <div inert={editing ? true : undefined}>{children}</div>
    {editing && <>
      <button ref={drag.setActivatorNodeRef} className="pin-drag-handle" aria-label={`移动网站：${title}`} title="直接拖动网站自由摆放，也可使用空格和方向键" disabled={disabled} {...drag.attributes} {...drag.listeners}><Grip className="pin-drag-grip" size={15} /></button>
      <button className="pin-resize-handle" aria-label={`调整网站大小：${title}`} title={`拖动缩放此图标 · ${iconSize} × ${iconSize} px；方向键微调，Shift 加速`} disabled={disabled || drag.isDragging}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, size: iconSize }; }}
        onPointerMove={event => { if (resize.current?.pointer === event.pointerId) onResize(resized(event.clientX, event.clientY), false); }}
        onPointerUp={event => { if (resize.current?.pointer !== event.pointerId) return; const size = resized(event.clientX, event.clientY); resize.current = null; onResize(size, true); }}
        onPointerCancel={() => { resize.current = null; onCancelResize(); }}
        onLostPointerCapture={() => { if (resize.current) { resize.current = null; onCancelResize(); } }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') { resize.current = null; onCancelResize(); }
          const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
          if (direction) { event.preventDefault(); if (!resize.current) onResize(iconSize + direction * (event.shiftKey ? 10 : 1), true); }
        }}><MoveDiagonal2 size={13} /></button>
    </>}
  </div>;
}
