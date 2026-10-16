import type { CSSProperties, ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpRight, ArrowUpToLine, Check, ChevronDown, ChevronRight, Folder, GripVertical, MoreHorizontal, Pencil, Plus, RotateCcw, Star, Trash2 } from 'lucide-react';
import type { Bookmark, Group, LayoutIndex, LayoutOperation } from '@luypage/contracts';
import { BookmarkIcon, domainOf, safeWebsite } from './ui';
import { relativePlacement, type MoveDirection } from './layout';

export interface CardActions {
  editing?: boolean; locked?: boolean; selecting?: boolean; selected: Set<string>; trash?: boolean;
  onSelect: (bookmark: Bookmark) => void; onEdit: (bookmark: Bookmark) => void;
  onPin: (bookmark: Bookmark) => void; onTrash: (bookmark: Bookmark) => void;
  onRestore: (bookmark: Bookmark) => void; onDelete: (bookmark: Bookmark) => void;
}
export function BookmarkCard({ bookmark, actions, handle, controls }: {
  bookmark: Bookmark; actions: CardActions; handle?: ReactNode; controls?: ReactNode;
}) {
  const selected = actions.selected.has(bookmark.id);
  const content = <><BookmarkIcon bookmark={bookmark} /><strong title={bookmark.title}>{bookmark.title}</strong><span className="card-domain" title={domainOf(bookmark.url)}>{domainOf(bookmark.url)}</span>{!actions.editing && !actions.selecting && !actions.trash && <ArrowUpRight className="external-arrow" size={14} aria-hidden="true" />}</>;
  const href = safeWebsite(bookmark.url);
  return <article className={`bookmark-card ${selected ? 'is-selected' : ''} ${actions.editing ? 'is-editing' : ''}`}>
    {actions.selecting ? <button className="card-main select-card" aria-pressed={selected} aria-label={`选择${bookmark.title}`} onClick={() => actions.onSelect(bookmark)}><span className="card-check">{selected && <Check size={13} />}</span>{content}</button>
      : actions.editing || actions.trash || !href ? <div className="card-main">{content}</div>
      : <a className="card-main" href={href} target="_blank" rel="noreferrer" title={`${bookmark.title}\n${bookmark.url}`}>{content}</a>}
    {bookmark.pinned && !actions.selecting && <Star size={12} className="pin-indicator" aria-label="常用收藏" />}
    {actions.editing ? <><div className="drag-handle-slot">{handle}</div>{controls}</> : actions.trash ? <div className="trash-card-actions"><button className="small" onClick={() => actions.onRestore(bookmark)}><RotateCcw size={13} />恢复</button><button className="icon-button danger" aria-label={`永久删除${bookmark.title}`} onClick={() => actions.onDelete(bookmark)}><Trash2 size={15} /></button></div> : !actions.selecting && <details className="card-menu">
      <summary aria-label={`${bookmark.title}的更多操作`}><MoreHorizontal size={18} /></summary>
      <div className="menu-panel"><button onClick={() => actions.onEdit(bookmark)}><Pencil size={14} />编辑收藏</button><button onClick={() => actions.onPin(bookmark)}><Star size={14} />{bookmark.pinned ? '取消常用' : '设为常用'}</button><button className="danger" onClick={() => actions.onTrash(bookmark)}><Trash2 size={14} />移入回收站</button></div>
    </details>}
  </article>;
}

function MoveButtons({ ids, id, label, onMove, disabled }: { ids: string[]; id: string; label: string; onMove: (direction: MoveDirection) => void; disabled?: boolean }) {
  const buttons = [{ value: 'start', label: '移至最前', icon: ArrowUpToLine }, { value: 'previous', label: '前移', icon: ArrowUp }, { value: 'next', label: '后移', icon: ArrowDown }, { value: 'end', label: '移至最后', icon: ArrowDownToLine }] as const;
  return <div className="move-buttons">{buttons.map(({ value, label: actionLabel, icon: Icon }) => <button key={value} className="icon-button" title={actionLabel} aria-label={`${label}${actionLabel}`} disabled={disabled || !relativePlacement(ids, id, value)} onClick={() => onMove(value)}><Icon size={15} /></button>)}</div>;
}

