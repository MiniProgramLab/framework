# MiniLoom（织微）小程序开发框架架构设计

本文是基于当前 Skyline Kit 源码的设计提案，涵盖运行时封装、构建与分发 CLI、组件库、VS Code / Cursor 扩展，以及微信、抖音、支付宝的演进边界。文中的新包名、接口、命令和目录均为拟议规范，尚未实现。

推荐采用：**稳定协议 + 三类独立注册宿主 + 平台适配器 + 渲染扩展 + 功能插件**。首期交付微信 Skyline；当前 TypeScript、原生模板和 SCSS/Less 开发方式继续保留。

配套文件：[可切换主题并导出的架构图](./miniloom-架构图.html)。

## 1. 名称与产品定位

推荐正式名称：**MiniLoom（织微）小程序开发框架**。

英文全称：**MiniLoom Mini Program Framework**。中文说明：**可组合、可扩展的小程序开发框架与工具链**。

Mini 表明小程序定位；Loom 表达将独立模块组合成完整开发体系。品牌与任何平台、渲染引擎解耦，Skyline 回归微信渲染扩展的名称。面向开发者展示时保留“小程序开发框架”后缀，避免只有品牌词而看不出用途。

| 产品 | 展示名称 | 拟议标识 |
| --- | --- | --- |
| 整体框架 | MiniLoom 小程序开发框架 | `@miniloom/*` |
| 运行时 | MiniLoom Core | `@miniloom/core` |
| 构建与分发 | MiniLoom CLI | `@miniloom/cli`，命令 `miniloom` |
| 通用组件库 | MiniLoom UI | `@miniloom/ui` |
| 编辑器扩展 | MiniLoom 小程序开发助手 | 扩展名 `miniloom-vscode` |
| 微信适配器 | MiniLoom 微信适配器 | `@miniloom/adapter-wechat` |
| Skyline 扩展 | MiniLoom Skyline | `@miniloom/renderer-wechat-skyline` |
| 微信默认组合 | MiniLoom 微信 Skyline 预设 | `@miniloom/preset-wechat-skyline` |

包命名空间和扩展发布者标识是设计占位，本文不宣称已取得注册权。旧 `skyline` 命令和 `@miniprogramlab/*` 进入兼容迁移期，不能只全局替换字符串而改变已有语义。

## 2. 当前代码基础与必须保留的行为

| 当前模块 | 已有能力与耦合证据 | 建议归属 |
| --- | --- | --- |
| `framework/src/runtime.ts` | `definePage`、`defineComponent` 直接使用 `WechatMiniprogram` 类型与原生 `Component` | 中立定义进入 Core；微信注册与类型进入微信 adapter |
| `framework/src/store/` | 状态、订阅、页面归属、插件注册已具备模块边界，但部分归属逻辑使用微信实例能力 | 保留状态算法；归属发现通过小接口注入；默认插件从 Core 移到预设 |
| `cli/src/build.mjs` | 通用构建过程直接导入 `skyline.mjs`、微信底栏和路由输出逻辑 | 通用过程进入 Build；目标规则由扩展贡献 |
| `cli/src/skyline.mjs` | 集中校验 Skyline、glass-easel、Worklet 和当前工程布局约定 | 渲染要求进入 Skyline 扩展；工程偏好进入预设 |
| `cli/src/output.mjs` | 暂存生成、逐文件发布与失败回滚 | 保留并通用化为 OutputWriter |
| `components/src/` | 页容器、页头、弹层、菜单和底栏，部分直接绑定微信动画及页面归属 | 组件契约、行为、主题共享；视图、宿主挂载、动画按目标注册 |
| `vscode/src/` | 已有独立 Project / Language / Scripts / Styles，入口仍固定 WXML | 抽取语言核心；微信语法和数据成为语言包 |
| `pack.mjs` | 写死三个 npm 包与一个 VSIX | 包清单 + 分发 profile + artifact provider |

需要继续满足的兼容底线：

1. Store 以 App 隔离；页面、组件与原生底栏归属准确，卸载后清理订阅及异步回调。
2. 一个应用实例只使用同一份 Core 身份，组件通过 peer dependency 共享运行时。
3. Worklet 的线程和依赖边界保持明确，不把普通逻辑函数直接混入 UI 线程。
4. npm 源码组件、路径映射、配置转发、SCSS/Less、定义跳转和属性注释继续可用。
5. 构建失败不把未完成的编译结果发布为正式产物。
6. **现有 `dist/project.private.config.json` 始终留在原位置，构建、清理和回滚均不删除、不移动、不改写其字节内容。**多目标输出的微信目录继承同一保护规则。

当前 CLI 只发现主包页面，编辑器对原生分包组件的分析能力不代表 CLI 已支持分包构建。新方案会把这两类能力分别登记。

## 3. 目标模型：平台、渲染器、源码、产物分别描述

```text
BuildTarget = 平台 + 渲染器 + 最低运行要求 + 目标配置
Source      = 脚本语言 + 模板方言 + 样式语法
Artifact    = 应用工程 / 组件源码库 / 原生组件库 / 工具分发包
Mode        = development / staging / production 等环境
```

`mode` 不决定平台，`format` 不决定渲染器，文件后缀也不能替代能力校验。

