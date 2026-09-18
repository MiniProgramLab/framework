import { createDefaultConfig, mergeTabBarConfig, visibleTabItems } from './config.js'
import type {
  CustomTabAnimation,
  CustomTabBarConfig,
  CustomTabBarPatch,
  CustomTabItem,
} from './types.js'

/** 应用注入的原生 Tab 路由，组件不依赖业务路由生成文件。 */
export interface RegisteredTab extends CustomTabItem {
  pagePath: string
}

/** 底栏配置与可导航路由按 App 隔离。 */
export interface TabBarInstallation {
  config?: CustomTabBarPatch
  tabs: readonly RegisteredTab[]
}

/** 应用生命周期内共享控制器，避免向业务 globalData 写入内部字段。 */
const stores = new WeakMap<object, TabBarStore>()
/** 安装信息独立保存，用于校验动态配置及恢复默认值。 */
const installations = new WeakMap<object, { config: CustomTabBarConfig; tabs: RegisteredTab[] }>()

/** 在首个 Tab 实例创建前安装路由，默认导航使用微信 switchTab。 */
export function installTabBar(app: object, options: TabBarInstallation): void {
  if (stores.has(app)) throw new Error('底栏初始化后不能重新安装路由')
  const tabs = options.tabs.map((tab) => ({ ...tab }))
  if (tabs.length < 2 || tabs.length > 5 || new Set(tabs.map((tab) => tab.pagePath)).size !== tabs.length)
    throw new Error('原生底栏须注册 2–5 个不重复页面')
  if (tabs.some((tab) => !/^\/[^?#]+$/.test(tab.pagePath)))
    throw new Error('底栏路径须以 / 开头且不含查询参数')
  const config = mergeTabBarConfig(createDefaultConfig(), { ...options.config, items: tabs })
  if (config.layout.position !== 'fixed' || visibleTabItems(config).length < 2)
    throw new Error('原生底栏须固定定位且至少保留两个可见导航项')
  installations.set(app, { config, tabs })
}

/** 获取当前 App 的静态路由及默认外观。 */
function installation() {
  const options = installations.get(getApp<object>())
  if (!options) throw new Error('请在 App.onLaunch 中调用 installTabBar')
  return options
}

/** 跨原生 Tab 页传递一次切换的起点，使新页面仍能显示滑动回弹。 */
export interface TabBarSnapshot {
  config: CustomTabBarConfig
  /** 仅配置变动时递增，选中和导航锁变化不重新发送完整配置给视图。 */
  configRevision: number
  activeId: string
  navigating: boolean
  transition: {
    token: number
    from: string
    to: string
    startedAt: number
    animation?: CustomTabAnimation | undefined
  } | null
}

/** 订阅函数只保存于 App 实例，不进入渲染层。 */
type TabBarListener = (snapshot: TabBarSnapshot) => void

/** 共享模块复用同一控制器，应用状态仍以 App 实例的生命周期为边界。 */
interface TabBarStore extends TabBarSnapshot {
  listeners: Set<TabBarListener>
  configListeners: Set<TabBarListener>
}

/** getTabBar() 返回的原生入口契约；页面只同步所属路由，不操作子组件内部数据。 */
export interface NativeTabBarRef {
  /** 在所属 Tab 页的 onShow 中同步选中状态。 */
  syncRoute(route: string): void
}

/** 懒初始化避免构建 app.config.ts 时访问微信全局对象。 */
function getStore(): TabBarStore {
  const app = getApp<object>()
  const options = installation()
  if (!stores.has(app)) stores.set(app, {
    config: mergeTabBarConfig(options.config, {}),
    activeId: options.tabs.find((tab) => !tab.hidden && !tab.disabled)?.id ?? '',
    navigating: false,
    transition: null,
    configRevision: 0,
    listeners: new Set(),
    configListeners: new Set(),
  })
  return stores.get(app)!
}

/** 向所有已挂载的底栏及页面留白同步快照。 */
function publish(configChanged = false): void {
  const store = getStore()
  store.listeners.forEach((listener) => listener(getTabBarSnapshot()))
  if (configChanged)
    store.configListeners.forEach((listener) => listener(getTabBarSnapshot()))
}

/** 调用方只能拿到副本，防止绕过校验直接修改状态。 */
export function getTabBarSnapshot(): TabBarSnapshot {
  const store = getStore()
  return {
    // 状态已经在写入时校验，读取只复制，避免每次导航重复校验整份配置。
    config: {
      ...store.config,
      items: store.config.items.map((item) => ({ ...item })),
      layout: { ...store.config.layout },
      theme: { ...store.config.theme },
      motion: { ...store.config.motion },
    },
    configRevision: store.configRevision,
    activeId: store.activeId,
    navigating: store.navigating,
    transition: store.transition
      ? {
          ...store.transition,
          animation: store.transition.animation
            ? {
                ...store.transition.animation,
                motion: { ...store.transition.animation.motion },
              }
            : undefined,
        }
      : null,
  }
}

/** 订阅时立即同步；返回取消函数供组件 detached 清理。 */
export function subscribeTabBar(
  listener: TabBarListener,
  options: { configOnly?: boolean } = {},
): () => void {
  const listeners = options.configOnly
    ? getStore().configListeners
    : getStore().listeners
  listeners.add(listener)
  listener(getTabBarSnapshot())
  return () => {
    listeners.delete(listener)
  }
}

/** 动态更新整个应用的底栏；列表仍须遵守原生路由注册边界。 */
export function configureTabBar(patch: CustomTabBarPatch): void {
  const store = getStore()
  if (store.navigating)
    throw new Error('页面切换中，请在跳转完成后更新 Tabbar 配置')
  const config = mergeTabBarConfig(store.config, patch)
  const visible = visibleTabItems(config)
  if (visible.length < 2) throw new Error('应用底栏至少保留两个可见导航项')
  if (config.layout.position !== 'fixed')
    throw new Error('应用底栏必须使用 fixed；局部预览请启用 standalone')
  for (const item of config.items) {
    if (
      !installation().tabs.some(
        (tab) => tab.id === item.id && tab.pagePath === item.pagePath,
      )
    ) {
      throw new Error(
        `路由 ${item.id} 未注册，请先更新页面配置中的 route.tab 并重新构建`,
      )
    }
  }
  if (!visible.some((item) => item.id === store.activeId && !item.disabled)) {
    throw new Error('不能移除、隐藏或禁用当前页面的导航项，请先切换到其他页面')
  }
  if (JSON.stringify(store.config) === JSON.stringify(config)) return
  store.config = config
  store.configRevision += 1
  store.transition = null
  publish(true)
}

/** 按 id 调整角标、文字、图标和可见性，所有页面立即同步。 */
export function updateTabBarItem(
  id: string,
  patch: Partial<Omit<CustomTabItem, 'id' | 'pagePath'>>,
): void {
  const items = getStore().config.items
  if (!items.some((item) => item.id === id))
    throw new Error(`Tabbar 导航项不存在：${id}`)
  configureTabBar({
    items: items.map((item) =>
      item.id === id ? { ...item, ...patch, id } : item,
    ),
  })
}

/** 恢复项目默认视觉与条目，保留当前真实页面。 */
export function resetTabBar(): void {
  configureTabBar(installation().config)
}

/** 由页面 onShow 提供所属路由，避免各底栏实例在挂载时误读页面栈顶。 */
export function syncTabBarRoute(route: string): boolean {
  const registered = installation().tabs.find(
    (item) => item.pagePath === `/${route.replace(/^\//, '')}`,
  )
  if (!registered) return false
  const store = getStore()
  // 导航尚在进行时旧页仍可能触发 show，不能覆盖正在前往的目标。
  if (store.navigating && registered.id !== store.activeId) return false
  const current = store.config.items.find((item) => item.id === registered.id)
  const changed =
    store.activeId !== registered.id ||
    !current ||
    current.hidden ||
    current.disabled
  if (!changed) return true
  const configChanged = !current || !!current.hidden || !!current.disabled
  if (configChanged) {
    const items = current
      ? store.config.items.map((item) =>
          item.id === registered.id
            ? { ...item, hidden: false, disabled: false }
            : item,
        )
      : [...store.config.items, { ...registered }]
    store.config = mergeTabBarConfig(store.config, { items })
    store.configRevision += 1
  }
  store.activeId = registered.id
  store.transition = null
  publish(configChanged)
  return true
}

/** 通过真实 switchTab 提交导航，失败时回滚选中并将错误交给调用方。 */
export function navigateTab(
  id: string,
  animation?: CustomTabAnimation,
): Promise<void> {
  const store = getStore()
  const item = store.config.items.find(
    (tab) => tab.id === id && !tab.hidden && !tab.disabled,
  )
  const registered = installation().tabs.find((tab) => tab.id === id)
  if (!item?.pagePath || !registered)
    return Promise.reject(new Error('目标导航项不存在或不可用'))
  if (store.navigating) return Promise.reject(new Error('页面正在切换'))
  const pages = getCurrentPages()
  const currentRoute = pages[pages.length - 1]?.route
  // 从非 Tab 页返回当前选中项时仍须调用 switchTab，关闭上层页面。
  if (id === store.activeId && item.pagePath === `/${currentRoute}`)
    return Promise.resolve()
  const previousId = store.activeId
  store.activeId = id
  store.navigating = true
  store.transition =
    previousId === id
      ? null
      : {
          token: (store.transition?.token ?? 0) + 1,
          from: previousId,
          to: id,
          startedAt: animation?.startedAt ?? Date.now(),
          animation: animation
            ? { ...animation, motion: { ...animation.motion } }
            : undefined,
        }
  publish()
  return new Promise<void>((resolve, reject) => {
    wx.switchTab({ url: registered.pagePath, success: () => resolve(), fail: reject })
  }).then(
    () => {
      store.navigating = false
      publish()
    },
    (error) => {
      store.activeId = previousId
      store.navigating = false
      store.transition = null
      publish()
      throw new Error(
        error instanceof Error ? error.message : error.errMsg || '页面切换失败',
      )
    },
  )
}
