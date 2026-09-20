// SPDX-License-Identifier: Apache-2.0
import { defineStoreDefinition } from '../../definition.js'
import type { StoreInitialState, StoreState } from '../../types.js'
import type { StorePluginContext } from '../../plugin.js'
import type { PageStoreDefinition } from './types.js'

/** 定义页面状态，每个页面实例分别初始化。 */
export function definePageStore<S extends StoreState>(
  factory: () => StoreInitialState<S>,
): PageStoreDefinition<S> {
  return defineStoreDefinition('page', factory)
}

/** 缺省定义只在插件内部保存，不向公共框架泄漏页面约定。 */
const emptyPageDefinition = definePageStore(() => ({}))

/** 页面与参与组件始终使用所属页面声明的定义，缺省时各页创建空状态。 */
export function pageDefinition(
  options: StorePluginContext['ownerOptions'],
): object {
  return (
    (options.pageStoreDefinition as object | undefined) ?? emptyPageDefinition
  )
}