| 目标 | platform | renderer | 状态 |
| --- | --- | --- | --- |
| 微信 Skyline | `wechat` | `skyline` | 首期实现并验证 |
| 微信其他渲染模式 | `wechat` | 由未来扩展登记 | 保留扩展点，首期不提供 |
| 抖音小程序 | `douyin` | 由抖音 adapter 声明默认 profile | 后续实现 |
| 支付宝小程序 | `alipay` | 由支付宝 adapter 声明默认 profile | 后续实现 |

Skyline 是微信的渲染选项，glass-easel 是组件框架，两者不应作为同一级“平台”。微信官方示例分别声明 `renderer: skyline` 和 `componentFramework: glass-easel`，官方仓库也明确 glass-easel 的组件框架角色。[微信官方示例](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/miniprogram/app.json)、[glass-easel 官方仓库](https://github.com/wechat-miniprogram/glass-easel)

注册宿主校验 adapter 声明的有效组合。例如 `douyin + skyline` 必须失败，不能因为两个字符串都存在就允许构建。平台键、渲染器键采用可扩展登记表，底座不维护穷举平台的 `switch` 或封闭枚举。

首期 Skyline 最低基础库与客户端范围应由功能需求、官方资料和真机验收共同确定，写入 adapter 的版本化能力清单。当前源码中的 `3.0.0` 等工程设定不能直接当作所有 Skyline 功能的充分条件。

## 4. 总体架构与依赖方向

```text
业务应用 / UI 组件      CLI 命令入口             VS Code / Cursor
       │                    │                         │
       ▼                    ▼                         ▼
    Core                 Build                  Language Service
       │                    │                         │
 Runtime Scope          Build Host              Language Host
       ▲                    ▲                         ▲
       │                    │                         │
 adapter/runtime       adapter/build           adapter/language
 renderer/runtime      renderer/build          renderer/language
 功能运行时插件         构建与分发插件           语法与组件元数据

            共享 contracts；各宿主有独立实例与生命周期
```

实线关系表达调用或实现契约，并不表示构建插件会进入小程序运行时。平台包按使用环境提供独立入口，只有被当前目标选中的 runtime 代码进入应用。

### 4.1 核心包与高内聚模块

| 包 | 单一职责 | 明确排除 |
| --- | --- | --- |
| `contracts` | 目标、能力、诊断、组件描述、插件清单、宿主端口协议 | Node、VS Code、微信类型和全局对象 |
| `core` | 定义封装、作用域、状态订阅、生命周期编排、运行时组合 | 平台检测、文件读取、模板编译、编辑器 API |
| `build` | 项目图、构建任务调度、产物清单、缓存、监听、发布回滚 | 微信字段、Skyline 特判、编辑器 UI |
| `language-service` | 符号索引、补全、悬浮、定义跳转、未保存文档分析 | `vscode` 对象、业务代码执行、构建发布 |
| `cli` | 参数、配置选择、命令、终端输出、退出码 | 编译算法和平台业务规则 |
| `vscode` | LSP 客户端、状态栏、命令、任务与设置 | 平台语义、组件解析、构建算法 |
| `ui` | 组件公开契约、行为模型、tokens、组件与变体清单 | 业务状态、硬编码首页、直接引用 `wx/tt/my` |
| `ui-wechat-skyline` | 微信 Skyline 组件视图、宿主挂载和动画实现 | 跨平台行为模型、FitLedger 业务逻辑 |
| `adapter-wechat` | 微信注册语义、API 映射、配置与方言、工程输出 | Skyline 专属动画与布局约束 |
| `renderer-wechat-skyline` | Skyline 配置、样式规则、Worklet 与渲染能力 | 通用路由、通用 Store、终端交互 |
| `preset-wechat-skyline` | 组合官方 adapter、renderer、UI 变体和常用插件 | 第二套运行时或编译器 |
| `plugin-*` | 路由、Store 参与项、样式预处理等独立功能 | 未声明的跨模块写入 |

`contracts` 应保持小而稳定，避免成为所有类型的堆放处。文件解析与模块解析共用 `build` 和语言服务可引用的无副作用模块；若后续需要独立版本或第三个消费者，再抽成 `project-model` 包，首期不为每个类建立 npm 包。

`build` 中建议按 `project/`、`pipeline/`、`artifacts/`、`output/` 划分。`core` 中按 `definition/`、`scope/`、`store/`、`lifecycle/` 划分。一个能力的实现、类型、校验和文档放在同一模块内，禁止形成通用 `utils` 大杂烩。

### 4.2 三类独立注册宿主

| 宿主 | 生命周期 | 可注册内容 |
| --- | --- | --- |
| Build Host | 一个项目的一个目标构建会话 | 配置规则、方言解析、转换 pass、组件变体、artifact provider |
| Runtime Scope | 每个 App；其下为 Page / Component 子作用域 | 宿主能力实现、状态参与项、生命周期拦截、清理函数 |
| Language Host | 每个工作区项目及目标分析会话 | 方言、组件元数据、能力诊断、定义定位规则 |

三个宿主可以共享拓扑排序等纯算法，但不能共用跨环境的可变全局容器。运行时注册也不能扫描 `node_modules` 或执行 Node 构建插件。

## 5. 注册协议与开闭原则

### 5.1 插件是扩展单元，adapter 是有明确责任的插件

- **Platform Adapter** 实现一个平台的宿主端口、源码方言和工程输出规则。
- **Renderer Plugin** 在指定平台上添加渲染能力与约束，不能随意匹配其他平台。
- **Feature Plugin** 提供路由、状态参与项、样式编译、诊断等能力。
- **Preset** 只组合声明，不隐藏第二套注册逻辑。

这里的 framework plugin 与微信等平台发布的“小程序插件产品”是不同概念。后者如需支持，使用单独的 artifact provider 和平台能力声明。

### 5.2 数据清单与可执行入口分离

每个插件发布版本化的纯 JSON 清单，至少包含：

| 字段 | 说明 |
| --- | --- |
| `id / version / protocolVersion / kind` | 身份、版本、协议主版本与插件类别 |
| `requires / optional / conflicts` | 必需、可选、互斥插件及版本范围 |
| `targets` | 允许的平台、渲染 profile 与最低宿主要求 |
| `entries.build / runtime / language` | 各执行环境入口；不存在时不加载 |
| `contributes` | 能力、配置 schema、语言数据、组件元数据和可用产物 |

Node 端由 `miniloom.config.mjs` 显式启用包，按 lockfile 解析依赖；不自动启用工作区中所有已安装插件。运行时入口由编译后的组合计划静态导入，语言服务默认读取纯数据清单。

adapter 包内部可用 `build`、`runtime`、`language`、`manifest` 子路径提供入口；`package.json exports` 必须显式区分。安装一个 adapter 不代表把所有入口打进每一种产物。

### 5.3 注册、解析、激活、销毁

```text
读取清单 → 校验版本与目标 → 收集贡献 → 检查依赖与冲突
         → 拓扑排序 → 生成解析计划 → 冻结注册表
         → 按需激活 → 执行 → 逆序销毁
```

确定性规则：

1. 同一宿主内插件 ID 唯一；重复、缺失必需依赖、协议不兼容和依赖环都立即失败。
2. 必需依赖决定先后关系；`before/after` 只声明顺序，不能代替依赖。互相矛盾时报环错误，剩余并列项按稳定 ID 排序。
3. 每个单值端口在目标与作用域内恰好有一个实现；多实现必须由目标配置显式选择。不能依赖“最后注册覆盖”。
4. 多值扩展点才允许追加，例如诊断器、构建 pass。每个扩展点明确顺序、输入输出与失败策略。
5. 装饰器通过显式包装关系接入，限制在支持装饰的端口，不允许任意替换内部对象。
6. 冻结后不再注册。监听时配置发生变化，创建新一代计划并释放旧会话，不能修改正在执行的计划。
7. 激活失败逆序执行已登记的清理；跨进程崩溃通过下一次启动的残留会话恢复处理。

对插件不暴露可任意增删的上下文大对象，不让消费者在任意位置 `container.get('任意字符串')`。服务依赖在组装边界解析一次，以小接口传入实现。

### 5.4 关键契约示意

以下只表达边界，完整类型推导在实现阶段展开，不是已可调用的 API。

```ts
/** 构建目标；合法的平台与渲染器组合由注册清单校验。 */
export interface BuildTarget {
  /** 当前配置中稳定、唯一的目标名称。 */
  readonly name: string
  /** 已注册的平台标识。 */
  readonly platform: string
  /** 平台支持的渲染 profile。 */
  readonly renderer: string
}

/** 页面宿主只暴露共享行为所需的能力。 */
export interface PageHost {
  /** 在当前 App 内稳定的页面身份。 */
  readonly id: string
  /** 提交视图补丁；拒绝跨越线程边界的数据。 */
  patchView(patch: Readonly<Record<string, unknown>>): void
  /** 登记随页面释放的清理函数。 */
  onDispose(cleanup: () => void): void
}

/** 页面归属由平台提供，Core 不读取当前页面栈猜测归属。 */
export interface OwnerResolver {
  /** 返回明确归属；无法确定时保留未解析状态。 */
  resolvePage(instance: object): PageHost | undefined
}

/** 一个构建扩展通过受限的注册 API 贡献能力。 */
export interface BuildPlugin {
  /** 全局唯一且稳定的插件标识。 */
  readonly id: string
  /** 只登记转换器、校验器等声明，不在此发布文件。 */
  register(registry: BuildContributionRegistry): void
}
```

`BuildContributionRegistry` 的各注册方法使用独立的 `ConfigRule`、`TransformPass`、`ArtifactProvider` 等协议类型，避免 `register(name, any)`。构建扩展通过宿主 SDK 实现，不直接拿文件系统输出目录自行修改。

例如微信构建入口只组合本包拥有的实现，Skyline 的实现由另一个入口登记：

```ts
import type { BuildPlugin } from '@miniloom/contracts/build'
import { wechatPlatform } from './platform.js'
import { wxmlDialect } from './dialect.js'
import { wechatConfigRules } from './config.js'
import { wechatAppArtifact } from './artifact.js'

/** 将微信平台实现登记到当前构建宿主；不主动启动构建。 */
export const wechatBuildPlugin: BuildPlugin = {
  id: '@miniloom/adapter-wechat/build',
  /** 各扩展点接收独立、可校验的贡献类型。 */
  register(registry) {
    registry.platforms.add(wechatPlatform)
    registry.dialects.add(wxmlDialect)
    registry.configRules.add(wechatConfigRules)
    registry.artifacts.add(wechatAppArtifact)
  },
}
```

底座在解析出的目标上查询对应平台与产物实现，调用固定契约。后续抖音入口登记自己的实现即可。Renderer 则登记渲染 profile、能力约束与转换 pass，不修改微信 adapter 的源码。示例中的局部模块同样属于拟议结构。

### 5.5 能力协商

能力键采用有版本的领域名称，如 `navigation.basic@1`、`component.page-owner@1`、`motion.shared-value@1`、`render.worklet@1`。记录 `supported / conditional / unsupported`、提供者、最低基础库、运行时探测器及限制。

编译期计算目标能力与组件要求；条件能力在运行时仍需探测。用户拒绝授权属于一次调用的结果，不等于平台根本不支持该能力。

默认遇到缺失必需能力即构建失败。只有组件或业务明确声明可接受替代实现时才降级，并显示诊断。例如普通弹窗可退化为无动画，依赖持续手势跟随的专用组件不能静默变成普通点击组件。

## 6. 运行时封装

### 6.1 中立 API 与原生兼容 API

通用入口提供 `defineApp / definePage / defineComponent / defineStore`，使用中立的属性、事件、状态和生命周期定义。具体 adapter 负责把定义映射到平台注册构造器，并处理事件对象、属性观察、页面就绪与显示顺序。

中立生命周期必须定义触发时机、调用次数和销毁保证，例如 `setup`、`ready`、`show`、`hide`、`dispose`；不通过简单函数改名声称语义已经一致。平台额外生命周期走显式的目标扩展字段，由 adapter 校验。

已有微信 `Behavior`、`WechatMiniprogram.Component.Options` 和原生实例推导保留在 `adapter-wechat/compat`，旧 `definePage` 可以先迁入兼容入口。使用兼容接口的页面标记为微信原生页面，不能被当作已经跨平台的业务代码。

### 6.2 状态和作用域

作用域为 `App → Page → Component`。Store 算法与页面归属分开：状态层负责更新、投影、订阅，adapter 的 `OwnerResolver` 负责精确归属；找不到归属时等待明确关联或拒绝建立连接。

默认装配在生成的 bootstrap 中完成，在用户 `App.onLaunch` 及页面模块求值之前初始化必要的注册表。adapter 按平台加载模型保证顺序；不能仅依赖“用户记得先调用 install”。主包启动建立 App 状态，后加载分包复用同一 App 实例。独立分包须显式选择新的作用域方案，首期不宣称支持。

生命周期编排保留以下保证：内部连接建立先于依赖它的业务回调；`ready` 之后才做布局测量；卸载时取消任务与订阅；异步回调检查作用域是否仍有效。注册计划可共享，App、页面和组件的状态实例不能共享。

### 6.3 通用平台能力封装

优先封装网络、存储、基础导航、设备信息和基础反馈这类语义可定义的端口。网络任务保留取消、进度、超时和原始错误，不能把所有原生 API 机械转换成只返回 Promise 的函数。

登录、支付、订阅消息等平台业务差异大的能力保留平台类型和命名空间入口，由业务应用选择。原生逃生口只允许出现在目标限定模块，如 `*.wechat.ts` 或显式 platform 分支目录；构建图在进入其他目标前排除这些模块，并校验剩余图无错误平台导入。

Core、通用 UI 和业务公共模块禁止直接使用 `wx / tt / my`、微信声明和 Node 内建模块。这条边界同时检查源码依赖和产物，避免构建包或类型包泄漏进小程序。

## 7. 构建模型、源码与编译流水线

### 7.1 首期保留原生增强开发

首期继续支持 `TS/JS + WXML + SCSS/Less/WXSS + config.ts`，无需强迫应用改写为新 SFC 或 Vue/React 语法。

跨平台支持分三个层次：

| 层次 | 复用方式 | 承诺 |
| --- | --- | --- |
| 框架与工具 | 注册平台、渲染器和方言 | 新平台不修改通用编排器 |
| 业务与组件行为 | 中立 API、状态、属性和事件 | 满足能力契约的逻辑可复用 |
| 视图与平台特性 | 选择平台模板或经过验证的共享模板前端 | 原生模板不自动承诺跨平台等价 |

抖音官方文档使用 TTML/TTSS 及 `tt:` 指令，说明模板差异不仅是文件后缀；构建必须按实际语法和语义处理。[抖音框架概述](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/tutorial/miniapp-framework/introduction)

未来如果明确需要同一模板编译多端，可增加中立模板前端，产出受限的 Template IR。先定义表达式、事件、插槽、条件、循环与源位置语义，再为目标进行转换。原生扩展节点标记归属和能力；不支持时诊断。新增前端是独立工作，不作为首期注册底座的前置条件。

### 7.2 共享项目图

`ProjectGraph` 表达页面、组件、逻辑模块、模板、样式、资源、路由及依赖边。节点包含稳定 ID、源码位置、目标限制和能力要求，边包含解析依据。

CLI 与语言服务共享确定性的解析规则、平台描述和诊断模型。编辑器用只读文件系统与未保存文档覆盖层；CLI 用磁盘和构建上下文。可以共享快照和缓存格式，不能让编辑器操作依赖一个正在运行的构建进程。

首期 IR 重点是项目结构与路由/组件语义，原生模板节点保留方言 AST；不要虚构一个已能无损表达所有平台的统一 DOM。

### 7.3 构建过程

```text
解析 CLI 与配置 → 解析插件及目标 → 建立不可变组合计划
  → 发现源码与依赖 → 生成 ProjectGraph → 能力、类型与配置诊断
  → 选择组件变体 → 编译脚本和样式 → 执行目标转换与模板输出
  → 生成 app/page/component/project 配置及 bootstrap
  → 输出到 staging → 检查清单与目标约束 → 发布并生成回执
```

Build 固定阶段契约；插件在规定阶段贡献任务，并声明输入、输出、依赖与是否可缓存。相同输出路径只能有一个生产者，发生冲突即失败。只并行执行依赖图上相互独立、写入范围不冲突的任务。

构建 pass 输入为只读图或节点，返回补丁、资源和诊断，由 Build 验证后合并。平台 adapter 最终负责 `.wxml/.wxss`、未来 `.ttml/.ttss`、`.axml/.acss` 及配置输出规则。JS 打包、TypeScript 降级和样式预处理沿用现有工具，后端在需要时通过 pass 替换。

Worklet 转换归 Skyline 扩展：校验可调用函数和线程可传输值，保留指令及必要编译信息，明确依赖开发者工具执行的阶段。对项目启用 `compileWorklet` 的检查属于该链路的一部分；本地普通 JS 编译成功并不等于 Worklet 已通过真机验证。

### 7.4 配置合并与事实归属

合并优先级为：schema 默认值 → preset 默认值 → 项目公共配置 → 目标配置 → 环境覆盖 → 显式 CLI 参数。最后运行约束验证；优先级不能绕过渲染器必需条件。

数组和具备唯一键的集合由字段 schema 指定替换或按键合并，不采用任意深合并。相同层级重复定义报冲突，诊断指出贡献者和源位置。

平台要求放在 adapter，渲染要求放在 renderer，框架组件假设放在 UI 元数据，应用偏好放在 preset 或项目配置。例如自定义导航和禁用页面滚动不能一律宣称为所有 Skyline 应用的固定平台要求。

### 7.5 监听、缓存和诊断

缓存键包含源码哈希、解析配置、目标、插件及编译器版本、依赖 lockfile、显式读取的环境变量。插件声明额外依赖；不能追踪输入的任务默认禁用缓存。

监听以目标串行发布，变更防抖并合并；旧构建代次完成时若已失效，只能丢弃或保留缓存，不能覆盖新结果。插件、目标或配置变更重建计划；编译失败继续监听，保持上次有效产物。

诊断统一包含 `code / severity / message / file / range / target / plugin / related / fix`。CLI、编辑器和构建回执展示同一事实，来源位置通过 source map 回到源码。无法静态判断的结果明确标为未知，不猜测成功。

### 7.6 私有配置与产物发布

微信 adapter 向通用 OutputWriter 登记受保护路径 `project.private.config.json`。初始化只在目标文件不存在时执行一次，采用独占创建；已存在时不覆盖，也不重排 JSON。

输出清单区分 `generated` 与 `protected`，清理仅处理旧 `generated` 项。禁止整目录删除或替换微信输出根；发布、失败回滚、watch 重建均跳过受保护路径，也不能用旧副本覆盖开发者工具刚写入的内容。

暂存编译后按受管理文件发布，并保留回滚日志和下次启动的恢复信息。这是“完整生成后发布、可恢复提交”，**不是对外部开发者工具保证整个目录瞬时原子切换**。构建期间外部读取者仍可能看见逐文件更新；完成回执只在整轮提交成功后写出。

迁移期保留现有 `dist` 路径；新项目默认 `dist/<target>/`。多个目标必须有互不重叠的输出目录与独立输出锁。`clean` 默认保留受保护文件；组件 tgz、示例分发和上传清单均不包含用户私有配置。

## 8. 通用组件库

### 8.1 四层组成

```text
公开契约：props / events / slots / 方法 / 默认值 / 能力要求
    ↓
行为模型：状态转换、交互、受控值、页面归属与销毁
    ↓
主题系统：语义 token、尺寸、色彩、排版、动效偏好
    ↓
目标实现：原生模板、平台桥接、布局规则、动画与挂载
```

`@miniloom/ui` 发布稳定组件标识、共享行为和主题；`@miniloom/ui-wechat-skyline` 注册首期视图。后续增加 `ui-douyin`、`ui-alipay` 视图包。应用组件引用保持不变，构建时选中对应实现。

目标实现依赖 Core/UI 契约并通过 peer dependency 共享状态身份。共享层不能反向导入所有目标包，避免产生循环依赖或将未使用平台打进产物。应用预设负责同时装配公共组件与对应视图包。

### 8.2 组件元数据

`component.manifest.json` 描述组件 ID、语义版本、props、events、slots、公开方法、默认值、样式 token、必需能力、候选变体及源码位置。CLI 用它发现与裁剪组件；语言服务用它提供补全、注释、跳转和能力提示。

组件的公开定义是唯一维护源，构建生成 JSON 元数据和类型声明；不能让组件作者手工维护第二套同名属性表。原生第三方组件缺失元数据时，沿用当前静态分析，未知项保留未知。

变体解析规则：先按目标/能力过滤，再按项目显式选择；未指定时只接受清单内唯一的默认实现。两个候选同样有效但无唯一默认时失败。可选择 `platform + renderer`、仅平台、真正可移植的 shared 变体，但“shared”必须已有该目标可用的模板生成路径，不能把 WXML 直接宣称为 shared。

### 8.3 首批组件的拆分

| 组件 | 共享内容 | 微信 Skyline 目标实现 |
| --- | --- | --- |
| page | 布局参数、上下文、页面状态 | 滚动容器、平台布局和安全区测量 |
| page-header | 标题、返回/首页意图、公开事件 | 胶囊区域测量和具体导航桥接 |
| overlay / popup | 可见性、关闭原因、层级会话、卸载清理 | 层叠挂载、手势、Worklet 动画 |
| action-sheet | 项目列表、选择/取消语义、禁用状态 | 原生模板、触控反馈和动画 |
| tab-bar | Tab 配置、激活状态、导航意图 | 微信固定 `custom-tab-bar` 入口、精确页面归属和动画 |

主题共享的是设计 token 语义，目标样式构建器将其转换为目标支持的常量、样式规则或经验证的变量形式。不能默认各平台都支持相同 CSS 自定义属性、选择器和布局行为。

导航由应用注入，组件不能写死首页或读取 FitLedger Store。底栏声明区分“平台原生自定义底栏接入”与“页面内底栏视图”；后者可复用外观，但不自动具有前者的生命周期、页面缓存和路由行为。

### 8.4 两种组件分发

- `source`：发布共享逻辑、类型、tokens、目标视图和元数据，由 MiniLoom 消费端编译；这是首期主路径。
- `native-library`：选择一个目标，生成该平台可消费的组件目录、JS、样式、配置和清单；只有发布了该能力的 adapter 才允许构建。

如果原生库保留 Core 运行时依赖，必须明确其 peer dependency、原生 npm 构建方式与最低版本；如选择内联运行时，则拒绝混用会破坏单实例语义的消费者。首期不宣称源码组件包能被任意原生构建工具直接消费。

## 9. VS Code / Cursor 通用扩展

采用 **同一个编辑器扩展外壳 + Language Service + 方言/目标描述包**。语言能力通过 LSP 与编辑器外壳通信，解析与诊断不放在 `extension.ts`。LSP 的官方架构用于将语言服务与编辑器客户端分离。[VS Code 语言服务器文档](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)

首期保留当前属性注释、类型悬浮、Behavior 追踪、npm 组件回源、样式跳转和未保存文档能力；逐步把 `Project / Scripts / Styles / Language` 搬到语言服务，不以重构为由删除成熟能力。

### 9.1 两种项目接入模式

| 项目 | 发现方式 | 提供能力 |
| --- | --- | --- |
| MiniLoom 项目 | 配置、插件清单、构建生成的项目快照 | 目标切换、组件语义、能力检查、构建诊断映射 |
| 普通原生小程序项目 | 标准工程结构、app/page 配置和已安装 npm 包 | 对应方言补全、静态类型、路径解析和跳转 |

扩展不要求用户为了 WXML 补全先改成 MiniLoom 工程。多根工作区按项目独立索引，同一文件可选择活动目标；未知目标不借用另一平台规则猜测。

### 9.2 插件与规则加载

编辑器默认只读取清单和静态配置，不执行 `miniloom.config.mjs`、应用代码或任意 adapter build 入口。动态配置由用户执行构建/inspect 后生成纯数据快照；快照有输入哈希和协议版本，过期时提示并回退静态分析。

若语言能力需要可执行 provider，它必须是单独 language 入口，在 Workspace Trust 允许后由语言服务进程加载，并带取消、超时和文件数预算。进程隔离只能改善故障隔离，不应被称为可靠安全沙箱。

编译与索引的具体 AST 可以不同，解析路径与能力结果必须使用同一版本的协议及共享规则。项目工具版本和扩展捆绑语言服务不兼容时，协商协议；无法协商则提示并退回基础语法功能。

### 9.3 语法注册的真实边界

补全、悬浮和诊断可由 LSP 动态提供，但 VS Code 的语言、TextMate grammar 等贡献主要来自扩展发布清单。新增平台首次获得完整高亮，可能需要重新打包通用扩展，或者安装只含语法与数据的伴随扩展。

因此承诺是“新增平台不修改通用语言服务和编辑器业务逻辑”，不能承诺“安装任意 npm adapter 后所有语言高亮零更新自动出现”。分发工具可从语言包生成扩展贡献清单，避免手工维护多套规则。

使用稳定公开的 VS Code API、同一代码库和可安装的 VSIX 支持 VS Code 与 Cursor；在声明支持的具体版本中分别验证激活、命令与语言能力。VSIX 是共同交付形式，不能据此声称所有编辑器版本、市场分发或专有功能完全相同。[VS Code VSIX 安装说明](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace)

首期支持桌面本地与可验证的远程工作区。Web Extension Host、浏览器内预览和全量原生调试另设能力与交付范围。

## 10. 统一 CLI 与多形式打包

### 10.1 项目配置示意

```js
import { defineConfig } from '@miniloom/cli'
import wechatSkyline from '@miniloom/preset-wechat-skyline'

/** 使用预设注册插件，目标名称决定每次构建采用的组合。 */
export default defineConfig({
  source: 'src',
  presets: [wechatSkyline()],
  defaultTarget: 'wx-skyline',
  targets: {
    'wx-skyline': {
      platform: 'wechat',
      renderer: 'skyline',
      outDir: 'dist/wx-skyline',
    },
  },
  components: {
    libraries: ['@miniloom/ui'],
  },
})
```

预设只完成声明组合，读取文件、加载环境和输出产物仍由宿主控制。迁移现有项目时将 `outDir` 保留为 `dist`，避免私有配置位置变化。

### 10.2 参数维度

| 参数 | 含义 | 示例 |
| --- | --- | --- |
| `--target` | 选择配置中的命名目标 | `wx-skyline`、未来 `douyin-app` |
| `--platform` | 临时目标的平台筛选/覆盖 | `wechat` |
| `--renderer` | 临时目标的渲染 profile | `skyline` |
| `--mode` | 环境配置 | `development`、`production` |
| `--format` | 由 provider 支持的产物格式 | `app`、`source`、`native-library` |
| `--profile` | 工具链分发组合 | `wechat-skyline`、`all-supported` |
| `--artifacts` | 分发制品类型 | `npm`、`vsix` |
| `--out-dir` | 单目标产物位置 | `dist/wx-skyline` |

`--target` 与 `--platform/--renderer` 同时出现时，只接受与命名目标一致的值，冲突即失败；不静默修改目标身份。多目标通过重复 `--target` 指定，各自保持输出目录，禁止共用 `--out-dir`。

### 10.3 应用与组件构建

```sh
# 开发监听；使用配置中的微信 Skyline 目标。
pnpm exec miniloom dev --target wx-skyline

# 单次开发构建与必要类型检查。
pnpm exec miniloom build --target wx-skyline --mode development --typecheck

# 在未指定命名目标时，从已注册扩展中解析临时目标。
pnpm exec miniloom build --platform wechat --renderer skyline --format app

# 导出组件源码；不编译成某个宿主的原生产物。
pnpm exec miniloom build --project packages/ui --format source

# 后续 adapter 具备原生库产出能力后才开放此组合。
pnpm exec miniloom build --project packages/ui --target wx-skyline --format native-library

# 查看已解析插件、组件选择、能力与任务图。
pnpm exec miniloom inspect --target wx-skyline

# 检查依赖、协议版本、工程配置与目标要求。
pnpm exec miniloom doctor --target wx-skyline
```

### 10.4 工具链分发

```sh
# 打包首期完整开发套件，包含 npm 包与同一编辑器 VSIX。
pnpm exec miniloom pack --profile wechat-skyline --artifacts npm,vsix

# 仅打包组件及其声明的必要交付依赖。
pnpm exec miniloom pack --packages @miniloom/ui,@miniloom/ui-wechat-skyline --artifacts npm

# 按已实现并验收的平台集合生成交付包。
pnpm exec miniloom pack --profile all-supported --artifacts npm,vsix
```

`build` 生成应用或库内容，`pack` 归档 npm tgz / VSIX。一个命令前缀覆盖两者，但两类任务使用不同 provider。`all-supported` 只指当前已实现且 profile 声明支持的平台，不包含未来空 adapter。

发布层从包清单与 profile 计算依赖闭包、构建顺序、peer compatibility，再调用 npm/VSIX artifact provider。可复用工作区现有打包工具，取消 `pack.mjs` 中写死的包名数组。

输出包含 `distribution.manifest.json`：制品名称、版本、校验和、支持目标、依赖范围、协议版本和验证结果。构建产物要求相同输入下可复现；tgz/VSIX 的时间戳等非内容元数据需归一化后才宣称字节级可复现。

`pack` 只产生本地交付，不隐含上传或发布。未来接入各平台开发者工具 CLI、预览、上传时使用独立命令和相应工具 adapter。

## 11. 包组织与分发边界

建议先在当前 `framework/` 下演进，验证独立消费后再决定是否拆成独立仓库。

```text
framework/
  packages/
    contracts/
    core/
    build/
    cli/
    language-service/
    vscode/
    ui/
  adapters/
    wechat/
      manifest/
      build/
      runtime/
      language/
      compat/
  renderers/
    wechat-skyline/
  ui-targets/
    wechat-skyline/
  plugins/
    router/
    store-page/
    store-overlay/
    styles/
  presets/
    wechat-skyline/
  fixtures/
    wechat-skyline-app/
    native-wechat-project/
  docs/
  artifacts/
```

这是职责目录建议，不要求一次移动全部源码。样式插件内部可先包含 Sass/Less 两个处理器，是否拆包由依赖体积和独立发布需求决定。未来添加 `adapters/douyin`、`adapters/alipay`、对应 UI 变体和预设，不预先创建假实现。

Core、contracts 与运行时共享插件使用兼容的 peer 约束。Node 构建包与 VSIX 自带依赖按各自运行环境分发；源码 UI 和 runtime 按现有专用构建链路分发，package exports 标注清楚，不保证普通 Node 可以直接执行小程序源码入口。

协议与插件分别遵守语义化版本。协议主版本不兼容时提前失败；新增可选能力不要求所有 adapter 同时升级。官方预设固定一组验证过的兼容范围，并在实际发布时给出精确版本组合。

## 12. 新增平台时应改动什么

以将来接入抖音为例：

1. 新增 `adapter-douyin`：实现应用/页面/组件注册、生命周期与事件映射、能力端口、模板/样式规则、配置和工程输出。
2. 声明抖音实际支持的渲染 profile、基础库范围、能力与 artifact 格式。
3. 新增 `ui-douyin` 视图包，复用 UI 行为和 tokens；声明仍未支持的组件或动效。
4. 提供语言描述、原生 API/组件数据、TTML/TTSS 语法资源。
5. 新增预设、示例和 adapter 契约验收用例，登记交付 profile。
6. 构建通用编辑器 VSIX 时合入语法贡献；若采用伴随扩展，则仅安装对应语言包。
7. 应用新增目标配置和必要的原生模板变体，处理公共层外的微信专属代码。

不应修改 Core 状态算法、Build 调度主循环、CLI 命令分发或 Language Service 的通用导航算法。如果这些模块反复需要 `if platform === ...`，说明抽象边界仍未成立。

开闭原则不等于未来永远不改协议：新平台暴露出确实缺少的通用语义时，可以版本化新增端口或可选能力；不能为了维持表面上的零修改而把大量平台分支塞进 `any` 参数或自由回调。

## 13. 从 Skyline Kit 迁移的阶段

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| A：冻结兼容基线 | 记录现有公开入口、Store 行为、CLI 输出、插件功能与私有配置规则 | 当前应用开发构建可复现，有具体回归场景清单 |
| B：建立注册骨架 | 提取 contracts、目标解析、构建贡献表和运行时端口 | 微信能力通过 adapter 注册；Core 与 Build 不再导入微信类型和 Skyline 校验 |
| C：迁移微信运行时与构建 | 原生类型进 compat，Skyline 与工程预设拆开，输出事务逻辑保留 | 现有应用使用微信预设构建，运行与私有配置行为保持 |
| D：迁移组件与编辑器 | 组件行为/目标视图分开，生成元数据，语言服务与外壳分离 | 原组件可用，现有语言能力不退化，普通原生项目也可使用扩展 |
| E：统一 CLI 分发 | profile、包依赖闭包、npm/VSIX provider、交付清单 | 仓库外通过实际 tgz 和 VSIX 完成安装与开发构建 |
| F：第二平台验证 | 实现抖音 adapter 与少量代表性 UI，补充语义差异 | 新增平台只扩展规定位置；证明公共层可复用 |
| G：支付宝与模板演进 | 按实际需求补齐支付宝，评估中立模板前端 | 不降低已有微信能力；明确多端业务迁移边界 |

首期交付 A–E。F 是验证架构可扩展性的下一期，不能只凭接口看起来抽象就宣称多端已经完成。

兼容层保留旧配置文件、`skyline` 命令、导入路径与原生类型语义，转换为新的微信目标计划并输出弃用提示。旧包只转发到同一份实际运行时；不能各内置一份 Core。全局 `definePage/defineComponent` 如继续支持，其注入仍限制在兼容预设，通用新 API 推荐显式导入。

改名应检查包名、package exports、tsconfig types、CLI 自动导入、生成路径、组件注册、VSIX 设置键和脚本引用。扩展发布身份变化可能需要用户安装新扩展，不能承诺仅修改显示名称即可无缝升级；旧设置可在兼容期读取并提示迁移。

## 14. 首期验收与质量约束

本次只交付设计文档与架构图，不新增测试代码，也未修改小程序实现。下列是实现阶段应达到的验收要求。

| 范围 | 关键验收 |
| --- | --- |
| 注册协议 | 缺失依赖、循环依赖、重复端口、目标不匹配、冻结后注册均明确失败 |
| 运行时 | 两个 App 状态不串联；页面/组件销毁释放资源；底栏精确归属；异步回调不过期写入 |
| 构建 | 主包、npm 组件、TS、SCSS/Less、Worklet 和路由正确；无平台或 Node 代码泄漏 |
| 发布恢复 | 编译失败不发布；提交失败可回滚；崩溃残留可恢复；监听下一轮可继续 |
| 私有配置 | 成功、失败、清理与重建全过程，原 `project.private.config.json` 路径存在且字节不被构建修改 |
| 组件 | 公开契约一致；目标变体缺失时报错；降级必须声明；导航与业务状态可注入 |
| 编辑器 | 未保存源码、npm 回源、Behavior、样式和属性跳转不退化；多根项目隔离；动态配置不自动执行 |
| 分发 | 真实 tgz/VSIX 在仓库外安装；无 `workspace:` 残留依赖；协议和 peer 范围正确 |
| 性能 | 记录基线并比较冷构建、增量构建、包体积、语言服务延迟与 Skyline 真机交互 |

实现阶段优先沿用根目录已有开发验证命令：

```sh
# 框架各包的开发构建与类型验证。
pnpm dev:framework:check

# 消费应用在真实开发流程下验证。
pnpm dev:wx

# 制品完成后，使用实际交付包验证仓库外接入。
pnpm dev:framework:install-check
```

分包、原生组件库、远程工具和新平台只有通过各自能力验收后才写入 supported 清单。Skyline 交互还需微信开发者工具和真机验证；普通脚本构建不能替代渲染验收。

## 15. 建议采纳的核心决策

1. 品牌采用 **MiniLoom（织微）小程序开发框架**；微信 Skyline 是首个预设。
2. 核心稳定的是协议、状态与调度；平台和渲染能力通过明确的扩展点登记。
3. Build、Runtime、Language 使用独立宿主，共享协议与纯算法，按各自环境静态或按需装配。
4. 首期保留 TypeScript 与原生模板；通用组件通过共享契约、行为和主题实现复用，原生视图按目标选择。
5. 一个通用 VS Code/Cursor 扩展承载语言服务；新平台通过语言数据及必要的语法贡献扩展。
6. 一个 CLI 覆盖开发、构建与本地分发，平台、渲染器、环境、产物和交付 profile 分别配置。
7. 从已有 Skyline Kit 逐层迁移，保留成熟能力和私有配置保护，通过真实第二平台验证开闭边界。
