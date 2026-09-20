# @miniprogramlab/core

[English](README.en.md)

面向原生微信小程序的类型化运行时封装与可扩展状态管理。Core 保留原生 `Component` 配置结构，并增加显式的状态参与开关及随生命周期管理的连接。

## 统一 API 入口

页面、组件和状态通过独立的 `definePage(...)`、`defineComponent(...)`、`defineGlobalStore(...)`、`definePageStore(...)`、`defineStorePlugin(...)` 声明，无需导入。编译期配置宏 `definePageConfig(...)`、`defineAppConfig(...)` 同样独立调用。导航、安装、注册等运行时操作直接调用 `navigateTo(...)`、`installGlobalStore(...)` 等独立函数；CLI 在页面、组件、App 和普通模块中按需注入这些入口，不向宿主写入全局变量。`PageEnum`、路由元数据及类型继续按需导入。组件实例和 Store 上的方法仍通过所属实例调用。

```ts
import { PageEnum } from '@miniprogramlab/routes'

definePage({
  methods: {
    /** 直接导航，调用无需等待或捕获异常。 */
    openMine(): void {
      navigateTo(PageEnum.mine).go()
    },
  },
})
```

| 能力 | 示例 |
| --- | --- |
| 页面和组件声明 | `definePage`、`defineComponent` |
| 编译期配置 | `defineAppConfig`、`definePageConfig` |
| 路由 | `navigateTo`、`navigateToUrl`、`navigateBack`、`getRouteUrl`、`getEntryRouteUrl`、`isRouteAvailable` |
| 状态与插件 | `defineGlobalStore`、`installGlobalStore`、`definePageStore`、`defineStorePlugin`、`registerStorePlugin` |
| UI 与底栏 | `installUiComponents`、`installTabBar`、`configureTabBar`、`updateTabBarItem`、`resetTabBar` |

### API 命名规则

以下规则适用于自动注入的公开 API 和平台通过 `apiModules` 提供的扩展 API。全部直接调用，无须 `mini.` 前缀或手动导入。源码变量与函数采用小驼峰；函数以动词开头，并包含明确的业务对象，避免 `getConfig`、`reset` 等脱离上下文的名称。缩写按单词处理，例如 `Url`、`Ui`。

| 用途 | 命名形式 | 示例 |
| --- | --- | --- |
| 声明配置或定义 | `defineX` | `definePage`、`defineGlobalStore` |
| 创建实例或初始值 | `createX` | `createRouter`、`createTabBarConfig` |
| 读取数据 | `getX` | `getRouteUrl`、`getEntryRouteUrl`、`getTabBarSnapshot` |
| 布尔判断 | `isX` / `hasX` / `canX` | `isRouteAvailable`、`isOverlayBlocked` |
| 安装、注册与订阅 | `installX` / `registerX` / `subscribeX` | `installUiComponents`、`registerStorePlugin`、`subscribeTabBar` |
| 配置和状态变更 | `configureX` / `updateX` / `resetX` | `configureTabBar`、`updateTabBarItem`、`resetTabBar` |
| 业务动作 | 动词＋业务目标 | `navigateTo`、`navigateBack`、`enterOverlay` |
| 转换与派生 | `resolveX` / `formatX` / `normalizeX` / `deriveX` | `resolveTabBarValue`、`formatTabBarBadge`、`deriveTabBarPalette` |
| 常量、注册表和插件对象 | 业务名词 | `libraryComponents`、`lightTabBarTheme`、`pageStorePlugin` |

导航链内部已有页面上下文，继续使用 `params`、`success`、`fail`、`go`、`replace`、`reLaunch` 等短名。路由操作统一使用链式入口，不提供 `Async` 后缀或重复的即时执行方法；是否等待由调用方使用 `await` 决定。独立函数、命名导出与 Router 实例的方法名完全一致。组件和 Store 的实例方法仍通过实例调用。Node 构建配置不经过应用自动注入，使用同名命名导入。