function SortableCard({ bookmark, actions, kind, groupId, index, groups, onMove }: {
  bookmark: Bookmark; actions: CardActions; kind: 'bookmark' | 'pinned'; groupId: string | null;
  index: LayoutIndex; groups: Group[]; onMove: (operation: LayoutOperation) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `${kind}:${bookmark.id}`, disabled: !actions.editing || actions.locked, data: { kind, id: bookmark.id, groupId } });
  const ids = kind === 'pinned' ? index.pinnedOrder : index.groups.find(group => group.groupId === groupId)?.bookmarkIds ?? [];
  function move(direction: MoveDirection) {
    const placement = relativePlacement(ids, bookmark.id, direction);
    if (placement) onMove(kind === 'pinned' ? { type: 'pinned', id: bookmark.id, placement } : { type: 'bookmark', id: bookmark.id, groupId, placement });
  }
  return <div ref={setNodeRef} className={`sortable-card ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <BookmarkCard bookmark={bookmark} actions={actions}
      handle={<button ref={setActivatorNodeRef} className="icon-button drag-handle" {...attributes} {...listeners} aria-label={`拖动${bookmark.title}${kind === 'pinned' ? '的常用入口' : ''}`} disabled={actions.locked}><GripVertical size={18} /></button>}
      controls={<details className="order-controls"><summary>调整位置 <span>{ids.indexOf(bookmark.id) + 1}/{ids.length}</span><ChevronDown size={12} /></summary><div>
        <MoveButtons ids={ids} id={bookmark.id} label={bookmark.title} onMove={move} disabled={actions.locked} />
        {kind === 'bookmark' && <label className="move-group-label">移动到分组<select aria-label={`将${bookmark.title}移动到分组`} value={groupId ?? ''} disabled={actions.locked} onChange={event => onMove({ type: 'bookmark', id: bookmark.id, groupId: event.target.value || null, placement: { edge: 'end' } })}><option value="">未分组</option>{groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>}
      </div></details>} />
  </div>;
}

function GroupSection({ groupId, name, index, groups, records, actions, collapsed, onCollapse, onMove, onAdd, onLoadMore, hasMore }: {
  groupId: string | null; name: string; index: LayoutIndex; groups: Group[]; records: Map<string, Bookmark>; actions: CardActions;
  collapsed: boolean; onCollapse: () => void; onMove: (operation: LayoutOperation) => void; onAdd: () => void; onLoadMore: () => void; hasMore: boolean;
}) {
  const sort = useSortable({ id: `group:${groupId ?? 'ungrouped'}`, disabled: !actions.editing || groupId === null || actions.locked, data: { kind: 'group', id: groupId } });
  const drop = useDroppable({ id: `drop:${groupId ?? 'ungrouped'}`, disabled: !actions.editing || actions.locked, data: { kind: 'drop', groupId } });
  const ids = index.groups.find(group => group.groupId === groupId)?.bookmarkIds ?? [];
  const loaded = ids.flatMap(id => { const value = records.get(id); return value ? [value] : []; });
  function moveGroup(direction: MoveDirection) {
    if (!groupId) return;
    const placement = relativePlacement(index.groupOrder, groupId, direction);
    if (placement) onMove({ type: 'group', id: groupId, placement });
  }
  return <section ref={sort.setNodeRef} className={`bookmark-section ${drop.isOver ? 'drop-over' : ''} ${sort.isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition }}>
    <header className="section-heading">
      {actions.editing && groupId && <button ref={sort.setActivatorNodeRef} className="icon-button drag-handle" {...sort.attributes} {...sort.listeners} aria-label={`拖动分组${name}`} disabled={actions.locked}><GripVertical size={18} /></button>}
      <button className="section-toggle" aria-expanded={!collapsed} onClick={onCollapse} disabled={actions.locked}><Folder size={17} /><h2>{name}</h2><span className="count-pill">{ids.length}</span>{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</button>
      <div className="section-heading-actions">{actions.editing && groupId ? <MoveButtons ids={index.groupOrder} id={groupId} label={`分组${name}`} onMove={moveGroup} disabled={actions.locked} /> : !actions.editing && <button className="icon-button" aria-label={`添加收藏到${name}`} onClick={onAdd}><Plus size={17} /></button>}</div>
    </header>
    <div ref={drop.setNodeRef} className={actions.editing ? 'group-drop-zone' : ''}>
      {collapsed ? actions.editing && <div className="empty-drop">拖到这里展开并移入“{name}”</div> : <>
        <SortableContext items={ids.map(id => `bookmark:${id}`)} strategy={rectSortingStrategy}>
          <div className="card-grid">{loaded.map(bookmark => <SortableCard key={bookmark.id} bookmark={bookmark} actions={actions} kind="bookmark" groupId={groupId} index={index} groups={groups} onMove={onMove} />)}</div>
        </SortableContext>
        {!ids.length && <div className="empty-drop">{actions.editing ? '拖动卡片到这里，放入这个分组' : <><span>留一点空间，给下一个好网站。</span><button className="text-button" onClick={onAdd}><Plus size={14} />添加收藏</button></>}</div>}
        {loaded.length < ids.length && <div className="section-more"><span>已展示 {loaded.length} / {ids.length} 条；排序包含尚未加载的收藏</span>{hasMore && <button className="text-button" onClick={onLoadMore}>加载更多收藏</button>}</div>}
      </>}
    </div>
  </section>;
}

const collisionDetection: CollisionDetection = args => {
  const kind = args.active.data.current?.kind;
  const droppableContainers = args.droppableContainers.filter(container => {
    const target = container.data.current?.kind;
    return kind === 'group' ? target === 'group' && container.data.current?.id !== null : kind === 'pinned' ? target === 'pinned' : target === 'bookmark' || target === 'drop';
  });
  const filtered = { ...args, droppableContainers };
  const hits = pointerWithin(filtered);
  if (hits.length) {
    const cards = hits.filter(hit => droppableContainers.find(container => container.id === hit.id)?.data.current?.kind !== 'drop');
    return cards.length ? cards : hits;
  }
  // Pointer drops outside a valid target must not move anything. Keyboard uses closest-center.
  return args.pointerCoordinates ? [] : closestCenter(filtered);
};

