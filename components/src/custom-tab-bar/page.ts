// SPDX-License-Identifier: Apache-2.0
import type { TabPageAdapter } from '@miniprogramlab/core/page/tab'
import type { NativeTabBarRef, TabBarSnapshot } from './controller.js'

/** 控制器注入读取与订阅能力，避免页面绑定反向加载控制器。 */
interface TabPageController {
  /** 获取当前底栏的配置与导航快照。 */
  snapshot(): TabBarSnapshot
  /** 订阅配置变化并立即提供当前快照。 */
  subscribe(listener: (snapshot: TabBarSnapshot) => void): () => void
  /** 底栏尚未挂载时先保存页面路由。 */
  syncRoute(route: string): boolean
}

/** 生成供 Core 调度的页面绑定，每个页面单独保存订阅取消函数。 */
export function createTabPageAdapter(controller: TabPageController): TabPageAdapter {
  return (page) => {
    /** 只计算额外底栏高度，设备安全区继续交由 page 组件处理。 */
    function updateSpace(snapshot: TabBarSnapshot): void {
      const { layout, hidden } = snapshot.config
      const tabBarSpace = hidden ? 0 : ((layout.height + layout.bottomGap + 16) * wx.getWindowInfo().windowWidth) / 750
      if (page.data.tabBarSpace !== tabBarSpace) page.setData({ tabBarSpace })
    }
    const unsubscribe = controller.subscribe(updateSpace)
    return {
      /** 每次显示同步所属实例；首次显示早于底栏挂载时先保存路由。 */
      show() {
        const bar = page.getTabBar?.() as NativeTabBarRef | undefined
        if (typeof bar?.syncRoute === 'function') bar.syncRoute(page.route)
        else controller.syncRoute(page.route)
      },
      /** 旋转或窗口宽度变化后按当前快照重新换算 rpx。 */
      resize() {
        updateSpace(controller.snapshot())
      },
      /** 页面卸载时释放自己的配置订阅。 */
      dispose: unsubscribe,
    }
  }
}
