import type { StoreDefinition, StoreState } from '../../types.js'

/** 页面定义独立于实例，只有页面插件解释此定义。 */
export type PageStoreDefinition<S extends StoreState = StoreState> =
  StoreDefinition<S, 'page'>

/** 页面类型约定由插件提供，通用包装器只组合扩展接口。 */
declare module '../../plugin.js' {
  interface StorePluginStates<S extends StoreState = StoreState> {
    pageStore: S
  }
  interface StorePluginOptions<S extends StoreState = StoreState> {
    pageStoreDefinition?: PageStoreDefinition<S>
  }
}
