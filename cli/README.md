# @miniprogramlab/cli

[English](README.en.md)

通过 `miniprogram` 命令使用的 TypeScript 构建 CLI，以平台注册表和独立适配器组织构建差异。**默认打包微信平台**；内置微信 Skyline、抖音原生和支付宝原生源码适配器。

框架声明函数独立调用，如 `definePage(...)`、`defineComponent(...)`；导航、安装等操作也直接调用独立函数，这些入口均由 CLI 按需注入；页面、组件、状态、路由及 UI 装配的用法见 [统一 API 入口](../framework/README.md#统一-api-入口)。

## 构建功能

- 将可达的 TypeScript、JavaScript 依赖编译成 CommonJS，并保持共享模块身份。
- 微信平台将 `.worklet.ts`、`.worklet.js` 依赖随调用方内联。
- 编译 SCSS、Less，支持 Sass 包导入和 Less 多层导入，复制所选平台的原生样式、模板与静态资源。
- 发现页面，生成原生注册信息及 `@miniprogramlab/routes` 的路由常量、页面名称、参数类型和 TypeScript 解析配置。
- 解析原生 npm 组件和包含 TypeScript、`.config.ts`、模板及样式的源码组件包。
- 将可选的包内自定义底栏直接输出到 `custom-tab-bar/index.*`。
- 使用暂存构建，保留已有私有配置，并在更新失败时恢复旧产物。

## 环境与安装

要求 Node.js 22 或更高版本。安装 CLI 交付包及 TypeScript、`miniprogram-api-typings`；应用使用 Core 或 UI 时，同时安装对应交付包。[工具集文档](../README.md)说明了交付包的生成与安装方式。

## 命令

```sh
pnpm exec miniprogram dev
pnpm exec miniprogram build --mode=development --typecheck
pnpm exec miniprogram build --mode=production --typecheck
pnpm exec miniprogram routes
pnpm exec miniprogram --help
```

`dev` 启用监听；`build` 默认单次构建，可通过 `--watch` 开启监听；`routes` 生成路由常量、应用类型及 TypeScript 配置，不更新原生产物。类型检查需显式传入 `--typecheck`。

| 参数 | 行为 |
| --- | --- |
| `--platform <name>` | 选择 wechat（默认）、douyin、alipay 或注册的适配器；别名为 wx、tt、my |
| `--root <path>` | 消费项目根目录，默认当前目录 |
| `--config <path>` | 相对项目根目录的配置路径，默认 `miniprogram.config.mjs` |
| `--src <path>` | 覆盖配置中的源码目录，默认 `src` |
| `--out-dir <path>` | 覆盖产物目录；微信默认 `dist`，其他平台默认 `dist-平台名` |
| `--mode <name>` | 选择环境；未指定时先读取 `MINIPROGRAM_MODE`，再读取平台变量 `WX_MODE`、`TT_MODE` 或 `ALIPAY_MODE`，最后按监听模式使用 development、单次构建使用 production |
| `--watch` | 监听并在源码变化后重新构建 |
| `--poll` | 使用轮询替代原生文件监听 |
| `--typecheck` | 在路由类型生成后执行 TypeScript 检查 |
| `--version` | 显示 CLI 版本 |

`routes` 未指定 `--mode` 时使用 development。目录参数均相对 `--root` 解析。

## 平台选择

```sh
pnpm exec miniprogram build --mode=development
pnpm exec miniprogram build --platform=douyin --mode=development
pnpm exec miniprogram build --platform=alipay --mode=development
```

| 平台 | 模板 | 原生样式 | 输出工程文件 |
| --- | --- | --- | --- |
| 微信 | `.wxml` | `.wxss` | `project.config.json` |
| 抖音 | `.ttml` | `.ttss` | `project.config.json` |
| 支付宝 | `.axml` | `.acss` | `mini.project.json` |

选择顺序为命令行参数、`MINIPROGRAM_PLATFORM`、配置中的 `platform`，最后默认 `wechat`。别名先归一化，再从 `platforms` 读取覆盖项。每个平台可覆盖 `source`、`outDir`、`projectConfig`、`customTabBar`、`watchDirectories` 和 `poll`。

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

抖音和支付宝工程使用原生 `App`、`Page`、`Component`，并编写各自的模板语法和配置字段。CLI 共享编译流程及路由元数据，不自动翻译微信 API 或 WXML。Core 的页面封装、UI、Skyline、Worklet 和自定义底栏组件面向微信；Core Router 支持三个平台，不支持的使用方式会在构建时报告。抖音使用 `tabBar.list`；支付宝按 `page.tabBar` 生成 `tabBar.items` 及 `name`、`icon`、`activeIcon` 字段；两者都以页面列表首项作为入口。

原生项目继续使用 `app.config.ts`、`entryPageName` 和 `page.name`。页面配置通过同目录中的 `definePageConfig` 调用发现，不限制配置文件名。在 TypeScript 的 `types` 中加入 `@miniprogramlab/cli/globals`，获取配置函数和编译常量声明，并安装目标平台自己的原生 API 声明。应用和页面入口可使用 `.ts` 或 `.js`，同一入口只能存在一种。模板保持平台原生语法。使用 Core 的微信项目继续使用 `@miniprogramlab/core/globals`。

## 注册其他平台

通过 `definePlatformAdapter` 声明适配器，并加入配置的 `platformAdapters`。导出的 `PlatformAdapter` 协议包含文件后缀、环境前缀、工程/页面/应用配置、底栏校验，以及可选的运行时注入和依赖检查钩子。平台 ID 或别名重复会报错，每次构建独立建立注册表，新增适配器无需修改公共编译流程。

## 控制台输出

直接运行、pnpm 工作区并行运行、重定向输出和 CI 均保留相同的 CLI 信息。交互终端额外显示青色旋转动画，动画行只承载即时进度，清除时不会删除阶段记录。要让工作区并行任务和编辑器重新运行任务也不叠加包名前缀，在消费项目根目录的 `.npmrc` 中配置 `reporter-hide-prefix=true`，同时设置 `color=true`，让 pnpm 将颜色设置传递给通过管道运行的子任务。单次调用可传入 pnpm 的 `--reporter-hide-prefix --color` 参数。需要纯文本日志时设置 `NO_COLOR=1`。

启动时列出目标平台、环境、项目/源码/产物目录、构建与工程配置、TypeScript 类型检查状态及压缩选项。类型检查未启用时明确说明仅转译，并提示使用 `--typecheck`。

每轮构建带序号和时间，六个阶段均记录开始、完成结果和独立耗时：配置与路由、类型与平台校验、模板样式资源、原生组件、脚本依赖、产物校验与写入。完成后分行显示页面、本地/npm 组件、JavaScript 与 Source Map 文件、产物总数与实际大小、总耗时及输出目录。产物统计不包含开发者工具私有配置；已有私有配置仍保持原位和原内容。

开发监听列出实际监听目录和机制。文件变更按防抖窗口合并、去重，完整显示触发本轮重编译的路径；新增、修改和删除均可触发构建。首轮或后续构建失败时标记具体失败阶段，输出错误并继续等待修正；退出时确认监听已停止。CLI 配置与 `--mode` 的修改需要重启命令。

日志等级标签统一使用英文：`[INFO]` 青色、`[SUCCESS]` 绿色、`[WARN]` 黄色、`[ERROR]` 红色；消息正文保持中文，多行诊断逐行保留等级标签。CI 和非交互终端禁用动画；`NO_COLOR` 或 `FORCE_COLOR=0` 关闭颜色，`FORCE_COLOR=1` 可在重定向日志中保留颜色，但不会强制启用动画。

## 最小微信应用

在项目根目录创建 `miniprogram.config.mjs`：

```js
import { defineConfig } from '@miniprogramlab/cli'

/** 配置源码、输出目录及可选的包监听。 */
export default defineConfig({
  source: 'src',
  outDir: 'dist',
  watchDirectories: [],
})
```

创建 `project.config.json`：

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

创建 `src/app.config.ts`：

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

添加应用入口及一个页面：

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

按 [Core 文档](../framework/README.md)在 TypeScript 中配置 `miniprogram-api-typings` 和 `@miniprogramlab/core/globals`。执行 `pnpm exec miniprogram build --mode=development --typecheck`，再将 `dist` 导入微信开发者工具。

页面样式可使用 `index.scss`、`index.less` 或 `index.wxss`。以 `_` 开头的 Sass 局部文件通过导入使用，不生成独立产物。

页面配置可与 `definePage` 写在同一个文件中，也可单独放在同目录的 `config.ts`、`metadata.js` 等脚本中，无须导入独立配置文件。CLI 在 `src/pages` 中按目录发现页面；每个页面目录只有一个入口和一处顶层 `definePageConfig({...})` 调用，重复或缺失配置会报错，不递归借用父目录或子目录的配置。

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

配置可以引用公开环境常量、导入的配置数据以及本文件中的常量和函数；请用声明式表达式组织配置，不依赖其他顶层语句的赋值或业务初始化。CLI 只提取配置使用的声明，不执行页面注册和无关业务代码；运行时移除配置调用及其专用依赖，共享声明保留。输出 JSON 按页面入口命名，例如 `screen.ts` 对应 `screen.json`，与配置源文件名无关。组件 `.config.ts` 和应用 `app.config.ts` 的命名规则保持不变。

## 页面配置 API

`definePageConfig` 只接受一个分组对象；目标平台由 CLI 的 `--platform` 与 adapter 决定，页面中不声明平台筛选或平台覆盖。

| 分组 | 字段与职责 | 默认行为 |
| --- | --- | --- |
| `page` | `name`、`description` 声明路由名称与枚举注释；`params` 声明查询参数，或 `tabBar` 声明底栏项 | `name` 必填；无 `tabBar` 时为普通页 |
| `build` | `modes` 为允许构建的非空环境名称数组 | 省略时所有环境启用 |
| `config` | 页面标题、`usingComponents` 等原生页面字段 | 省略时由 adapter 补齐默认值 |

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
    navigationBarTitleText: '详情',
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
    tabBar: { text: '我的', order: 3, iconPath: '/icons/mine.png' },
  },
  config: { navigationBarTitleText: '我的' },
})
```

- `page.name` 在应用内唯一，以字母开头，仅含字母、数字和下划线；页面路径始终由入口文件生成。
- 参数支持 `string`、`number`、`boolean`，`required` 默认 `false`；Tab 页不能声明 `params`。
- `page.tabBar` 必填 `text`、非负整数 `order` 和 `iconPath`；`selectedIconPath` 可选；`id` 默认使用 `page.name`。不同 Tab 的 `id` 和 `order` 必须唯一。
- `build.modes` 不包含当前 `--mode` 时，页面目录不会进入产物；Router 保留该名称的类型，但标记为不可用。入口必须是当前环境可用且没有必填参数的页面。
- `page` 和 `build` 仅参与编译。只有 `config` 经过 adapter 校验、补齐和组件路径重写后写入页面 JSON；不能包含函数、`undefined` 或循环引用。
- `page.description` 用作生成的 `PageEnum` 枚举成员注释，省略时回退到页面名称。
- `page.tabBar` 存在即为 Tab 页。应用启用 `tabBar.custom: true` 时，CLI 自动接入 `definePage` 的底栏同步、留白和卸载清理；原生底栏由平台管理。`definePage` 不再接受 `tabPage`。

旧 API 需要迁移：`pagesName` → `page.name`，`route.environments` → `build.modes`，原生顶层字段 → `config`，`route.tab` → `page.tabBar`，删除 `route.kind` 和 `definePage.tabPage`。旧字段和拼写错误会明确报错，不会静默透传到原生 JSON。

生成的枚举遵循统一规则：名称以 `Enum` 结尾；成员名使用无引号标识符，不能包含连字符、空格或以数字开头；成员值为带前导 `/`、不含文件扩展名的编译后页面地址。例如：

```ts
export enum PageEnum {
  /** 我的：账户与个人设置 */
  mine = '/pages/mine/index',
}
```

页面目录改名时，枚举值自动更新；`page.name` 不变时成员名不变。未启用页面保留声明路径，Router 会检查当前环境可用性。framework 所有源码枚举都遵循 `Enum` 后缀与无引号成员规则，并纳入开发检查。

## 统一路由入口

`@miniprogramlab/routes` 是 CLI 为当前应用生成的模块入口，**不是需要安装的 npm 包**。微信、抖音、支付宝共用该入口；内容根据本次 `--platform`、`--mode` 和页面配置生成。路由运行时由 `@miniprogramlab/core/router` 子模块提供。

在应用 `tsconfig.json` 中继承生成配置；已有基础配置时使用数组并保留原配置：

```json
{
  "extends": ["../../tsconfig.base.json", "./.cache/tsconfig.routes.json"],
  "include": ["src/**/*.ts"]
}
```

独立应用没有基础配置时，只继承 `./.cache/tsconfig.routes.json`，保留自己的 `compilerOptions`。CLI 生成别名映射，应用无需维护生成文件路径；如在应用中另写 `compilerOptions.paths`，TypeScript 会覆盖继承的整个映射，须同时保留该入口。

```ts
import { PageEnum, routes, entryPageName } from '@miniprogramlab/routes'
import type { RouteName, TabPageName, RouteParams, AppRouter } from '@miniprogramlab/routes'

