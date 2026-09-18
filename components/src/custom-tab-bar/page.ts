import {
  getTabBarSnapshot,
  subscribeTabBar,
  syncTabBarRoute,
} from './controller.js'
import type { NativeTabBarRef, TabBarSnapshot } from './controller.js'

/** 只依赖原生页面路由与 getTabBar，兼容 Component 构造的页面。 */
interface TabPageContext {
  route: string
  getTabBar?: () => WechatMiniprogram.Component.TrivialInstance | undefined
}

/** 每个 Tab 页在自己的 onShow 中调用，确保同步当前页面对应的独立实例。 */
export function syncTabPage(page: TabPageContext): void {
  const bar =
    typeof page.getTabBar === 'function'
      ? (page.getTabBar() as NativeTabBarRef | undefined)
      : undefined
  if (typeof bar?.syncRoute === 'function') bar.syncRoute(page.route)
  // 首次 onShow 早于底栏挂载时先记住路由，实例 attached 后读取同一快照。
  else syncTabBarRoute(page.route)
}

/** 页面订阅独立保存，避免多个原生 Tab 页面互相覆盖取消函数。 */
const subscriptions = new WeakMap<object, () => void>()

/** 行为只负责底部留白，页面 onShow 显式调用 syncTabPage，避免业务方法覆盖同步逻辑。 */
export const tabPageBehavior = Behavior({
  data: { tabBarSpace: 0 },
  lifetimes: {
    /** 页面首帧及配置变化时更新额外空间；设备安全区继续由 page 消费。 */
    attached() {
      subscriptions.set(
        this,
        subscribeTabBar((snapshot) => this.updateTabBarSpace(snapshot), {
          configOnly: true,
        }),
      )
    },
    /** 页面卸载时移除订阅。 */
    detached() {
      subscriptions.get(this)?.()
      subscriptions.delete(this)
    },
  },
  methods: {
    /** 窗口宽度改变后重新换算 rpx。 */
    onResize(): void {
      this.updateTabBarSpace(getTabBarSnapshot())
    },
    /** 只计算额外底栏高度，避免和 page 的安全区重复累加。 */
    updateTabBarSpace(snapshot: TabBarSnapshot): void {
      const { layout, hidden } = snapshot.config
      const tabBarSpace = hidden
        ? 0
        : ((layout.height + layout.bottomGap + 16) *
            wx.getWindowInfo().windowWidth) /
          750
      if (this.data.tabBarSpace !== tabBarSpace) this.setData({ tabBarSpace })
    },
  },
})
