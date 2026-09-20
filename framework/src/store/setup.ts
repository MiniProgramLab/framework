// SPDX-License-Identifier: Apache-2.0
import { createStorePluginRegistry } from './plugin.js'
import { pageStorePlugin } from './plugins/page/index.js'
import { overlayStorePlugin } from './plugins/overlay/index.js'

/** 默认装配入口只注册声明，模块加载时不创建任何 App 或页面状态。 */
const registry = createStorePluginRegistry()
registry.register(pageStorePlugin)
registry.register(overlayStorePlugin)

/** 自定义插件须在首个 definePage、defineComponent 或 App 根创建前注册。 */
export const registerStorePlugin = registry.register
/** 根容器和实例适配器共享不可变插件列表，避免装配顺序造成遗漏。 */
export const storePlugins = registry.seal
