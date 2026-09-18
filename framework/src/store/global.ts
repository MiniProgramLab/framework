import { createStoreRoot } from './core.js'
import type { StoreConnection, StoreRoot } from './core.js'
import { definitionFactory } from './definition.js'
import { storePlugins } from './setup.js'
import type { StorePlugin, StorePluginContext } from './plugin.js'
import type { StoreDefinition, StoreState } from './types.js'

/** 应用通过声明合并提供 state 类型，框架不反向依赖业务源码。 */
export interface GlobalStoreRegistry {}

/** 未声明全局状态时保留通用 Store 类型。 */
export type GlobalStoreState = GlobalStoreRegistry extends { state: infer S extends StoreState }
  ? S
  : StoreState

/** 全局状态定义按 App 隔离，不同应用实例可以使用不同工厂。 */
const definitions = new WeakMap<object, () => StoreState>()

/** 在 App.onLaunch 中安装全局状态；已有连接时禁止替换状态工厂。 */
export function installGlobalStore<S extends StoreState>(
  app: object,
  definition: StoreDefinition<S, 'global'>,
): void {
  if (roots.has(app) || initializing.has(app))
    throw new Error('全局 Store 必须在首个实例接入之前安装')
  definitions.set(app, definitionFactory(definition, 'global'))
}

/** 按 App 对象身份托管私有管理器，不创建跨 App 模块单例状态。 */
const roots = new WeakMap<object, StoreRoot>()
/** 工厂尚未完成时禁止重入，失败后允许明确重试。 */
const initializing = new WeakSet<object>()

/** 任一区域首次接入时才创建根，工厂失败不发布未完成状态。 */
function rootFor(app: object): StoreRoot {
  let root = roots.get(app)
  if (!root) {
    if (initializing.has(app)) throw new Error('Store 全局工厂不能递归初始化')
    initializing.add(app)
    try {
      root = createStoreRoot(
        definitions.get(app) ?? (() => ({})),
        storePlugins(),
      )
      roots.set(app, root)
    } finally {
      initializing.delete(app)
    }
  }
  return root
}

/** 框架为已启用全局选项的实例建立独立连接。 */
export function connectGlobal(
  app: object,
  alive: () => boolean,
): StoreConnection {
  return rootFor(app).connectGlobal(alive)
}

/** 所有插件通过同一个 App 根连接，不建立公开区订阅。 */
export function connectPlugin<S extends StoreState>(
  app: object,
  plugin: StorePlugin<S>,
  token: object,
  context: StorePluginContext,
  alive: () => boolean,
): StoreConnection<S> {
  return rootFor(app).connectPlugin(plugin, token, context, alive)
}

/** 不为清理动作创建根，仅移除已存在的所属页条目。 */
export function releasePage(app: object, token: object): void {
  roots.get(app)?.releaseOwner(token)
}

/** 框架或隔离验证显式销毁 App 时失效旧根，业务入口不导出此能力。 */
export function disposeApp(app: object): void {
  roots.get(app)?.dispose()
  roots.delete(app)
  definitions.delete(app)
}
