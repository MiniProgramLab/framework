// SPDX-License-Identifier: Apache-2.0
import type { WindowLayout } from './window.js'

/** 弹层布局字段同时供模板定位和正文高度测量使用。 */
export interface OverlayLayout {
  windowHeight: number
  resolvedPosition: string
  surfaceWidth: number
  safeTop: number
  safeBottom: number
  viewportTop: number
  viewportBottom: number
  surfaceTop: number
  surfaceBottom: number
  surfaceMaxHeight: number
}

/** 在当前窗口坐标内统一处理胶囊避让、底部安全区和弹出方向。 */
export function resolveOverlayLayout(
  position: string,
  window: WechatMiniprogram.WindowInfo,
  layout: WindowLayout,
  safeArea: boolean,
): OverlayLayout {
  const resolvedPosition = [
    'center',
    'bottom',
    'top',
    'left',
    'right',
  ].includes(position)
    ? position
    : 'center'
  const windowHeight = Math.max(0, window.windowHeight)
  const windowTop = Math.max(0, window.screenTop ?? 0)
  // 胶囊与状态栏使用屏幕坐标，转成窗口坐标后预留完整导航区域。
  const safeTop = safeArea
    ? Math.min(
        windowHeight,
        Math.max(
          0,
          layout.statusBarHeight + layout.navigationBarHeight - windowTop,
        ),
      )
    : 0
  // 窗口底边未进入物理安全区时，不再叠加 Home 指示条距离。
  const safeBottom = safeArea
    ? Math.min(
        layout.safeBottom,
        Math.max(
          0,
          windowTop +
            windowHeight -
            (window.safeArea?.bottom ?? window.screenHeight),
        ),
      )
    : 0
  const gap = 12
  const viewportTop =
    !safeArea || resolvedPosition === 'top' ? 0 : safeTop + gap
  const viewportBottom =
    !safeArea || resolvedPosition === 'bottom' ? 0 : safeBottom + gap
  const surfaceTop = resolvedPosition === 'top' ? safeTop : 0
  const surfaceBottom = resolvedPosition === 'bottom' ? safeBottom : 0
  const available = Math.max(
    0,
    windowHeight - safeTop - safeBottom - gap * 2,
  )
  const surfaceMaxHeight = Math.max(
    0,
    Math.min(
      windowHeight - viewportTop - viewportBottom,
      available * (resolvedPosition === 'center' ? 0.8 : 0.88) +
        surfaceTop +
        surfaceBottom,
    ),
  )
  const surfaceWidth = Math.max(
    0,
    resolvedPosition === 'center'
      ? Math.min(window.windowWidth - 48, 420)
      : ['left', 'right'].includes(resolvedPosition)
        ? Math.min(window.windowWidth * 0.84, 420)
        : window.windowWidth,
  )
  return {
    windowHeight,
    resolvedPosition,
    surfaceWidth,
    safeTop,
    safeBottom,
    viewportTop,
    viewportBottom,
    surfaceTop,
    surfaceBottom,
    surfaceMaxHeight,
  }
}