/** 枚举成员显示页面描述，路由参数仍由类型检查约束。 */
navigateTo(PageEnum.detail).params({ id: '42' }).go()
```

| 导出 | 内容 |
| --- | --- |
| `PageEnum` | 成员名来自 `page.name`，值为 `/pages/…/index`，注释来自 `page.description` |
| `RoutePath`、`TabPagePath` | 全部页面路径及 Tab 页面路径类型 |
| `router` | 绑定当前应用路由表的共用实例，直接调用导航方法 |
| `routes`、`entryPageName` | 路由表和默认入口常量 |
| `Routes`、`EntryPageName` | 保留字面量的路由表和入口类型 |
| `RouteName`、`TabPageName` | 当前应用的页面名、Tab 页面名 |
| `RouteParams<Path>` | 按路径或 `PageEnum` 成员推导参数及 string、number、boolean 类型 |
| `RouteArguments<Path>` | 指定页面的导航参数列表，限制参数对象能否省略 |
| `AppRouter` | 已绑定当前路由表的 Router 实例类型 |

每次 `dev`、`build` 或 `routes` 都先生成 `.cache/routes.generated.ts`、`.cache/api.generated.ts`、`.cache/api.globals.d.ts` 与 `.cache/tsconfig.routes.json`，再进行应用类型检查或编译。清空缓存后直接运行开发命令即可重建；仅准备编辑器提示可执行 `pnpm exec miniprogram routes --platform=wechat --mode=development`。不要手动修改或提交 `.cache`。

CLI 将路由契约生成具名的 `Routes` 接口，导航及链式方法的悬浮提示只引用该名称，不展开全部页面、参数规则和底栏图标配置。接口仍从完整路由常量推导，页面参数补全、必填校验、Tab 页禁止传参以及回调与 `await` 互斥的约束保持不变，无需配置编辑器插件。

开发监听会根据页面配置的新增、修改和删除重新生成路由及类型。未启用页面仍有名称类型，可通过 `isRouteAvailable` 检查；枚举与路由表保留声明路径，`available: false` 阻止运行时导航。编译器按消费项目根目录解析入口，各应用不会共享路由表；同一应用缓存对应最近一次生成的平台和环境，切换目标后需要重新生成。

## 路由与原生底栏

每个发现的页面声明唯一 `page.name`，应用通过 `entryPageName` 指定初始页面。页面 `page` 声明参数或 Tab 信息，`build.modes` 控制环境可用性。`pages`、`entryPagePath`、`tabBar.list` 由构建器生成，无需手工重复维护。

使用原生底栏时，声明二至五个带 `page.tabBar` 元数据的页面。原生 Tab 路由不允许查询参数，运行时 UI 列表应使用同一份生成元数据。

使用 UI 包的原生底栏时，在 `miniprogram.config.mjs` 增加 `customTabBar: '@miniprogramlab/ui/custom-tab-bar/index'`，在应用配置中设置 `tabBar.custom: true`。[UI 文档](../components/README.md)说明了运行时安装和页面同步方式。

当前已实现主包页面发现，尚不支持运行时分包构建。

## 环境配置

环境文件按以下顺序加载，后者覆盖前者：

1. `.env`
2. `.env.local`
3. `.env.<mode>`
4. `.env.<mode>.local`
5. 系统环境变量中的受支持字段

各平台读取 `<前缀>_APP_API_BASE_URL`、`<前缀>_APP_TITLE`、`<前缀>_APP_ID`，前缀分别为 `WX`、`TT`、`ALIPAY`；`MINIPROGRAM_APP_*` 提供通用默认值。系统变量优先于文件，同层的平台变量优先于通用变量。运行时通过 `__MINIPROGRAM_ENV__` 获取 `mode`、`platform`、`apiBaseUrl`、`title`，通过 `__MINIPROGRAM_PLATFORM__` 获取目标名称；也可使用当前平台的 `__WX_ENV__`、`__TT_ENV__` 或 `__ALIPAY_ENV__`。AppID 不进入运行时：微信和抖音仅在环境中显式设置时覆盖工程原值，支付宝应用身份由开发者工具管理。API 地址可省略，不得包含查询参数或片段，非 development 环境必须使用 HTTPS。

## 监听与产物保护

监听覆盖源码、环境文件、工程配置、依赖包源码及额外配置目录，变更经过防抖后串行构建。原生监听资源不足时回退到有界轮询；编译错误不会结束监听，修正后继续构建。修改目录或自定义底栏入口配置后需要重启监听。

编译先写入暂存目录，再更新正式产物。编译失败保留旧产物；更新失败时尝试从备份回滚。产物中已有的 `project.private.config.json` 不会被覆盖、删除或移动；首次使用时从项目私有文件、示例文件或空对象初始化。

产物必须位于项目内部的独立目录，不得通过普通路径或符号链接与源码、项目根重叠或越过项目边界。SCSS、Less 与原生样式产生同名输出时，在发布产物前报错。

## 运行时路由

[Core Router](../framework/README.md#跨平台路由) 消费生成契约。生成入口通过 Core 创建共用路由实例，应用直接调用 `navigateTo(...).go()`，CLI 根据构建平台的 `navigationAdapter` 静态替换导航入口，默认微信，其他平台使用 `--platform` 切换；产物仅包含目标平台。自定义构建适配器可声明导航模块路径，模块导出 `createNavigationAdapter()`，无需修改通用编译流程。

## 开发

```sh
pnpm --filter @miniprogramlab/cli dev:check
pnpm --filter @miniprogramlab/cli dev:test
```

CLI 及本地准备逻辑使用 TypeScript 实现，启用严格检查。`dev:check` 将 `src/`、`bin/`、`scripts/` 编译到 `dist/`；`dev:test` 验证源码自举、多平台工程、产物执行、失败保护和终端日志。

`bin/miniprogram.mjs` 通过 framework 内的预加载入口自行准备本地源码工作区。首次启动、CLI 源码或编译配置变化、输出文件缺失时自动调用框架自己的 TypeScript 编译器；源码内容指纹和输出清单匹配时直接复用产物。准备过程沿用彩色日志和终端动画，并发启动只编译一次，编译失败会停止启动。消费项目的 `dev`、`build` 等脚本直接调用 `miniprogram`，不需要编写 CLI 编译步骤。

CLI 源码变化在下次启动命令时生效；正在运行的应用监听进程不自动替换自身实现。npm 包不包含本地准备源码，安装后直接运行自带的 `dist`，无需在用户项目中编译 CLI。

直接导入 CLI 模块的本地 Node 工具或测试，可以使用同一个预加载入口，保证首次运行也能解析编译产物：

```sh
node --import @miniprogramlab/cli/register --test tests/*.test.mjs
```

准备脚本 `scripts/prepare.ts` 和本机缓存不进入发布包；两个 `.mjs` 文件仅负责无缓存启动和加载 TypeScript 实现。

`defineConfig` 提供配置类型提示。Node.js 工具可通过包子路径导入 `loadOptions`、`buildProject`，复用相同的配置解析和构建流程。

采用 [Apache-2.0](LICENSE)，相关声明见 [NOTICE](NOTICE)。
