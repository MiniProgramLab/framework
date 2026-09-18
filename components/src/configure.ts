/** 页头的应用导航适配器，业务路由继续由应用维护。 */
export interface ComponentNavigation {
  /** 独立入口返回时取得应用首页。 */
  homeUrl(): string
  /** 由应用决定 switchTab、reLaunch 及路由参数校验。 */
  returnTo(url: string): Promise<void>
}

/** 按 App 保存配置，避免多实例共享业务路由。 */
const navigation = new WeakMap<object, ComponentNavigation>()

/** 在 App.onLaunch 中安装组件所需的导航能力。 */
export function installComponents(app: object, options: ComponentNavigation): void {
  navigation.set(app, options)
}

/** 点击时才读取导航配置，组件注册过程不访问 App。 */
export function componentNavigation(): ComponentNavigation {
  const adapter = navigation.get(getApp<object>())
  if (!adapter) throw new Error('请在 App.onLaunch 中调用 installComponents 配置首页导航')
  return adapter
}
