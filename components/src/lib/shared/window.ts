/** 自定义导航和页面内容所需的设备尺寸，均使用逻辑像素。 */
export interface WindowLayout {
  /** 当前可见窗口高度，作为页面弹性布局的明确边界。 */
  windowHeight: number
  /** 状态栏需要预留的顶部高度。 */
  statusBarHeight: number
  /** 状态栏下方的导航内容高度。 */
  navigationBarHeight: number
  /** 导航内容右侧为胶囊按钮预留的宽度。 */
  contentRight: number
  /** 横屏或异形屏左右需要避开的区域。 */
  safeLeft: number
  safeRight: number
  /** 屏幕底部的安全区高度。 */
  safeBottom: number
}

/** 读取当前窗口和胶囊尺寸，窗口变化后重新计算。 */
export function getWindowLayout(): WindowLayout {
  const window = wx.getWindowInfo()
  const capsule = wx.getMenuButtonBoundingClientRect()
  const statusBarHeight = Math.max(0, window.statusBarHeight)
  // 模拟器尚未给出有效胶囊尺寸时使用基础导航尺寸，避免标题区域塌陷。
  const hasCapsule =
    capsule.height > 0 && capsule.left > 0 && capsule.top >= statusBarHeight
  return {
    windowHeight: window.windowHeight,
    statusBarHeight,
    navigationBarHeight: hasCapsule
      ? Math.max(44, capsule.height + (capsule.top - statusBarHeight) * 2)
      : 44,
    contentRight: hasCapsule
      ? Math.max(96, window.windowWidth - capsule.left + 12)
      : 96,
    safeLeft: Math.max(0, window.safeArea?.left ?? 0),
    safeRight: Math.max(
      0,
      window.screenWidth - (window.safeArea?.right ?? window.screenWidth),
    ),
    safeBottom: Math.max(
      0,
      window.screenHeight -
        (window.safeArea?.bottom ?? window.screenHeight),
    ),
  }
}
