# @miniprogramlab/cli

[简体中文](README.md)

A TypeScript build CLI with registered platform adapters, exposed as the `miniprogram` command. **WeChat is the default platform.** The built-in adapters build WeChat Skyline, Douyin native, and Alipay native source projects.

Declarations use standalone calls such as `definePage(...)` and `defineComponent(...)`. Navigation and installation operations are also standalone calls; the CLI injects both kinds of bindings as needed. See [Unified API entry](../framework/README.en.md#unified-api-entry) for page, component, state, routing, and UI setup.

## Build features

- Compile reachable TypeScript/JavaScript dependencies to CommonJS while preserving shared module identity.
- Inline `.worklet.ts` and `.worklet.js` dependencies with their callers on WeChat.
- Compile SCSS and Less, including Sass package imports and nested Less imports; copy the selected platform’s native styles, templates, and assets.
- Discover pages and generate native registrations plus route constants, page names, parameter types, and TypeScript resolution for `@miniprogramlab/routes`.
- Resolve native npm components and source packages with TypeScript, `.config.ts`, templates, and styles.
- Relocate an optional package-based custom tab bar directly to `custom-tab-bar/index.*`.
- Stage builds, preserve existing private settings, and recover previous output after failed updates.

## Requirements and installation

Use Node.js 22 or newer. Install the CLI archive with TypeScript and `miniprogram-api-typings`; install Core and UI archives if the application uses them. The [toolkit guide](../README.en.md) describes generating and installing these packages.

## Commands

```sh
pnpm exec miniprogram dev
pnpm exec miniprogram build --mode=development --typecheck
pnpm exec miniprogram build --mode=production --typecheck
pnpm exec miniprogram routes
pnpm exec miniprogram --help
```

`dev` enables watching. `build` performs one build unless `--watch` is supplied. `routes` generates route constants, application types, and TypeScript configuration without updating native output. Type checking is opt-in through `--typecheck`.

| Option | Behavior |
| --- | --- |
| `--platform <name>` | Select wechat (default), douyin, alipay, or a registered adapter; aliases: wx, tt, my |
| `--root <path>` | Consumer project root; defaults to the current directory |
| `--config <path>` | Configuration path relative to the project root; defaults to `miniprogram.config.mjs` |
| `--src <path>` | Override the configured source directory, which defaults to `src` |
| `--out-dir <path>` | Override the configured output directory, which defaults to `dist` on WeChat and `dist-<platform>` elsewhere |
| `--mode <name>` | Select an environment; otherwise use `MINIPROGRAM_MODE`, then the platform variable (`WX_MODE`, `TT_MODE`, `ALIPAY_MODE`), then development for watching or production for a single build |
| `--watch` | Watch and rebuild after source changes |
| `--poll` | Use polling instead of native file watchers |
| `--typecheck` | Run TypeScript checking after route types are generated |
| `--version` | Print the CLI version |

`routes` defaults to development mode when `--mode` is omitted. Directory options resolve relative to `--root`.

## Platform selection

```sh
pnpm exec miniprogram build --mode=development
pnpm exec miniprogram build --platform=douyin --mode=development
pnpm exec miniprogram build --platform=alipay --mode=development
```

| Platform | Template | Native style | Output project file |
| --- | --- | --- | --- |
| WeChat | `.wxml` | `.wxss` | `project.config.json` |
| Douyin | `.ttml` | `.ttss` | `project.config.json` |
| Alipay | `.axml` | `.acss` | `mini.project.json` |

CLI arguments override `MINIPROGRAM_PLATFORM`, then the configured `platform`, then the default `wechat`. `platforms` uses canonical names after alias resolution. Each target can override `source`, `outDir`, `projectConfig`, `customTabBar`, `watchDirectories`, and `poll`.

```js
import { defineConfig } from '@miniprogramlab/cli'

/** 按目标隔离源码、产物和开发者工具配置。 */
export default defineConfig({
  platform: 'wechat',
  platforms: {
    wechat: { source: 'src/wechat', outDir: 'dist/wechat' },
    douyin: { source: 'src/douyin', outDir: 'dist/douyin', projectConfig: 'douyin.project.json' },
    alipay: { source: 'src/alipay', outDir: 'dist/alipay' },
  },
})
```

Douyin and Alipay projects use native `App`, `Page`, and `Component`, their own template syntax and native configuration fields. The CLI shares compilation and route metadata; it does not translate WeChat APIs or WXML into another platform. Core page wrappers, UI, Skyline, Worklets and custom tab components target WeChat; Core Router supports all three platforms, and unsupported use is rejected. Douyin uses `tabBar.list`; Alipay uses `tabBar.items` with `name`, `icon`, and `activeIcon` generated from `page.tabBar`. Both use the first page as the entry.

Native projects retain `app.config.ts`, `entryPageName` and `page.name`. Page configuration is discovered through a `definePageConfig` call in the page directory, regardless of the configuration filename. Add `@miniprogramlab/cli/globals` to TypeScript `types` for configuration helpers and build constants, alongside the target platform's native API declarations. App/page scripts may be `.ts` or `.js`; provide exactly one per entry. Templates keep their original platform syntax. Core-based WeChat projects continue using `@miniprogramlab/core/globals`.

## Register another platform

Use `definePlatformAdapter` and register the result in `platformAdapters`. The exported `PlatformAdapter` protocol covers file extensions, environment prefixes, project/page/app configuration, tab validation, optional runtime injection and dependency validation. The registry rejects duplicate IDs and aliases. Each build gets an isolated registry; new adapters do not require changes to the shared compiler.

## Terminal output

Direct runs, parallel pnpm workspace tasks, redirected output, and CI retain the same CLI information. Interactive terminals add a cyan spinner for transient progress; clearing it never removes phase records. To prevent package prefixes in parallel workspace tasks and editor task reruns, set `reporter-hide-prefix=true` in the consuming project's root `.npmrc`. Also set `color=true` so pnpm passes color settings to child tasks running through pipes. For a single invocation, pass pnpm's `--reporter-hide-prefix --color` options. Set `NO_COLOR=1` when plain-text logs are needed.

Startup reports the platform, environment, project/source/output directories, build and project configuration, TypeScript checking status, and compression settings. When type checking is disabled, the CLI explicitly reports transpilation only and points to `--typecheck`.

Each build has a sequence number and start time. All six phases retain start records, results, and individual durations: configuration/routes, type/platform validation, templates/styles/assets, native components, script dependencies, and output validation/publication. Separate summary lines report pages, local/npm components, JavaScript and source map files, output file count and actual size, total duration, and output directory. Output statistics exclude developer-tool private settings, which remain in place and unchanged when already present.

Watch mode lists actual watched directories and its active mechanism. Changes are debounced and deduplicated, with every triggering path listed for each rebuild; file creation, modification, and deletion all trigger builds. Initial and subsequent build failures identify the failing phase and print diagnostics while keeping the watcher available for corrections. Shutdown confirms that watching has stopped. Changes to CLI configuration or `--mode` require restarting the command.

Severity labels use English: cyan `[INFO]`, green `[SUCCESS]`, yellow `[WARN]`, and red `[ERROR]`. Message bodies remain in Chinese, and multiline diagnostics retain a severity label on every line. CI and non-interactive terminals disable animation. `NO_COLOR` or `FORCE_COLOR=0` disables colors; `FORCE_COLOR=1` preserves colors in redirected logs without enabling animation.

## Minimal WeChat application

Create `miniprogram.config.mjs` in the project root:

```js
import { defineConfig } from '@miniprogramlab/cli'

/** 配置源码、输出目录及可选的包监听。 */
export default defineConfig({
  source: 'src',
  outDir: 'dist',
  watchDirectories: [],
})
```

Create `project.config.json`:

```json
{
  "compileType": "miniprogram",
  "miniprogramRoot": "./",
  "setting": {
    "skylineRenderEnable": true,
    "compileWorklet": true
  }
}
```

Create `src/app.config.ts`:

```ts
defineAppConfig({
  entryPageName: 'home',
  renderer: 'skyline',
  componentFramework: 'glass-easel',
  lazyCodeLoading: 'requiredComponents',
  window: { navigationStyle: 'custom' },
  rendererOptions: {
    skyline: {
      defaultDisplayBlock: true,
      defaultContentBox: true,
      disableABTest: true,
      sdkVersionBegin: '3.0.0',
      sdkVersionEnd: '15.255.255',
    },
  },
})
```

Add the application entry and one page:

```ts
// 文件：src/pages/home/index.config.ts
/** 声明稳定的路由名称，由构建器发现页面路径。 */
definePageConfig({ page: { name: 'home' } })
```

```ts
// 文件：src/app.ts
App({})
```

```ts
// 文件：src/pages/home/index.ts
definePage({})
```

```xml
<!-- 文件：src/pages/home/index.wxml -->
<view>Hello MiniProgramLab</view>
```

Configure TypeScript with `miniprogram-api-typings` and `@miniprogramlab/core/globals` as shown in the [Core guide](../framework/README.en.md). Run `pnpm exec miniprogram build --mode=development --typecheck`, then import `dist` into WeChat DevTools.

Page styles use `index.scss`, `index.less`, or `index.wxss`. Sass partials beginning with `_` are imported rather than emitted as standalone files.

Page configuration can share a file with `definePage` or live in a separate script such as `config.ts` or `metadata.js` in the same directory. Separate configuration files do not need to be imported. The CLI discovers pages by directory under `src/pages`: each page directory has one entry and exactly one top-level `definePageConfig({...})` call. Missing or duplicate configurations fail the build; parent and child directories are not searched for a matching configuration.

```ts
// 文件：src/pages/home/index.ts
/** 配置仅在构建期求值，最终输出为 index.json。 */
definePageConfig({
  page: { name: 'home' },
  config: { navigationBarTitleText: __WX_ENV__.title },
})
/** 页面逻辑保留在运行时。 */
definePage({ data: {} })
```

Configuration may reference public environment constants, imported configuration data, and local constants or functions. Use declarative expressions rather than assignments in other top-level statements or application initialization. The CLI extracts only declarations used by the configuration, without executing page registration or unrelated business code. Runtime output removes the configuration call and its exclusive dependencies while preserving shared declarations. JSON output follows the page entry name: `screen.ts` produces `screen.json`, regardless of the configuration filename. Component `.config.ts` and application `app.config.ts` naming rules are unchanged.

## Page configuration API

`definePageConfig` takes one grouped object. The CLI `--platform` option and adapter select the target platform; pages contain no platform filters or platform overrides.

| Group | Fields and responsibility | Default |
| --- | --- | --- |
| `page` | `name` and `description` define the route name and enum documentation; `params` declares query parameters, or `tabBar` declares a tab item | `name` is required; a regular page when `tabBar` is absent |
| `build` | `modes`, a nonempty list of allowed build modes | Enabled in every mode |
| `config` | Native page fields such as title and `usingComponents` | Adapter defaults |

```ts
/** 普通页的名称和参数用于生成类型化 Router。 */
definePageConfig({
  page: {
    name: 'detail',
    description: '查看详情，支持按编号打开',
    params: { id: { type: 'string', required: true }, page: { type: 'number' } },
  },
  build: { modes: ['development', 'staging'] },
  config: {
    navigationBarTitleText: 'Details',
    usingComponents: { card: '/components/card/index' },
  },
})
```

```ts
/** 声明 tabBar 即表示 Tab 路由，不再重复填写 kind。 */
definePageConfig({
  page: {
    name: 'mine',
    description: '我的：账户与个人设置',
    tabBar: { text: 'Profile', order: 3, iconPath: '/icons/mine.png' },
  },
  config: { navigationBarTitleText: 'Profile' },
})
```

- `page.name` must be unique, start with a letter, and contain only letters, digits, or underscores. The entry file determines the native path.
- Parameters support `string`, `number`, and `boolean`; `required` defaults to `false`. Tab pages cannot declare `params`.
- `page.tabBar` requires `text`, a nonnegative integer `order`, and `iconPath`. `selectedIconPath` is optional; `id` defaults to `page.name`. Tab IDs and orders must be unique.
- When `build.modes` excludes the current `--mode`, the page directory is omitted from output. The Router retains its name type but marks it unavailable. The application entry must be available and must not require query parameters.
- `page` and `build` are compile-time metadata. Only `config` becomes native page JSON after adapter validation, defaults, and component path rewriting. Functions, `undefined`, and circular values are rejected.
- `page.description` becomes the generated `PageEnum` enum member documentation; it defaults to the page name.
- The presence of `page.tabBar` marks a tab page. With application-level `tabBar.custom: true`, the CLI automatically adds synchronization, spacing, and cleanup to `definePage`. Native tab bars remain platform-managed. `definePage` no longer accepts `tabPage`.

Migration: move `pagesName` to `page.name`, `route.environments` to `build.modes`, and native root fields to `config`; move `route.tab` to `page.tabBar` and remove `route.kind` and `definePage.tabPage`. Legacy or misspelled fields produce an explicit error instead of leaking into native JSON.

Generated enums use the `Enum` suffix and unquoted identifier members. Member names cannot contain hyphens or spaces or start with a digit. Values are compiled native page paths with a leading `/` and no file extension:

```ts
export enum PageEnum {
  /** 我的：账户与个人设置 */
  mine = '/pages/mine/index',
}
```

Renaming a page directory updates the enum value while keeping the member name from `page.name`. Disabled pages retain declared paths, but the Router rejects navigation through availability checks. Every source enum in framework follows the same naming rules, enforced by development checks.

## Generated route entry

`@miniprogramlab/routes` is an application-specific module generated by the CLI, **not an npm package to install**. WeChat, Douyin, and Alipay share this import name; its contents follow the selected `--platform`, `--mode`, and page configuration. Runtime navigation comes from the `@miniprogramlab/core/router` submodule.

Extend the generated configuration in the application `tsconfig.json`. Keep an existing base configuration by using an array:

```json
{
  "extends": ["../../tsconfig.base.json", "./.cache/tsconfig.routes.json"],
  "include": ["src/**/*.ts"]
}
```

Standalone applications without a base configuration can extend only `./.cache/tsconfig.routes.json` and retain their own `compilerOptions`. The CLI generates the alias mapping. If the application declares its own `compilerOptions.paths`, TypeScript replaces the entire inherited mapping, so that entry must also be retained.

```ts
import { PageEnum, routes, entryPageName } from '@miniprogramlab/routes'
import type { RouteName, TabPageName, RouteParams, AppRouter } from '@miniprogramlab/routes'

/** 枚举成员显示页面描述，路由参数仍由类型检查约束。 */
navigateTo(PageEnum.detail).params({ id: '42' }).go()
```

| Export | Content |
| --- | --- |
| `PageEnum` | Bare members from `page.name`, compiled paths as values, documentation from `page.description` |
| `RoutePath`, `TabPagePath` | All page paths and tab page paths |
| `router` | Shared instance bound to the current application route table |
| `routes`, `entryPageName` | Route table and default entry constants |
| `Routes`, `EntryPageName` | Literal route table and entry types |
| `RouteName`, `TabPageName` | Application page names and tab page names |
| `RouteParams<Path>` | Required/optional parameters with string, number, or boolean values |
| `RouteArguments<Path>` | Navigation argument tuple controlling whether parameters may be omitted |
| `AppRouter` | Router instance type bound to this application's routes |

Every `dev`, `build`, or `routes` command generates `.cache/routes.generated.ts`, `.cache/api.generated.ts`, `.cache/api.globals.d.ts`, and `.cache/tsconfig.routes.json` before application type checking or compilation. A development command recreates a missing cache. To prepare editor types alone, run `pnpm exec miniprogram routes --platform=wechat --mode=development`. Do not edit or commit `.cache`.

The CLI generates the route contract as a named `Routes` interface. Navigation and builder hovers reference that name instead of expanding every page, parameter rule, and tab icon. The interface still derives from the complete route constant, preserving parameter completion, required fields, tab parameter restrictions, and callback/`await` exclusivity without an editor plugin.

Watching regenerates routes and types when page configurations are added, changed, or removed. Disabled pages retain their name types for `isRouteAvailable` checks, and their enum values retain declared paths, while `available: false` prevents navigation. The compiler resolves the entry against the consuming application's root, keeping applications isolated. One application's cache reflects its most recently generated platform and mode; regenerate after switching targets.

## Routes and native tabs

Each discovered page declares a unique `page.name`. The application selects its initial page with `entryPageName`. The `page` group describes the route name, enum documentation, parameters, or a tab item, while `build.modes` controls mode availability. The builder owns `pages`, `entryPagePath`, and `tabBar.list`; do not duplicate these generated fields manually.

For native tabs, declare two to five tab pages with `page.tabBar` metadata. Native tab routes cannot have query parameters. Use the same generated metadata for runtime UI items.

To use the UI package's native bar, add `customTabBar: '@miniprogramlab/ui/custom-tab-bar/index'` to `miniprogram.config.mjs` and configure `tabBar.custom: true` in the application. The [UI guide](../components/README.en.md) explains runtime installation and page synchronization.

Main-package page discovery is implemented; runtime subpackage building is not yet supported.

## Environment configuration

Files load in this order, with later values overriding earlier ones:

1. `.env`
2. `.env.local`
3. `.env.<mode>`
4. `.env.<mode>.local`
5. Process environment values for the supported keys

Each platform reads `<PREFIX>_APP_API_BASE_URL`, `<PREFIX>_APP_TITLE`, and `<PREFIX>_APP_ID`, with prefixes `WX`, `TT`, and `ALIPAY`. `MINIPROGRAM_APP_*` supplies shared defaults. Process values override files; platform-specific values override shared values at the same level. Runtime code receives `mode`, `platform`, `apiBaseUrl`, and `title` through `__MINIPROGRAM_ENV__`, plus `__MINIPROGRAM_PLATFORM__` for the target name. The selected platform also exposes `__WX_ENV__`, `__TT_ENV__`, or `__ALIPAY_ENV__`. AppID stays out of runtime code; WeChat and Douyin retain the project AppID unless an environment value overrides it. Alipay app identity is managed in its developer tools. An API URL is optional, must not contain a query or fragment, and must use HTTPS outside development mode.

## Watching and output safety

Watch mode observes source files, environment files, project configuration, package sources, and configured extra directories. Updates are debounced and built sequentially. Native watcher resource failures fall back to bounded polling; compilation errors keep the watcher alive for the next correction. Restart after changing directory or custom tab entry configuration.

Compilation writes to staging before updating the final directory. Failed compilation leaves previous output intact; failed updates attempt rollback from backups. Existing output `project.private.config.json` is never overwritten, removed, or moved. On first use, it is initialized from the project file, the example file, or an empty object.

Output must be an independent directory inside the project and cannot overlap the source tree or project root, including through symbolic links. Competing SCSS/Less/native-style outputs are rejected before publication.

## Runtime routing

[Core Router](../framework/README.en.md#cross-platform-routing) consumes the generated contract. The generated entry creates a shared instance through Core, and applications call `navigateTo(...).go()`; CLI statically binds the selected build platform’s `navigationAdapter`. WeChat is the default, and `--platform` selects another target. Output includes only the selected adapter. Custom build adapters can provide a navigation module exporting `createNavigationAdapter()` without changing the shared compiler.

## Development

```sh
pnpm --filter @miniprogramlab/cli dev:check
pnpm --filter @miniprogramlab/cli dev:test
```

The CLI and its local preparation logic use strictly checked TypeScript. `dev:check` compiles `src/`, `bin/`, and `scripts/` into `dist/`; `dev:test` covers source bootstrapping, platform fixtures, output execution, failure preservation, and terminal logging.

`bin/miniprogram.mjs` uses the framework preload entry to prepare a local source workspace. It runs the framework's TypeScript compiler on first launch, when CLI sources or compiler settings change, or when output files are missing. Matching content fingerprints and output manifests reuse the existing build. Preparation shares colored logs and terminal animation, serializes concurrent launches, and stops execution on compilation failure. Consumer `dev` and `build` scripts call `miniprogram` directly.

CLI source changes take effect on the next command launch; an existing application watcher keeps its loaded implementation. npm archives omit the local preparation source and run their included `dist` directly, without compiling the CLI in consumer projects.

Local Node tools and tests that import CLI modules directly can use the same preload entry, including on their first run:

```sh
node --import @miniprogramlab/cli/register --test tests/*.test.mjs
```

The preparation source `scripts/prepare.ts` and local caches are excluded from published archives. The two `.mjs` files only bootstrap and load the TypeScript implementation.

`defineConfig` is the typed configuration helper. Node.js integrations can import `loadOptions` and `buildProject` through the package subpaths to reuse the same option resolution and build pipeline.

Licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE).
