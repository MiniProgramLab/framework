// SPDX-License-Identifier: Apache-2.0
import type { CustomTabTheme } from './types.js'

/** 渲染专用色板，不作为可配置项开放。 */
interface TabPalette {
  background: string
  color: string
  selectedColor: string
  disabledColor: string
  borderColor: string
  indicatorBackground: string
  badgeBackground: string
  badgeColor: string
}

/** 统一为六位十六进制纯色，拒绝透明色、渐变与无效输入。 */
export function normalizeTabColor(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.trim())
  ) {
    throw new Error('Tabbar 颜色请使用 #RGB 或 #RRGGBB 格式')
  }
  const hex = value.trim().slice(1)
  return `#${hex.length === 3 ? [...hex].map((character) => character + character).join('') : hex}`.toUpperCase()
}

/** 按 sRGB 通道混合基础色，输出始终不透明，不依赖页面背后的颜色。 */
function mixColor(
  background: string,
  foreground: string,
  weight: number,
): string {
  return `#${[1, 3, 5]
    .map((offset) => {
      const base = parseInt(background.slice(offset, offset + 2), 16)
      const main = parseInt(foreground.slice(offset, offset + 2), 16)
      return Math.round(base + (main - base) * weight)
        .toString(16)
        .padStart(2, '0')
    })
    .join('')}`.toUpperCase()
}

/** 全部可见颜色只取自背景色和文字主色，浅色、深色与品牌色共用同一规则。 */
export function deriveTabPalette(theme: CustomTabTheme): TabPalette {
  const background = normalizeTabColor(theme.background)
  const main = normalizeTabColor(theme.color)
  return {
    background,
    color: mixColor(background, main, 0.62),
    selectedColor: main,
    disabledColor: mixColor(background, main, 0.3),
    borderColor: mixColor(background, main, 0.12),
    indicatorBackground: mixColor(background, main, 0.08),
    badgeBackground: main,
    badgeColor: background,
  }
}
