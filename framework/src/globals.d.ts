// SPDX-License-Identifier: Apache-2.0
import type { AppConfig, PageConfig } from './config.js'

/** 类型在编译期可见；运行时包装由构建器按使用情况自动引入。 */
declare global {
  /** 声明使用 Component 实现的页面，无须手动 import。 */
  const definePage: typeof import('./runtime.js').definePage
  /** 声明原生自定义组件，无须手动 import。 */
  const defineComponent: typeof import('./runtime.js').defineComponent
  /** 独立定义全局状态，无须手动 import。 */
  const defineGlobalStore: typeof import('./definitions.js').defineGlobalStore
  /** 独立定义页面状态，保留状态工厂的类型推导。 */
  const definePageStore: typeof import('./definitions.js').definePageStore
  /** 独立定义状态插件，运行时通过 registerStorePlugin 注册。 */
  const defineStorePlugin: typeof import('./definitions.js').defineStorePlugin
  /** 在页面同目录声明路由、构建范围与原生配置，可与 definePage 同文件。 */
  function definePageConfig(config: PageConfig): void
  /** 在 app.config.ts 中直接注册配置，构建器负责捕获。 */
  function defineAppConfig(config: AppConfig): void
}
