import type { AppConfig, PageConfig } from './config.js'

/** 类型在编译期可见；运行时包装由构建器按使用情况自动引入。 */
declare global {
  /** 声明使用 Component 实现的页面，无须手动 import。 */
  const definePage: typeof import('./runtime.js').definePage
  /** 声明原生自定义组件，无须手动 import。 */
  const defineComponent: typeof import('./runtime.js').defineComponent
  /** 在页面 .config.ts 中直接注册配置，构建器负责捕获。 */
  function definePageConfig(config: PageConfig): void
  /** 在 app.config.ts 中直接注册配置，构建器负责捕获。 */
  function defineAppConfig(config: AppConfig): void
}
