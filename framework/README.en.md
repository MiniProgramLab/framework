# @miniprogramlab/core

[简体中文](README.md)

Typed runtime wrappers and extensible state management for native WeChat mini programs. Core preserves the native `Component` option model while adding explicit state participation and lifecycle-managed connections.

## Unified API entry

Declarations use standalone `definePage(...)`, `defineComponent(...)`, `defineGlobalStore(...)`, `definePageStore(...)`, and `defineStorePlugin(...)` calls without imports. Build-time macros `definePageConfig(...)` and `defineAppConfig(...)` are also standalone calls. Navigation, installation, and registration operations are direct calls such as `navigateTo(...)` and `installGlobalStore(...)`. The CLI injects these bindings into pages, components, App entries, and ordinary modules without mutating host globals. Import `PageEnum`, route metadata, and types as needed. Component and Store instance methods remain on their owning instances.

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

| Capability | Examples |
| --- | --- |
| Pages and components | `definePage`, `defineComponent` |
| Build-time configuration | `defineAppConfig`, `definePageConfig` |
| Routing | `navigateTo`, `navigateToUrl`, `navigateBack`, `getRouteUrl`, `getEntryRouteUrl`, `isRouteAvailable` |
| State and plugins | `defineGlobalStore`, `installGlobalStore`, `definePageStore`, `defineStorePlugin`, `registerStorePlugin` |
| UI and tab bar | `installUiComponents`, `installTabBar`, `configureTabBar`, `updateTabBarItem`, `resetTabBar` |

### API naming rules

Public APIs are direct calls without a namespace or imports in application code. Use lower camel case with a verb and a domain object: `defineX` for declarations, `createX` for factories, `getX` for reads, `isX`/`hasX`/`canX` for predicates, and `installX`/`registerX`/`subscribeX` for lifecycle operations. Mutations use domain-specific verbs such as `configureTabBar`, `updateTabBarItem`, and `resetTabBar`. Treat abbreviations as words (`Url`, `Ui`). Constants and plugin objects use domain nouns.

Examples include `navigateTo`, `navigateBack`, `getRouteUrl`, `getEntryRouteUrl`, `isOverlayBlocked`, `installUiComponents`, `createTabBarConfig`, `getVisibleTabBarItems`, `resolveTabBarValue`, and `deriveTabBarPalette`. Builder methods keep short contextual names: `params`, `success`, `fail`, `go`, `replace`, and `reLaunch`. Navigation uses a single builder API without `Async` variants or duplicate immediate methods. Standalone functions, named exports, and Router methods have identical names.

