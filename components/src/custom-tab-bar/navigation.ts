import {
  getTabBarSnapshot,
  navigateTab,
  subscribeTabBar,
  syncTabBarRoute,
} from './controller.js'
import type { TabBarSnapshot } from './controller.js'
import type {
  CustomTabAnimation,
  CustomTabBarConfig,
  CustomTabBarRef,
} from './types.js'
import type { TabRuntime } from './runtime.js'

/** 单个底栏实例的导航会话，不保存其他页面的组件或动画句柄。 */
export interface TabNavigationState {
  unsubscribe: (() => void) | null
  configRevision: number
  transition: TabBarSnapshot['transition']
  played: TabBarSnapshot['transition']
  originId: string
}

/** 导航协调仅通过组件的视图和动画接口反馈结果。 */
interface NavigationHost extends Pick<
  CustomTabBarRef,
  'setValue' | 'resumeTransition'
> {
  data: { standalone: boolean; navigating: boolean }
  updateView(patch: Record<string, unknown>): void
  replaceConfig(config: CustomTabBarConfig): void
  syncMotion(): void
  triggerEvent(name: string, detail: unknown): void
}

/** 隐藏、切换模式和卸载统一释放订阅。 */
export function pauseNavigation(runtime: TabRuntime): void {
  runtime.navigation.unsubscribe?.()
  runtime.navigation.unsubscribe = null
}

/** 模式切换清空本实例的接续记录，不修改应用当前页面。 */
export function resetNavigation(runtime: TabRuntime): void {
  pauseNavigation(runtime)
  runtime.navigation.configRevision = -1
  runtime.navigation.transition = null
  runtime.navigation.played = null
  runtime.navigation.originId = ''
}

/** 布局就绪后接续剩余回弹，同一次导航每个实例只播放一次。 */
export function resumeTabNavigation(
  host: NavigationHost,
  runtime: TabRuntime,
): void {
  const navigation = runtime.navigation
  const transition = navigation.transition
  if (
    !transition ||
    !runtime.shown ||
    Date.now() - transition.startedAt > 1000 ||
    (navigation.played?.token === transition.token &&
      navigation.played?.startedAt === transition.startedAt)
  )
    return
  if (
    host.resumeTransition(
      transition.from,
      transition.to,
      transition.startedAt,
      transition.animation,
    )
  )
    navigation.played = transition
}

/** 将共享导航快照转换为本实例更新，普通切页不重复推送整份配置。 */
function renderSnapshot(
  host: NavigationHost,
  runtime: TabRuntime,
  snapshot: TabBarSnapshot,
): void {
  if (host.data.standalone || !runtime.attached) return
  const navigation = runtime.navigation
  navigation.transition = snapshot.transition
  // 源实例已在 UI 线程释放弹簧，只有目标页面需要接续动画。
  if (navigation.originId === snapshot.activeId)
    navigation.played = snapshot.transition
  if (!snapshot.navigating) navigation.originId = ''
  const lockChanged = host.data.navigating !== snapshot.navigating
  host.updateView({ navigating: snapshot.navigating })
  if (navigation.configRevision !== snapshot.configRevision) {
    navigation.configRevision = snapshot.configRevision
    host.replaceConfig(snapshot.config)
  }
  if (runtime.activeId !== snapshot.activeId)
    host.setValue(snapshot.activeId, false, false)
  if (lockChanged) host.syncMotion()
  resumeTabNavigation(host, runtime)
}

/** 独立预览不连接应用导航，隐藏实例重新显示时补齐最新快照。 */
export function connectNavigation(
  host: NavigationHost,
  runtime: TabRuntime,
): void {
  if (
    host.data.standalone ||
    !runtime.attached ||
    runtime.navigation.unsubscribe
  )
    return
  runtime.navigation.unsubscribe = subscribeTabBar((snapshot) =>
    renderSnapshot(host, runtime, snapshot),
  )
}

/** 页面提供所属路由，底栏不依赖挂载时的页面栈顶猜测选中项。 */
export function syncNavigationRoute(
  host: NavigationHost,
  runtime: TabRuntime,
  route: string,
): void {
  if (host.data.standalone || !syncTabBarRoute(route) || !runtime.attached)
    return
  if (!runtime.navigation.unsubscribe) connectNavigation(host, runtime)
  else renderSnapshot(host, runtime, getTabBarSnapshot())
}

/** 提交导航并在失败后恢复视图，保持现有错误事件和提示行为。 */
export async function navigateTabSelection(
  host: NavigationHost,
  runtime: TabRuntime,
  id: string,
  animation?: CustomTabAnimation,
): Promise<void> {
  runtime.navigation.originId = id
  try {
    await navigateTab(id, animation)
  } catch (error) {
    runtime.navigation.originId = ''
    if (!runtime.attached) return
    renderSnapshot(host, runtime, getTabBarSnapshot())
    host.triggerEvent('navigationerror', {
      message: error instanceof Error ? error.message : String(error),
    })
    wx.showToast({ title: '暂时无法切换，请重试', icon: 'none' })
  }
}
