import type {
  CustomTabBarConfig,
  CustomTabBarPatch,
  CustomTabItem,
  CustomTabTheme,
} from './types.js'
import { normalizeTabColor } from './theme.js'

/** 中性的浅色预设，底栏与选中块均使用不透明纯色。 */
export const lightTabTheme: CustomTabTheme = {
  background: '#FFFFFF',
  color: '#10151F',
}

/** 深色预设仅改变两个基础色，图标与辅助色自动跟随。 */
export const darkTabTheme: CustomTabTheme = {
  background: '#202328',
  color: '#F5F6F7',
}

/** 每次返回独立默认值，避免多个组件共享可变配置。 */
export function createDefaultConfig(): CustomTabBarConfig {
  return {
    items: [],
    showLabel: true,
    enableDrag: true,
    haptics: false,
    hidden: false,
    layout: {
      position: 'fixed',
      width: 686,
      height: 128,
      horizontalInset: 28,
      bottomGap: 16,
      padding: 8,
      radius: 64,
      iconSize: 48,
      labelSize: 22,
      safeArea: true,
      zIndex: 900,
    },
    theme: { ...lightTabTheme },
    motion: {
      enabled: true,
      reducedMotion: false,
      stiffness: 190,
      damping: 24,
      mass: 1.15,
      pressScale: 1.045,
      stretch: 0.18,
      edgeResistance: 0.1,
      dragThreshold: 7,
      viscosity: 0.35,
      velocityInfluence: 0.16,
      lift: 1.5,
    },
  }
}

/** 将数值限制在不会破坏布局与弹簧稳定性的范围内。 */
function limit(value: number, min: number, max: number, field: string): number {
  if (!Number.isFinite(value))
    throw new Error(`Tabbar 的 ${field} 必须是有限数字`)
  return Math.min(max, Math.max(min, value))
}

/** 合并、校验并复制配置；该模块没有微信运行时依赖，也可用于构建配置。 */
export function mergeTabBarConfig(
  base: CustomTabBarConfig,
  patch: CustomTabBarPatch,
): CustomTabBarConfig {
  const next: CustomTabBarConfig = {
    ...base,
    ...patch,
    items: (patch.items ?? base.items).map((item) => ({ ...item })),
    layout: { ...base.layout, ...patch.layout },
    // 明确挑选两个入口，运行时传入的额外颜色字段不会进入配置。
    theme: {
      background: normalizeTabColor(
        patch.theme?.background ?? base.theme.background,
      ),
      color: normalizeTabColor(patch.theme?.color ?? base.theme.color),
    },
    motion: { ...base.motion, ...patch.motion },
  }
  const ids = new Set<string>()
  for (const item of next.items) {
    if (!item.id?.trim() || ids.has(item.id))
      throw new Error('Tabbar 导航项的 id 必须非空且唯一')
    if (!item.text?.trim() || !item.iconPath?.trim())
      throw new Error(`Tabbar 导航项 ${item.id} 缺少文字或图标`)
    ids.add(item.id)
  }
  if (next.items.filter((item) => !item.hidden).length > 5)
    throw new Error('Tabbar 最多同时显示 5 个导航项')
  const layout = next.layout
  if (!['fixed', 'inline'].includes(layout.position))
    throw new Error('Tabbar position 只能为 fixed 或 inline')
  layout.width = limit(layout.width, 240, 1000, 'width')
  layout.height = limit(layout.height, 96, 200, 'height')
  layout.horizontalInset = limit(
    layout.horizontalInset,
    0,
    120,
    'horizontalInset',
  )
  layout.bottomGap = limit(layout.bottomGap, 0, 120, 'bottomGap')
  layout.padding = limit(layout.padding, 0, 16, 'padding')
  layout.radius = limit(layout.radius, 16, layout.height / 2, 'radius')
  layout.iconSize = limit(layout.iconSize, 24, 64, 'iconSize')
  layout.labelSize = limit(layout.labelSize, 18, 28, 'labelSize')
  // 同时调大图标与字号时，底座至少容纳内容和上下内边距。
  layout.height = Math.max(
    layout.height,
    layout.padding * 2 +
      layout.iconSize +
      (next.showLabel ? layout.labelSize + 13 : 0),
  )
  layout.zIndex = Math.round(limit(layout.zIndex, 0, 99999, 'zIndex'))
  const motion = next.motion
  motion.stiffness = limit(motion.stiffness, 80, 800, 'stiffness')
  motion.damping = limit(motion.damping, 12, 80, 'damping')
  motion.mass = limit(motion.mass, 0.3, 2, 'mass')
  motion.pressScale = limit(motion.pressScale, 1, 1.12, 'pressScale')
  motion.stretch = limit(motion.stretch, 0, 0.4, 'stretch')
  motion.edgeResistance = limit(motion.edgeResistance, 0, 0.3, 'edgeResistance')
  motion.dragThreshold = limit(motion.dragThreshold, 3, 24, 'dragThreshold')
  motion.viscosity = limit(motion.viscosity, 0, 1, 'viscosity')
  motion.velocityInfluence = limit(
    motion.velocityInfluence,
    0,
    0.8,
    'velocityInfluence',
  )
  motion.lift = limit(motion.lift, 0, 6, 'lift')
  return next
}

/** 隐藏项不参与布局；禁用项仍占位但无法选中。 */
export function visibleTabItems(config: CustomTabBarConfig): CustomTabItem[] {
  return config.items.filter((item) => !item.hidden)
}

/** 保留可用的选中项；空列表或全部禁用时不显示选中块。 */
export function resolveTabValue(
  items: CustomTabItem[],
  requested: string,
): string {
  return (
    items.find((item) => item.id === requested && !item.disabled)?.id ??
    items.find((item) => !item.disabled)?.id ??
    ''
  )
}

/** 格式化角标，并对短文本设定长度上限以避免覆盖邻项。 */
export function formatTabBadge(badge: CustomTabItem['badge']): string {
  if (typeof badge === 'number')
    return Number.isFinite(badge) && badge > 0
      ? badge > 99
        ? '99+'
        : String(Math.floor(badge))
      : ''
  return typeof badge === 'string' ? badge.slice(0, 4) : ''
}