| 原公开名 | 统一后的独立调用 |
| --- | --- |
| `overlayBlocked` / `overlayCovered` | `isOverlayBlocked(...)` / `isOverlayCovered(...)` |
| `installComponents` | `installUiComponents(...)` |
| `createDefaultConfig` | `createTabBarConfig()` |
| `visibleTabItems` | `getVisibleTabBarItems(...)` |
| `resolveTabValue` / `formatTabBadge` | `resolveTabBarValue(...)` / `formatTabBarBadge(...)` |
| `normalizeTabColor` / `deriveTabPalette` | `normalizeTabBarColor(...)` / `deriveTabBarPalette(...)` |
| `lightTabTheme` / `darkTabTheme` | `lightTabBarTheme` / `darkTabBarTheme` |

API 清单分别由 Core 的 `src/api.ts`、`src/definitions.ts` 和 UI 的 `src/api.ts`、`src/config-api.ts` 维护。CLI 从实际导出生成注入绑定与声明，保留泛型和函数注释；公开名称冲突在生成阶段报错。局部同名声明按正常词法作用域优先，框架不会覆盖业务变量。配置阶段仅注入纯配置辅助函数，Worklet 禁止捕获逻辑线程 API。

应用 TypeScript 配置继承 `.cache/tsconfig.routes.json`，生成配置会同时加载全部独立 API 的全局类型，即使源文件未导入路由模块也能获得提示。首次执行 `miniprogram routes`、`dev` 或 `build` 时生成缓存；不要在应用 `tsconfig.json` 中用自己的 `files` 覆盖生成声明，确需设置时应同时保留 `.cache/api.globals.d.ts`。

路由方法保留 `PageEnum` 对应的路径与参数类型，通过 `navigateTo` 或 `navigateBack` 构建导航链；未注册回调时终结方法返回 Promise，注册回调后禁止 `await`。平台由 CLI 选择；页面包装器、Store 与 UI 目前仅在微信运行时提供，未安装 UI 时不会添加 UI API。配置求值只提供配置声明与纯配置函数，不初始化路由。底层包仍各自维护实现，Core 不依赖 UI；平台可通过 `apiModules` 追加公开 API 模块，导出名称须唯一。Worklet 在 UI 线程执行，不能调用逻辑线程的框架 API，编译器会明确报错。编译器只保留使用到的成员，不向宿主的全局对象赋值，也不会覆盖业务局部的同名绑定。

Node 构建配置在 CLI 注入之前执行，因此 `miniprogram.config.mjs` 通过 `import { defineConfig, definePlatformAdapter } from '@miniprogramlab/cli'` 按需导入声明函数，不添加 `mini.`。

## 功能

- `definePage`、`defineComponent` 保留 data、properties、methods、Behavior 和 `this` 类型推导。
- 全局状态按 App 实例隔离，页面状态按确认后的页面归属隔离。
- Store 门面仅暴露 `update`、`on`，订阅者接收不可变快照。
- 支持顶层对象补丁和同步写时复制草稿。
- 连接与订阅随所属实例释放，失效句柄不会重新绑定到新页面。
- 注册插件可增加隔离状态区域及校验规则，无需在核心中增加按插件名称分支的逻辑。
- 内置页面与弹层插件共用注册、提交和清理机制。

## 跨平台路由

Core 内部独立的路由模块，全部实现集中在 `src/router/`：路由契约、名称与参数类型、URL 编解码、环境检查、平台注册表及微信/抖音/支付宝导航适配器。由 CLI 生成的 `@miniprogramlab/routes` 导出应用级实例，内部使用 `@miniprogramlab/core/router` 子入口，不加载 Core 的微信页面包装器或 UI。

### 使用

