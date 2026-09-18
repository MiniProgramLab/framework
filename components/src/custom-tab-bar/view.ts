import { formatTabBadge } from './config.js'
import { deriveTabPalette } from './theme.js'
import type { CustomTabBarConfig, CustomTabItem } from './types.js'

/** 视图计算只接收窗口快照，不在函数内部读取平台状态。 */
export type TabWindow = ReturnType<typeof wx.getWindowInfo>
/** 实际底栏矩形使用逻辑像素。 */
export interface TabRect {
  left: number
  top: number
  width: number
  height: number
}

/** 将图片作为透明度遮罩，只保留轮廓，特殊字符按 CSS 字符串规则转义。 */
function iconMaskStyle(path: string): string {
  const url = path.replace(
    /["\\\n\r\f]/g,
    (character) => `\\${character.charCodeAt(0).toString(16)} `,
  )
  return `mask-image:url("${url}");`
}

/** 分别标识窗口和几何变化，主题及角标更新不触发重新测量。 */
export function createViewKeys(
  config: CustomTabBarConfig,
  itemCount: number,
  window: TabWindow,
): { windowKey: string; geometryKey: string } {
  const { layout, hidden } = config
  const windowKey = JSON.stringify([
    window.windowWidth,
    window.windowHeight,
    window.screenWidth,
    window.screenHeight,
    window.screenTop,
    window.safeArea,
  ])
  const geometryKey = JSON.stringify([
    windowKey,
    layout.position,
    layout.width,
    layout.height,
    layout.horizontalInset,
    layout.bottomGap,
    layout.padding,
    layout.safeArea,
    itemCount,
    hidden,
  ])
  return { windowKey, geometryKey }
}

/** 由配置和窗口生成模板数据，保持布局计算与组件生命周期独立。 */
export function createTabView(
  config: CustomTabBarConfig,
  items: readonly CustomTabItem[],
  activeId: string,
  window: TabWindow,
  measured: boolean,
) {
  const { layout, showLabel, hidden } = config
  const theme = deriveTabPalette(config.theme)
  const ratio = window.windowWidth / 750
  const safeBottom = layout.safeArea
    ? Math.max(
        0,
        window.screenHeight - (window.safeArea?.bottom ?? window.screenHeight),
      )
    : 0
  const safeLeft = layout.safeArea ? Math.max(0, window.safeArea?.left ?? 0) : 0
  const safeRight = layout.safeArea
    ? Math.max(
        0,
        window.screenWidth - (window.safeArea?.right ?? window.screenWidth),
      )
    : 0
  const padding = layout.padding * ratio
  const fixed = layout.position === 'fixed'
  const inset = layout.horizontalInset * ratio
  const bottom = layout.bottomGap * ratio + (fixed ? safeBottom : 0)
  return {
    padding,
    data: {
      items: items.map((item) => ({
        ...item,
        badgeText: formatTabBadge(item.badge),
        maskStyle: iconMaskStyle(item.iconPath),
        selectedMaskStyle: iconMaskStyle(
          item.selectedIconPath || item.iconPath,
        ),
      })),
      activeId: activeId,
      hasSelection: !!activeId,
      measured,
      showLabel,
      hidden: hidden || !items.length,
      fixed,
      hostStyle: `position:${fixed ? 'fixed' : 'relative'};padding:0 ${inset + safeRight}px ${bottom}px ${inset + safeLeft}px;z-index:${layout.zIndex};`,
      barStyle: `max-width:${layout.width}rpx;height:${layout.height}rpx;padding:0 ${layout.padding}rpx;border-radius:${layout.radius}rpx;background-color:${theme.background};border:1px solid ${theme.borderColor};`,
      indicatorStyle: `border-radius:${Math.max(8, layout.radius - layout.padding)}rpx;background-color:${theme.indicatorBackground};`,
      itemStyle: `height:${layout.height}rpx;`,
      iconStyle: `width:${layout.iconSize}rpx;height:${layout.iconSize}rpx;`,
      labelStyle: `font-size:${layout.labelSize}rpx;line-height:${layout.labelSize + 8}rpx;`,
      badgeStyle: `background:${theme.badgeBackground};color:${theme.badgeColor};`,
      color: theme.color,
      selectedColor: theme.selectedColor,
      disabledColor: theme.disabledColor,
    },
  }
}

/** 将实际矩形转换为等分槽位和选中块样式，布局事件高度不含安全区。 */
export function measureTabLayout(
  rect: TabRect,
  config: CustomTabBarConfig,
  itemCount: number,
  padding: number,
  windowWidth: number,
) {
  const slot = (rect.width - 2 * padding - 2) / Math.max(1, itemCount)
  const gap = Math.min(4, padding)
  return {
    slot,
    positionStyle: `left:${padding + 1 + gap / 2}px;top:${padding}px;width:${slot - gap}px;height:${rect.height - 2 * padding}px;`,
    height:
      config.layout.position === 'fixed'
        ? rect.height + (config.layout.bottomGap * windowWidth) / 750
        : 0,
    width: rect.width,
  }
}