Core and UI maintain explicit API manifests. The CLI derives both injection bindings and global types from their actual exports, preserving generics and documentation. Duplicate names are rejected, local bindings keep lexical precedence, configuration evaluation only receives pure helpers, and Worklets cannot capture logic-thread framework APIs. Node build configuration uses named imports because it runs before injection. See the [complete name migration table](README.md#api-命名规则).

Extend `.cache/tsconfig.routes.json` in the application's TypeScript configuration. It loads the generated global types for standalone APIs even when no source file imports routes. Run `miniprogram routes`, `dev`, or `build` to create the cache. If the application defines its own `files` array, retain `.cache/api.globals.d.ts` in that array.

Navigation retains path and parameter inference from `PageEnum`. Builders execute only through their terminal methods. Without callbacks, the result can be ignored or awaited; registering a callback makes the execution non-awaitable. The CLI selects the platform. Page wrappers, Store, and UI currently require the WeChat runtime; UI APIs are added only when UI is installed. Configuration evaluation exposes configuration macros and pure helpers without initializing routes. Packages own their implementations, Core does not depend on UI, and adapters can add public modules through `apiModules` with unique export names. Worklets execute on the UI thread and cannot call logic-thread framework APIs; compilation rejects such calls. The compiler retains referenced members, without mutating host globals or replacing local bindings with matching names.

Node configuration runs before injection. In `miniprogram.config.mjs`, import declarations directly, for example `import { defineConfig, definePlatformAdapter } from '@miniprogramlab/cli'`, without a `mini.` prefix.

## Features

- `definePage` and `defineComponent` preserve data, properties, methods, Behaviors, and `this` inference.
- Global state is isolated per App instance; page state is isolated by confirmed page ownership.
- Store facades expose only `update` and `on`, with immutable subscription snapshots.
- Updates accept top-level patches or synchronous copy-on-write drafts.
- Connections and subscriptions are released with their owning instances; stale handles cannot attach to new pages.
- Registered plugins add isolated state regions and validation without plugin-specific branches in the core.
- Built-in page and overlay plugins share the same registration, commit, and cleanup model.

## Cross-platform routing

A cohesive routing module inside Core. All runtime implementation lives in `src/router/`: contracts, route and parameter types, URL encoding and decoding, availability checks, adapter registration, and WeChat/Douyin/Alipay navigation adapters. CLI exports an application instance from `@miniprogramlab/routes`, backed by `@miniprogramlab/core/router` without loading Core's WeChat page wrappers or UI.

### Usage

Install Core and CLI, then connect the generated TypeScript configuration described in the [CLI guide](../cli/README.en.md#generated-route-entry):

```ts

import type { RouteName, TabPageName, RouteParams, AppRouter } from '@miniprogramlab/routes'

/** 直接使用当前应用的类型化实例，平台由 CLI 编译时选择。 */
const homeUrl = getEntryRouteUrl()
```

Applications do not import a platform adapter or detect the host. With the appropriate native source and project configuration, run:

```sh
pnpm exec miniprogram dev
pnpm exec miniprogram dev --platform=douyin
pnpm exec miniprogram dev --platform=alipay
```

WeChat is the default. Aliases `wx`, `tt`, and `my` resolve to WeChat, Douyin, and Alipay. At compile time, CLI replaces the internal platform entry with the selected build adapter's `navigationAdapter` module. Output contains only that platform and shared code. Application APIs, templates, and page wrappers must still match the target platform.

`@miniprogramlab/routes` exports `router`, `PageEnum`, `routes`, `entryPageName`, and concrete application types. Modules within one application share the Router instance; applications and build targets remain isolated. No local navigation directory is needed. The runtime belongs to Core, with no separate router npm package. Core accepts route data without importing the generated application module.

### Module boundaries

Paths below are relative to `src/router/`.

| File or directory | Responsibility |
| --- | --- |
| `index.ts`, `types.d.ts` | Public entry and platform-neutral contracts |
| `router.ts` | Isolated instances, lookup, and navigation semantics |
| `contract.ts`, `codec.ts` | Contract snapshots, validation, and URL encoding/decoding |
| `platform.ts` | Navigation entry bound by CLI at compile time |
| `adapters/` | Native callback conversion and the three host implementations |
| `registry.ts` | Optional runtime adapter registration and alias resolution |

`@miniprogramlab/core/router/types` provides standalone types for configuration and tools. This subentry does not require applications to enable WeChat globals.

### Router API

Choose a route, configure parameters and callbacks, then execute a terminal method:

```ts
import { PageEnum } from '@miniprogramlab/routes'

navigateTo(PageEnum.mine).go()
navigateTo(PageEnum.detail).params({ id: '42' }).replace()
navigateTo(PageEnum.detail).params({ id: '42' }).reLaunch()
navigateToUrl('/pages/detail/index?id=42').reLaunch()
navigateBack(2).go()
```

| Method | Behavior |
| --- | --- |
| `navigateTo(path)` | Create a builder with parameters inferred from the path or enum |
| `navigateToUrl(url)` | Create a builder for a complete in-app URL; decode and validate on execution, with no `.params()` method |
| `navigateBack(delta = 1)` | Create a back builder with callbacks and `.go()` only |
| `.params(values)` | Snapshot the selected page's parameters; unavailable on tabs or parameterless pages |
| `.success(fn)` / `.fail(fn)` | Create an independent callback branch that cannot be awaited |
| `.go()` | Push a regular page or switch tabs |
| `.replace()` | Replace the current regular page or switch tabs |
| `.reLaunch()` | Rebuild the stack for a regular page or switch tabs |
| `getRouteUrl(path, params?)` | Generate a URL; report invalid input and return `undefined` |
| `getEntryRouteUrl()` | Return the entry URL validated at initialization |
| `isRouteAvailable(path)` | Check whether the path is enabled in this mode |

Required parameters must be supplied before any terminal method is available. Callback registration preserves that restriction. Each configuration method returns an independent branch. The back builder has no parameters, replacement, or reset operations.

Without callbacks, terminal methods return a Promise that resolves to a result object. Registering either callback makes execution non-awaitable in TypeScript and at runtime. The same rule covers path, URL, and back builders; callback exceptions are logged separately from navigation failures.

```ts
const result = await navigateTo(PageEnum.detail).params({ id: '42' }).go()
if (result.ok) console.log(result.url, result.method)

navigateToUrl('/pages/detail/index?id=42').fail((error) => {
  console.error(error.message)
}).reLaunch()
```

Successful target navigation returns `{ ok: true, url, method }`; back navigation returns `{ ok: true, method: 'navigateBack', delta }`. Failures return `{ ok: false, error }` with `phase`, `target`, `message`, and the original `cause`, and are logged internally without popups.

Parameters retain required/optional and string/number/boolean constraints. Unknown or duplicate query fields, invalid booleans, nonfinite numbers, and disabled routes are rejected. Tabs accept no query parameters. The entry must be enabled with no required parameters. Invalid contracts or adapters still fail at Router initialization.

Methods are independent of `this`. UI components use the same names and reset the stack when returning from a standalone entry:

```ts
installUiComponents(app, { getEntryRouteUrl, navigateToUrl })
```

`navigateToUrl(url).reLaunch()` opens a destination with a rebuilt stack; `navigateBack().go()` returns to an existing page. Authentication and application-specific stack policies remain in the application.

### Additional platforms

Declare a navigation module on a custom CLI build adapter. It must export `createNavigationAdapter()` returning a `NavigationAdapter`. The reference may be a package subentry, an absolute path, or a path relative to the application root.

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

Using Router on a platform without a navigation module fails during compilation, without falling back to WeChat. New platforms register their configuration and implementation without changing the routing core or shared compiler.

CLI applications create independent instances through `createRouter`. Non-CLI hosts import `createRouter` from `@miniprogramlab/core/router` and provide an explicit adapter; the equivalent CLI call is `createRouter({ routes, entryPageName, adapter })`. Native factories remain available at `@miniprogramlab/core/router/adapters/wechat`, `douyin`, and `alipay`; they accept an API object or a lazy provider. `createNavigationRegistry` supports manual composition for specialized hosts and rejects registration conflicts atomically. Ordinary applications use CLI platform selection. Without compiler injection or an explicit adapter, Router reports a clear error.

### Development checks

```sh
pnpm --filter @miniprogramlab/core dev:test
pnpm --filter @miniprogramlab/checks dev:test
```

Core tests cover contracts, parameters, isolation, and host callbacks. Integration checks cover automatic platform selection, third-party navigation modules, generated types, and output isolation. Simulated host checks do not replace DevTools or device validation.

## TypeScript setup

Install Core with the CLI as described in the [toolkit guide](../README.en.md). Configure the application compiler:

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

The CLI injects runtime wrappers when global `definePage` or `defineComponent` calls are used. Application code does not import individual functions. `defineAppConfig` configures the application at build time. `definePageConfig` may share a file with `definePage` or appear in any script in the same page directory, with exactly one configuration per page directory. The CLI extracts configuration at build time and removes its call from runtime output.

Page configuration groups `page` (name, enum documentation, parameters or tab), `build` (modes), and `config` (native fields). The CLI selects the platform. See the [CLI page configuration API](../cli/README.en.md#page-configuration-api) for fields and migration rules.

## Tab pages

Declare tab metadata to enable UI tab bar integration for a native WeChat tab page:

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

Call `installTabBar` in `App.onLaunch` as described in the [UI guide](../components/README.en.md#native-custom-tab-bar). It also installs the page adapter for that App. Core dispatches lifecycle events while UI handles selection and spacing, without a reverse dependency from Core to UI.

Enabled pages subscribe to configuration updates, synchronize their own tab bar when shown, recalculate spacing after resizing, and unsubscribe on detach. Existing page or Behavior `onShow` and `onResize` methods retain their `this`, arguments, and return values; keep any other `behaviors` as usual. Templates continue to use `<page bottom-space="{{tabBarSpace}}">`, with safe-area spacing handled by the `page` component.

The CLI derives tab membership from `page.tabBar`; `definePage` has no `tabPage` option. Custom tab behavior is injected only when the application enables `tabBar.custom: true`. `tabBarSpace` has type `number | undefined` because configuration may live in a separate file. Pages must not redeclare this framework-owned field in `data` or `properties`.

## Global state

Create a definition in `stores/global.ts`:

```ts

/** 为每个 App 实例创建独立的公共状态。 */
export const globalStoreDefinition = defineGlobalStore(() => ({ count: 0 }))
```

Install it before pages establish connections:

```ts

import { globalStoreDefinition } from './stores/global.js'

App({
  /** 在应用初始化时安装状态。 */
  onLaunch() {
    installGlobalStore(this, globalStoreDefinition)
  },
})
```

Declare the application's global shape in a `.d.ts` file:

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

Enable `globalStore: true` on participating pages or components. The instance receives `this.$globalStore`; its template receives the `$globalStore` snapshot. Without an installed definition, the public state starts empty. Replacing the definition after connections exist is rejected.

## Page state and subscriptions

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

Page participants share their owning page's definition. Page state is projected explicitly through subscriptions rather than automatically copied into templates. `on` returns an idempotent unsubscribe function, and lifecycle cleanup also removes subscriptions automatically.

`update({ count: 1 })` merges top-level fields. Draft updates commit atomically; no-op changes do not notify subscribers. State must use plain serializable objects, arrays, and scalar values. Async drafts, nested updates during a draft, accessors, class instances, cycles, and reserved internal fields are rejected.

## Store plugins

Use `defineStorePlugin` to declare a private region key, a participation option, a state factory, and optional synchronous validators. Register it with `registerStorePlugin` **before the first page/component declaration or App root initialization**.

Plugins augment `StorePluginStates` and, when needed, `StorePluginOptions` from `@miniprogramlab/core/store/plugin`. The wrapper derives participant facades from those types. Registration rejects conflicting names and freezes the plugin collection on first use.

Native overlay adapters are separate from pure state modules under `@miniprogramlab/core/store/plugins/overlay/adapters/`. They connect page ownership and scrolling capabilities without putting native handles in Store snapshots.

## Development and distribution

Core ships TypeScript source for compilation by `@miniprogramlab/cli`; it is not a precompiled browser or Node.js runtime.

```sh
pnpm --filter @miniprogramlab/core dev:check
pnpm --filter @miniprogramlab/core dev
pnpm --filter @miniprogramlab/core dev:test
```

Licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) for copyright and dependency notices.
