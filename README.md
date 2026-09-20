# MiniProgramLab Framework

[English](README.en.md)

MiniProgramLab 是一套小程序开发工具集，在同一个 pnpm monorepo 中提供原生运行时封装、状态管理、UI 组件、构建 CLI 和编辑器工具。

Core 的页面封装和 UI 当前面向 **微信小程序 Skyline 与 glass-easel**。TypeScript CLI 通过注册的适配器支持微信（默认）、抖音原生和支付宝原生工程；各平台 API 与模板保持原生形式，CLI 不自动将微信业务移植到其他平台。

框架声明函数独立调用，如 `definePage(...)`、`defineComponent(...)`；导航、安装等操作也直接调用独立函数，这些入口均由 CLI 按需注入；页面、组件、状态、路由及 UI 装配的用法见 [统一 API 入口](framework/README.md#统一-api-入口)。

## 包组成

| 包 | 用途 | 文档 |
| --- | --- | --- |
| `@miniprogramlab/core` | 带类型的页面与组件封装、应用和页面状态、Store 插件、跨平台路由子模块 | [核心框架](framework/README.md) |
| `@miniprogramlab/cli` | 平台注册适配、构建动画、路由生成、脚本与样式编译 | [CLI](cli/README.md) |
| `@miniprogramlab/ui` | 页面布局、导航页头、遮罩、弹窗、操作菜单、原生动画底栏 | [组件库](components/README.md) |
| `miniprogramlab.devtool` | VS Code 与 Cursor 中的 WXML 补全、属性说明与跨文件跳转 | [开发工具](vscode/README.md) |

## 主要功能

- **原生 Skyline 应用开发**：使用 TypeScript、WXML、SCSS、Less 或 WXSS，保留原生页面和组件行为。
- **共享应用状态**：按 App 实例定义状态，按明确归属隔离页面状态，通过同步草稿更新并订阅不可变快照。
- **可复用界面**：组合适配安全区的页面容器、页头、固定底栏、层叠弹层和可配置的自定义 Tabbar。
- **可靠的开发构建**：从页面元数据生成路由，编译可达依赖，监听源码包，仅在编译成功后更新产物。
- **编辑器辅助开发**：从 WXML 绑定、组件标签、属性、类名、变量和 mixin 定位到声明。

## 开发工具集

环境要求：Node.js 22 或更高版本、pnpm 10.13.1。

```sh
git clone https://github.com/MiniProgramLab/framework.git
cd framework
pnpm install --frozen-lockfile
pnpm dev:check
pnpm dev:test
```

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动各包已提供的开发监听 |
| `pnpm dev:check` | 执行各包开发构建及类型、语法检查 |
| `pnpm dev:test` | 执行 Router、CLI、Store、弹层、Tabbar、类型契约及编辑器回归检查 |
| `pnpm pack:framework` | 在 `artifacts/` 生成三个 npm tarball 和一个 VSIX |
| `pnpm dev:framework:install-check` | 在独立临时项目中验证交付包 |

私有工作区包 `@miniprogramlab/checks` 维护运行时与组件协作回归、类型契约和独立测试数据，不依赖消费应用。单独执行 `pnpm --filter @miniprogramlab/checks dev:test` 可检查这些边界；`pnpm --filter @miniprogramlab/checks bench:store` 提供可选的本机 Store 性能基准。

安装验证前需要先生成交付包。验证覆盖样式、原生底栏输出、构建失败恢复、监听更新和私有配置保留，首次安装依赖需要联网。

## 在应用中使用

执行 `pnpm pack:framework` 生成交付包，再从实际路径安装：

```sh
pnpm add /path/to/miniprogramlab-core-0.1.0.tgz /path/to/miniprogramlab-ui-0.1.0.tgz
pnpm add -D /path/to/miniprogramlab-cli-0.1.0.tgz typescript miniprogram-api-typings
```

安装尚未发布的本地交付包时，**先在消费项目 package.json 中加入以下配置，再执行上面的安装命令**，并替换绝对路径。这样 CLI 声明的 Core 依赖也会使用本次交付包；使用已发布的 npm 版本时不需要此覆盖配置。

```json
{
  "pnpm": {
    "overrides": {
      "@miniprogramlab/core": "file:/absolute/path/miniprogramlab-core-0.1.0.tgz"
    }
  }
}
```

1. 创建包含 `app.ts`、`app.config.ts` 和页面文件的源码目录。
2. 通过 `definePageConfig` 声明页面，用 `entryPageName` 选择入口。
3. 在 TypeScript 的 `types` 中加入 `miniprogram-api-typings` 和 `@miniprogramlab/core/globals`。
4. 按需注册 UI 组件，安装应用自己的导航能力或状态定义。
5. 执行 `pnpm exec miniprogram dev`，在微信开发者工具中导入产物目录。

[CLI 文档](cli/README.md) 包含必要配置和最小页面示例。Core 与 UI 包分发 TypeScript、模板、样式及 Worklet 源码，由 CLI 统一编译成原生产物；此流程无需额外执行开发者工具的“构建 npm”。

`@miniprogramlab/routes` 是 CLI 按应用生成的统一入口，提供路由表、默认入口、页面名称及参数类型，无需单独安装。应用按 [CLI 文档](cli/README.md#统一路由入口)继承生成的 TypeScript 配置即可使用。

路由通过 [`@miniprogramlab/core/router`](framework/README.md#跨平台路由) 使用，导航平台由 CLI 编译时选择，应用无需注册各平台适配器。

## 构建行为与当前边界

- 从配置发现主包页面；CLI 当前不构建微信运行时分包。
- 原生 Tab 注册信息和运行时 Tab 列表必须对应同一组路由。
- 普通模块共享运行时身份，Worklet 依赖随调用方内联。
- 产物中已有的 `project.private.config.json` 保持原位置和原内容。
- 编译失败保留旧产物；更新产物失败时尝试从备份恢复。
- 编辑器扩展可独立分析原生分包异步组件，不受 CLI 当前分包构建边界影响。

## 开源协议

采用 [Apache-2.0](LICENSE)。版权及内置依赖信息见 [NOTICE](NOTICE)，交付包均包含这两个文件。项目源码使用简短 SPDX 标头，上游许可证及声明文件保持完整。
