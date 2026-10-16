import type { CSSProperties } from 'react';
import type { TileStyle } from '@luypage/contracts';

export function tileStyleVariables(style: TileStyle): CSSProperties {
  const r = parseInt(style.background.slice(1, 3), 16);
  const g = parseInt(style.background.slice(3, 5), 16);
  const b = parseInt(style.background.slice(5, 7), 16);
  const linear = (value: number) => value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
  const light = (0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)) > 0.4 && style.transparency < 60;
  return { '--tile-background': `rgba(${r}, ${g}, ${b}, ${1 - style.transparency / 100})`, '--tile-radius': `${style.radius}px`,
    '--tile-text': light ? '#192d2b' : '#fffdf7', '--tile-muted': light ? '#354e4a' : '#eeeae0',
    '--tile-border': light ? '#192d2b30' : '#ffffff30' } as CSSProperties;
}
