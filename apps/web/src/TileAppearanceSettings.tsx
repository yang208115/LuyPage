import { useState } from 'react';
import { DEFAULT_TILE_APPEARANCE, DEFAULT_TILE_STYLE, type TileAppearance, type TileStyle } from '@luypage/contracts';
import { tileStyleVariables } from './tile-appearance';

const PRESETS = [{ name: '深林', color: '#16211b' }, { name: '暮蓝', color: '#18364f' }, { name: '葡萄', color: '#46334f' }, { name: '奶油', color: '#f5ecd8' }];
export function TileAppearanceSettings({ value, targets, onChange }: {
  value: TileAppearance; targets: { id: string; label: string }[]; onChange: (value: TileAppearance) => void;
}) {
  const [selected, setSelected] = useState('all');
  const target = selected === 'all' || targets.some(item => item.id === selected) ? selected : 'all';
  const own = target === 'all' ? value.defaults : value.overrides[target];
  const style = own ?? value.defaults ?? DEFAULT_TILE_STYLE;
  function update(patch: Partial<TileStyle>) {
    const next = { ...style, ...patch };
    onChange(target === 'all' ? { ...value, defaults: next } : { ...value, overrides: { ...value.overrides, [target]: next } });
  }
  function reset() {
    if (target === 'all') onChange({ ...value, defaults: null });
    else { const overrides = { ...value.overrides }; delete overrides[target]; onChange({ ...value, overrides }); }
  }
  return <section className="home-settings-section tile-appearance-settings" aria-labelledby="tile-appearance-title">
    <h3 id="tile-appearance-title">磁贴外观</h3>
    <label className="field"><span>调整范围</span><select aria-label="磁贴外观调整范围" value={target} onChange={event => setSelected(event.target.value)}>
      <option value="all">全部磁贴（默认样式）</option>{targets.map(item => <option key={item.id} value={item.id}>{item.label}{value.overrides[item.id] ? ' · 已自定义' : ''}</option>)}
    </select></label>
    <p className="appearance-hint">统一样式应用于未单独定制的磁贴。背景透明度不会降低文字和图标的清晰度。</p>
    <div className="appearance-controls">
      <div><label className="appearance-color"><span>背景颜色</span><input aria-label="磁贴背景颜色" type="color" value={style.background} onChange={event => update({ background: event.target.value })} /><code>{style.background.toUpperCase()}</code></label>
        <div className="appearance-presets">{PRESETS.map(preset => <button key={preset.color} type="button" aria-label={`${preset.name}磁贴配色`} aria-pressed={style.background === preset.color} onClick={() => update({ background: preset.color })}><span style={{ background: preset.color }} />{preset.name}</button>)}</div>
        <label className="appearance-range"><span>背景透明度 <output>{style.transparency}%</output></span><input type="range" aria-label="磁贴背景透明度" min="0" max="100" step="1" value={style.transparency} onChange={event => update({ transparency: Number(event.target.value) })} /></label>
        <label className="appearance-range"><span>圆角 <output>{style.radius}px</output></span><input type="range" aria-label="磁贴圆角" min="0" max="40" step="1" value={style.radius} onChange={event => update({ radius: Number(event.target.value) })} /></label>
      </div>
      <div className="appearance-preview-backdrop"><div className="appearance-preview" style={tileStyleVariables(style)}><span>外观预览</span><strong>你好，新的一天</strong><small>{own ? '自定义样式' : value.defaults ? '跟随统一样式' : '尚未自定义，主页保留原始样式'}</small></div></div>
    </div>
    <div className="button-row"><button type="button" disabled={!own} onClick={reset}>{target === 'all' ? '恢复统一默认样式' : '跟随统一样式'}</button><button type="button" disabled={!value.defaults && !Object.keys(value.overrides).length} onClick={() => onChange(structuredClone(DEFAULT_TILE_APPEARANCE))}>恢复全部磁贴外观</button></div>
  </section>;
}