安装 Core 与 CLI，按 [CLI 文档](../cli/README.md#统一路由入口)接入生成的 TypeScript 配置：

```ts

import type { RouteName, TabPageName, RouteParams, AppRouter } from '@miniprogramlab/routes'

/** 直接使用当前应用的类型化实例，平台由 CLI 编译时选择。 */
const homeUrl = getEntryRouteUrl()
```

应用无需导入平台适配器或判断宿主。以对应平台的源码和工程配置运行：

```sh
pnpm exec miniprogram dev
pnpm exec miniprogram dev --platform=douyin
pnpm exec miniprogram dev --platform=alipay
```

默认平台为微信，别名 `wx`、`tt`、`my` 分别对应微信、抖音、支付宝。CLI 根据所选构建适配器的 `navigationAdapter`，在编译时将内部平台入口替换为具体导航模块，产物只包含该平台及共用代码。平台 API、模板和页面包装能力仍需符合目标平台要求。

`@miniprogramlab/routes` 统一导出 `router`、`PageEnum`、`routes`、`entryPageName` 和应用路由类型。同一应用的各个模块共享该 Router 实例，各应用和构建目标保持隔离，无需维护本地 navigation 目录。路由实现属于 Core，无独立路由 npm 包；Core 接收契约，不反向导入应用的生成模块。

### 模块边界

以下路径均相对于 `src/router/`。

| 文件或目录 | 职责 |
| --- | --- |
| `index.ts`、`types.d.ts` | 公共接口与跨平台类型协议 |
| `router.ts` | 独立实例、路由查询与导航语义 |
| `builder.ts` | 不可变导航配置、参数就绪状态与回调派发 |
| `contract.ts`、`codec.ts` | 契约校验、快照、参数校验及 URL 编解码 |
| `platform.ts` | CLI 编译时绑定的导航入口 |
| `adapters/` | 原生回调转换和三种宿主实现 |
| `registry.ts` | 可选的运行时适配器注册与别名解析 |

`@miniprogramlab/core/router/types` 可单独用于配置或工具类型声明。直接使用该子入口不要求应用启用微信全局类型。

### Router API

先选择编译后的页面路径枚举，再配置该页面的参数和回调。构建导航链不会跳转，调用 `.go()`、`.replace()` 或 `.reLaunch()` 才执行：

```ts
import { PageEnum } from '@miniprogramlab/routes'

// Tab 页面不提供 params，执行时自动切换底栏。
navigateTo(PageEnum.mine).go()

// 假设 detail 声明必填 id，编辑器按所选页面补全参数字段。
navigateTo(PageEnum.detail)
  .params({ id: '42' })
  .success((result) => { console.log(result.url, result.method) })
  .fail((error) => { console.error(error.message) })
  .go()

// 替换当前普通页面，目标为 Tab 时仍然切换底栏。
navigateTo(PageEnum.detail).params({ id: '42' }).replace()

// 重建页面栈；完整 URL 会在执行时解码并按应用路由契约校验。
navigateTo(PageEnum.detail).params({ id: '42' }).reLaunch()
navigateToUrl('/pages/detail/index?id=42').reLaunch()

// 返回操作独立于目标页导航，默认上一页，可指定返回层数。
navigateBack().go()
navigateBack(2).fail((error) => { console.error(error.message) }).go()
```

| 方法 | 行为 |
| --- | --- |
| `navigateTo(path)` | 从路径或页面枚举创建导航链，路径决定后续参数类型 |
| `navigateToUrl(url)` | 从完整应用内 URL 创建导航链，执行时校验查询参数，不提供 `.params()` |
| `.params(values)` | 一次设置完整参数快照；Tab 和无参数页面不提供此方法 |
| `.success(fn)` / `.fail(fn)` | 设置当前链的回调，顺序不限；注册任意回调后禁止 `await` |
| `.go()` | 普通页面入栈，Tab 页面切换底栏 |
| `.replace()` | 普通页面使用 `redirectTo`，Tab 页面使用 `switchTab` |
| `.reLaunch()` | 普通页面使用 `reLaunch` 重建页面栈，Tab 页面使用 `switchTab` |
| `navigateBack(delta = 1)` | 创建独立返回链，只提供 `success`、`fail` 和 `go` |
| `isRouteAvailable(path)` | 查询路径在当前环境是否启用 |
| `getRouteUrl(path, params?)` | 生成 URL；无效输入记录诊断并返回 `undefined` |
| `getEntryRouteUrl()` | 返回初始化时已校验的默认入口 URL |

有必填参数的页面，在调用 `.params()` 前不提供 `.go()`、`.replace()` 和 `.reLaunch()`；可选参数页允许直接执行。注册回调不会丢失页面类型或参数就绪状态。目标页导航链不提供 `.back()`，返回链不接受参数、替换或重建操作。

每次 `.params()`、`.success()`、`.fail()` 都返回独立分支，原链保持不变。参数按当前标量契约复制快照，重复设置参数时整体替换，重复设置同类回调时覆盖。每次调用终结方法都会发起一次导航。

导航失败由 Router 内部记录控制台诊断，并调用当前链的 `fail`，不弹窗。平台同步异常和异步失败都转换为结果对象。失败结果的 `error` 包含 `phase`（`resolve` 或 `navigate`）、`target`、`message` 和原始 `cause`。独立返回的 `target` 为 `navigateBack`；层数必须为正安全整数，超出栈长度时沿用原生平台行为。

回调与 `await` 是互斥用法。未注册 `success` 或 `fail` 时，终结方法返回 `Promise`，可直接忽略或等待导航结果。注册任意回调后，终结方法返回不可等待的执行标记，TypeScript 会拒绝直接等待、保存后等待或解构执行后等待；重新设置参数不会恢复等待能力。此规则适用于路径链和 URL 链的 `.go()`、`.replace()`、`.reLaunch()`，以及返回链的 `.go()`。回调可为异步函数；回调抛出或拒绝时独立记录诊断，成功回调异常不会触发 `fail`。

若通过 JavaScript 或类型断言绕过类型检查，等待回调模式的执行标记会抛出 `TypeError`；终结方法已经启动的导航不会撤销。执行标记也拒绝 `Promise.resolve` 等 Promise 同化操作。

后续操作依赖导航完成时，可以直接等待终结方法：

```ts
const result = await navigateTo(PageEnum.detail).params({ id: '42' }).go()
if (result.ok) {
  console.log(result.url, result.method)
}

await navigateTo(PageEnum.detail).params({ id: '42' }).replace()
await navigateBack().go()

// 类型错误：等待导航结果时不能同时注册回调。
await navigateTo(PageEnum.detail).params({ id: '42' }).success(() => {}).go()
```

目标页导航成功结果为 `{ ok: true, url, method }`；独立返回成功结果为 `{ ok: true, method: 'navigateBack', delta }`，其中 `delta` 为请求层数，不伪造目标 URL。失败结果统一为 `{ ok: false, error }`。

参数支持 string、number、boolean，按枚举中的页面路径推导必填及可选约束；拒绝未知字段、重复查询字段、非法布尔值和非有限数值。Tab 页面不接受查询参数。未启用页面保留枚举路径，`available: false` 阻止导航。默认入口必须启用且不能要求必填参数。路由实例创建时仍会抛出无效契约或适配器错误，方便尽早发现配置问题。

方法不依赖 `this`，可直接传入 UI。组件沿用同名导航协议，在独立入口返回时调用 `.reLaunch()` 并等待结果：

```ts
installUiComponents(app, {
  getEntryRouteUrl,
  navigateToUrl,
})
```

`navigateToUrl(url).reLaunch()` 重建页面栈打开目标入口；`navigateBack().go()` 返回已有页面。登录权限和业务页面栈策略由应用维护。

### 扩展平台

在 CLI 构建配置中给自定义平台声明导航模块，模块需导出 `createNavigationAdapter()`，返回符合 `NavigationAdapter` 的对象。模块路径可为包子入口、绝对路径或相对应用根目录的路径。自定义适配器按需实现 `redirectTo(url)` 和 `navigateBack(delta)`；调用平台未实现的能力时返回统一失败结果。

```js
import { defineConfig, definePlatformAdapter, createPlatformRegistry } from '@miniprogramlab/cli'

/** 自定义平台沿用所需原生格式，并提供独立导航实现。 */
const custom = definePlatformAdapter({
  ...createPlatformRegistry().resolve('douyin'),
  id: 'custom',
  aliases: ['own'],
  navigationAdapter: './src/platform/navigation.ts',
})
export default defineConfig({ platformAdapters: [custom] })
```

未声明导航模块的平台使用 Router 时会在构建中报错，不自动回退到微信。新增平台只需注册配置及实现，不修改路由核心或通用编译流程。

CLI 工程需要独立实例时调用 `createRouter`；非 CLI 宿主从 `@miniprogramlab/core/router` 导入 `createRouter` 并显式提供适配器，例如 `createRouter({ routes, entryPageName, adapter })`。三个原生工厂位于 `@miniprogramlab/core/router/adapters/wechat`、`douyin`、`alipay`，分别接受 API 对象或延迟获取函数。`createNavigationRegistry` 可用于特殊宿主的手动装配，注册冲突会原子拒绝；普通应用由 CLI 选平台即可。没有 CLI 注入且未显式传入适配器时会明确报错。

### 开发验证

```sh
pnpm --filter @miniprogramlab/core dev:test
pnpm --filter @miniprogramlab/checks dev:test
```

Core 测试覆盖契约、参数、实例隔离和宿主回调；checks 覆盖三平台自动选择、第三方导航模块、类型生成和产物隔离。模拟宿主检查不替代开发者工具及真机验证。

## TypeScript 配置

按[工具集文档](../README.md)安装 Core 和 CLI，并配置应用编译器：

```json
{
  "extends": "./.cache/tsconfig.routes.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["miniprogram-api-typings", "@miniprogramlab/core/globals"]
  }
}
```

使用全局 `definePage` 或 `defineComponent` 时，CLI 会按需注入运行时包装，业务无需逐个导入函数。`defineAppConfig` 用于应用构建期配置；`definePageConfig` 可与 `definePage` 同文件，也可写在页面同目录的任意脚本中，每个页面目录只声明一次。CLI 在构建时提取配置，并从运行代码中移除配置调用。

页面配置按 `page`（名称、枚举注释、参数或 Tab）、`build`（环境模式）和 `config`（原生字段）分组；平台由 CLI 统一选择。完整字段与迁移规则见 [CLI 页面配置 API](../cli/README.md#页面配置-api)。

## Tab 页面

微信原生自定义底栏页面通过页面配置自动接入 UI 底栏能力：

```ts
definePageConfig({
  page: {
    name: 'mine', description: '我的：账户与个人设置',
    tabBar: { text: '我的', order: 3, iconPath: '/icons/mine.png' },
  },
})
definePage({
  methods: {
    /** 页面重新显示时处理业务刷新，底栏选中项由框架同步。 */
    onShow() {
      const space = this.data.tabBarSpace ?? 0
      // 可按需使用底栏留白，模板直接读取 tabBarSpace。
      void space
    },
  },
})
```

在 `App.onLaunch` 中按 [UI 文档](../components/README.md#原生自定义底栏)调用 `installTabBar`。该入口同时为当前 App 安装页面适配器，Core 只调度生命周期，UI 负责导航同步和留白计算，不产生 Core 对 UI 的反向依赖。

开启后自动订阅配置，显示时同步所属底栏，窗口尺寸变化时重算留白，卸载时取消订阅。业务自身或 Behavior 提供的 `onShow`、`onResize` 保留 `this`、参数和返回值；原有 `behaviors` 不需要调整。模板仍通过 `<page bottom-space="{{tabBarSpace}}">` 使用额外空间，安全区由 `page` 组件处理。

CLI 从 `page.tabBar` 判断 Tab 身份，`definePage` 不再接受 `tabPage`。只有应用启用 `tabBar.custom: true` 时才注入自定义底栏行为。配置可独立成文件，因此页面中的 `tabBarSpace` 类型为 `number | undefined`；页面不能在 `data` 或 `properties` 中重复声明该框架字段。

## 全局状态

在 `stores/global.ts` 中创建定义：

```ts

/** 为每个 App 实例创建独立的公共状态。 */
export const globalStoreDefinition = defineGlobalStore(() => ({ count: 0 }))
```

在页面建立连接之前安装：

```ts

import { globalStoreDefinition } from './stores/global.js'

App({
  /** 在应用初始化时安装状态。 */
  onLaunch() {
    installGlobalStore(this, globalStoreDefinition)
  },
})
```

在 `.d.ts` 文件中声明应用的全局状态类型：

```ts
import type { StoreStateOf } from '@miniprogramlab/core'
import type { globalStoreDefinition } from './stores/global.js'

declare module '@miniprogramlab/core/store/global' {
  /** 扩展当前应用的公共全局状态类型。 */
  interface GlobalStoreRegistry {
    state: StoreStateOf<typeof globalStoreDefinition>
  }
}
```

参与的页面或组件开启 `globalStore: true` 后，可通过 `this.$globalStore` 操作状态，模板通过 `$globalStore` 读取快照。未安装定义时，公开状态初始化为空对象；已有连接后不能更换定义。

## 页面状态与订阅

```ts

/** 为每个页面实例独立初始化状态。 */
const counter = definePageStore(() => ({ count: 0 }))

definePage({
  pageStore: true,
  pageStoreDefinition: counter,
  data: { count: 0 },
  methods: {
    /** 将已提交的页面状态映射到渲染数据。 */
    onLoad() {
      this.$pageStore.on((next) => this.setData({ count: next.count }), {
        immediate: true,
      })
    },
    /** 提交一次同步更新。 */
    increment() {
      this.$pageStore.update((draft) => { draft.count += 1 })
    },
  },
})
```

页面参与者共享所属页面声明的定义。页面状态通过订阅显式投影到模板，不会自动复制到模板数据中。`on` 返回可重复调用的取消函数，生命周期清理也会自动移除订阅。

`update({ count: 1 })` 按顶层字段合并。草稿更新原子提交，无变化时不通知订阅者。状态仅支持普通可序列化对象、数组和标量；异步草稿、草稿内嵌套更新、访问器、类实例、循环引用及内部保留字段均会被拒绝。

## Store 插件

通过 `defineStorePlugin` 声明私有区域键、参与开关、状态工厂和可选的同步校验器。必须在**首次声明页面、组件或初始化 App 根容器之前**调用 `registerStorePlugin`。

插件通过模块扩展补充 `@miniprogramlab/core/store/plugin` 中的 `StorePluginStates`，必要时补充 `StorePluginOptions`，包装器据此推导参与者门面。注册时检查名称冲突，首次使用时冻结插件集合。

原生弹层适配器位于 `@miniprogramlab/core/store/plugins/overlay/adapters/`，与纯状态模块分离。它们连接页面归属与滚动能力，不会把原生句柄写入 Store 快照。

## 开发与分发

Core 分发 TypeScript 源码，由 `@miniprogramlab/cli` 编译，不是预编译的浏览器或 Node.js 运行时。

```sh
pnpm --filter @miniprogramlab/core dev:check
pnpm --filter @miniprogramlab/core dev
pnpm --filter @miniprogramlab/core dev:test
```

采用 [Apache-2.0](LICENSE)，版权及依赖声明见 [NOTICE](NOTICE)。