export function BookmarkBoard({ index, groups, records, actions, onMove, onCollapse, onAdd, onLoadMore, hasMore, onPinnedMore, hasPinnedMore, collapsedOverride }: {
  index: LayoutIndex; groups: Group[]; records: Bookmark[]; actions: CardActions;
  onMove: (operation: LayoutOperation) => void; onCollapse: (id: string) => void; onAdd: (groupId: string | null) => void;
  onLoadMore: () => void; hasMore: boolean; onPinnedMore: () => void; hasPinnedMore: boolean; collapsedOverride?: string[];
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const byId = new Map(records.map(bookmark => [bookmark.id, bookmark]));
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const collapsed = collapsedOverride ?? index.preferences.collapsedGroupIds;
  const preferences = index.preferences;
  const style = { '--desktop-cols': preferences.desktopColumns === 'auto' ? 5 : preferences.desktopColumns, '--mobile-cols': preferences.mobileColumns === 'auto' ? 2 : preferences.mobileColumns } as CSSProperties;
  function finish(event: DragEndEvent) {
    if (!actions.editing || actions.locked || !event.over || event.active.id === event.over.id) return;
    const source = event.active.data.current;
    const target = event.over.data.current;
    if (!source || !target || typeof source.id !== 'string') return;
    if (source.kind === 'group' && target.kind === 'group' && typeof target.id === 'string') {
      const after = index.groupOrder.indexOf(source.id) < index.groupOrder.indexOf(target.id);
      onMove({ type: 'group', id: source.id, placement: after ? { afterId: target.id } : { beforeId: target.id } });
    } else if (source.kind === 'pinned' && target.kind === 'pinned' && typeof target.id === 'string') {
      const after = index.pinnedOrder.indexOf(source.id) < index.pinnedOrder.indexOf(target.id);
      onMove({ type: 'pinned', id: source.id, placement: after ? { afterId: target.id } : { beforeId: target.id } });
    } else if (source.kind === 'bookmark' && (target.kind === 'bookmark' || target.kind === 'drop')) {
      const targetGroup = typeof target.groupId === 'string' ? target.groupId : null;
      const ids = index.groups.find(group => group.groupId === targetGroup)?.bookmarkIds ?? [];
      if (target.kind === 'drop') onMove({ type: 'bookmark', id: source.id, groupId: targetGroup, placement: { edge: 'end' } });
      else if (typeof target.id === 'string') {
        const after = source.groupId === targetGroup && ids.indexOf(source.id) < ids.indexOf(target.id);
        onMove({ type: 'bookmark', id: source.id, groupId: targetGroup, placement: after ? { afterId: target.id } : { beforeId: target.id } });
      }
    }
  }
  return <div className={`board density-${preferences.density} desktop-${preferences.desktopColumns} mobile-${preferences.mobileColumns}`} style={style}>
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={finish}
      accessibility={{ screenReaderInstructions: { draggable: '按空格开始拖动，方向键移动，空格放下，Escape 取消。也可使用卡片的调整位置按钮。' } }}
      onDragOver={({ active, over }) => { const target = over?.data.current; if (active.data.current?.kind === 'bookmark' && typeof target?.groupId === 'string' && collapsed.includes(target.groupId) && !actions.locked) onCollapse(target.groupId); }}>
      {index.pinnedOrder.length > 0 && <section className="bookmark-section pinned-section"><header className="section-heading"><Star size={17} /><h2>常用收藏</h2><span className="count-pill">{index.pinnedOrder.length}</span><span className="section-caption">每一天，都顺手一点</span></header>
        <SortableContext items={index.pinnedOrder.map(id => `pinned:${id}`)} strategy={rectSortingStrategy}><div className="card-grid">{index.pinnedOrder.flatMap(id => { const bookmark = byId.get(id); return bookmark ? [<SortableCard key={id} bookmark={bookmark} actions={actions} kind="pinned" groupId={bookmark.groupId} index={index} groups={groups} onMove={onMove} />] : []; })}</div></SortableContext>
        {hasPinnedMore && <button className="text-button section-more" onClick={onPinnedMore}>加载更多常用收藏</button>}
      </section>}
      <SortableContext items={index.groupOrder.map(id => `group:${id}`)} strategy={verticalListSortingStrategy}>
        {[...index.groupOrder, null].map(groupId => <GroupSection key={groupId ?? 'ungrouped'} groupId={groupId} name={groupId === null ? '未分组' : groupsById.get(groupId)?.name ?? '分组'} index={index} groups={groups} records={byId} actions={actions} collapsed={groupId !== null && collapsed.includes(groupId)} onCollapse={() => { if (groupId) onCollapse(groupId); }} onMove={onMove} onAdd={() => onAdd(groupId)} onLoadMore={onLoadMore} hasMore={hasMore} />)}
      </SortableContext>
    </DndContext>
  </div>;
}
