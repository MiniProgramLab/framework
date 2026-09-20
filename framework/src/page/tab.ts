// SPDX-License-Identifier: Apache-2.0
/** 底栏接入仅依赖页面的最小能力，不反向引用 UI 包。 */
export interface TabPageHost {
  /** 原生页面路由。 */
  route: string
  /** 自动注入的底栏留白，供页面模板使用。 */
  data: { tabBarSpace: number }
  /** 更新页面展示数据。 */
  setData(data: { tabBarSpace: number }): void
  /** 获取当前页面所属的原生底栏。 */
  getTabBar?: () => unknown
}

/** 每个页面持有独立绑定，显示、尺寸变化和清理由 Core 调度。 */
export interface TabPageBinding {
  /** 同步当前页面对应的底栏选中项。 */
  show(): void
  /** 更新窗口尺寸变化后的底部留白。 */
  resize(): void
  /** 释放当前页面的订阅。 */
  dispose(): void
}

/** UI 在页面挂载时创建绑定，Core 不决定底栏布局和导航策略。 */
export type TabPageAdapter = (page: TabPageHost) => TabPageBinding

/** 按 App 隔离安装信息，不在页面声明阶段读取宿主。 */
const adapters = new WeakMap<object, TabPageAdapter>()

/** 由底栏安装入口提供具体实现，同一 App 不允许替换已注册的适配器。 */
export function installTabPageAdapter(app: object, adapter: TabPageAdapter): void {
  const previous = adapters.get(app)
  if (previous && previous !== adapter) throw new Error('Tab 页适配器已安装，不能替换')
  adapters.set(app, adapter)
}

/** 动态边界仅处理原生选项，公开推导由 definePage 保留。 */
type NativeOptions = Record<string, unknown>
/** 页面方法在原生完成 Behavior 合并后才包装，保留 this、参数及返回值。 */
type PageMethod = (this: TabPageHost, ...args: unknown[]) => unknown

/** 根据 CLI 注入的页面信息接入底栏，业务选项不再声明底栏开关。 */
export function tabPageOptions(input: object, enabled: boolean): object {
  const options = input as NativeOptions
  if (Object.prototype.hasOwnProperty.call(options, 'tabPage'))
    throw new TypeError('tabPage 已移除，请在 definePageConfig.page.tabBar 中声明底栏信息')
  const native = { ...options }
  if (!enabled) return native
  for (const section of [options.data, options.properties]) {
    if (section && Object.prototype.hasOwnProperty.call(section, 'tabBarSpace'))
      throw new TypeError('page.tabBar 已管理 tabBarSpace，请勿重复声明')
  }
  /** 绑定与存活状态按页面实例隔离，卸载后不再创建订阅。 */
  const states = new WeakMap<TabPageHost, { binding?: TabPageBinding; disposed: boolean }>()
  /** 挂载或首次显示时连接，重复生命周期不会重复订阅。 */
  function connect(page: TabPageHost): TabPageBinding | undefined {
    const state = states.get(page)
    if (!state || state.disposed) return undefined
    if (!state.binding) {
      const adapter = adapters.get(getApp<object>())
      if (!adapter) throw new Error('自定义 page.tabBar 需要先在 App.onLaunch 中调用 installTabBar')
      state.binding = adapter(page)
    }
    return state.binding
  }
  const behavior = Behavior({
    methods: {
      /** 显式登记页面显示入口，业务同名方法按原生规则覆盖后再统一包装。 */
      onShow() {},
      /** 无业务回调的页面也需要接收原生窗口变化。 */
      onResize() {},
    },
    lifetimes: {
      /** 只包装已合并的方法，此时不订阅、不调用 setData。 */
      created() {
        const page = this as unknown as TabPageHost & Record<string, unknown>
        states.set(page, { disposed: false })
        for (const [name, hook] of [['onShow', 'show'], ['onResize', 'resize']] as const) {
          const original = page[name]
          page[name] = function (this: TabPageHost, ...args: unknown[]) {
            connect(this)?.[hook]()
            return typeof original === 'function' ? (original as PageMethod).apply(this, args) : undefined
          }
        }
      },
      /** 页面数据可写后订阅底栏配置并计算初始留白。 */
      attached() {
        connect(this as unknown as TabPageHost)
      },
      /** 先标记失效，再释放订阅，防止清理重入或重复卸载。 */
      detached() {
        const page = this as unknown as TabPageHost
        const state = states.get(page)
        if (!state || state.disposed) return
        state.disposed = true
        state.binding?.dispose()
        delete state.binding
      },
    },
  })
  native.data = { ...(options.data as NativeOptions | undefined), tabBarSpace: 0 }
  native.behaviors = [behavior, ...((options.behaviors as unknown[] | undefined) ?? [])]
  return native
}
