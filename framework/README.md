# @miniprogramlab/core

原生微信组件包装与 Store 框架，保留 `definePage` / `defineComponent`、全局和页面状态、响应订阅、页面归属、弹层状态及自定义插件机制。

```ts
import { defineGlobalStore, installGlobalStore } from '@miniprogramlab/core'

/** 应用自己的状态定义，每个 App 实例单独初始化。 */
const definition = defineGlobalStore(() => ({ count: 0 }))

App({
  /** 页面建立连接之前装配公开状态。 */
  onLaunch() {
    installGlobalStore(this, definition)
  },
})
```

未安装全局定义时使用空状态。已有连接后重新安装会报错；应用状态不会保存在跨 App 单例中。组件包只消费框架 API，不直接读取业务 Store 源文件。

## 类型与声明

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["miniprogram-api-typings", "@miniprogramlab/core/globals"]
  }
}
```

通过声明合并让 `$globalStore` 保留应用字段类型：

```ts
import type { StoreStateOf } from '@miniprogramlab/core'
import type { globalStoreDefinition } from './stores/global.js'

/** 提供当前应用全局状态的编译期类型。 */
declare module '@miniprogramlab/core/store/global' {
  interface GlobalStoreRegistry {
    /** 应用公开状态。 */
    state: StoreStateOf<typeof globalStoreDefinition>
  }
}
```

页面和组件可直接调用全局 `definePage`、`defineComponent`；CLI 按使用情况注入运行时包装。也可以从包入口显式导入。`defineAppConfig`、`definePageConfig` 只在配置编译上下文中使用。

公开根入口包含 Store 定义、`installGlobalStore`、`defineStorePlugin`、`registerStorePlugin` 和相关类型。Store、弹层适配器及 Worklet 可从 `@miniprogramlab/core/store/...` 子路径导入。插件必须在首次注册页面/组件之前安装，页面和组件的 Store 开关及 `update/on` 使用方式保持一致。

以源码发布并由 `@miniprogramlab/cli` 编译，保留完整类型及 Worklet 边界。`pnpm dev:check` 可独立完成类型检查。
