# MiniProgramLab Devtool

[English](README.en.md)

面向 **VS Code 1.96+ 和 Cursor** 的小程序语言工具，提供 WXML 语法高亮、上下文补全、组件属性说明，以及脚本、模板和样式之间的跨文件跳转。

| 字段 | 内容 |
| --- | --- |
| 扩展标识符 | `miniprogramlab.devtool` |
| 发布者 | `miniprogramlab` |
| 包名 | `devtool` |
| 显示名称 | `MiniProgramLab Devtool` |

## 安装

在编辑器扩展面板搜索 **MiniProgramLab Devtool**，或打开 [Visual Studio Marketplace 页面](https://marketplace.visualstudio.com/items?itemName=miniprogramlab.devtool)、[Open VSX 页面](https://open-vsx.org/extension/miniprogramlab/devtool)。

本地打包版本可通过“从 VSIX 安装”选择生成的文件：

```sh
code --install-extension /path/to/devtool-0.0.2.vsix
cursor --install-extension /path/to/devtool-0.0.2.vsix
```

替换已安装版本后重载编辑器窗口。打开 `.wxml` 文件，确认语言模式为 **WXML**。扩展运行于 VS Code 或 Cursor，不安装到微信开发者工具；解析器已内置，无需仅为使用扩展额外安装 TypeScript。

页面组件注册支持 `definePageConfig({ page, build, config })` 中的 `config.usingComponents`，可从同文件、同目录任意脚本以及未保存文档读取。配置与 `definePage` 共存时，模板数据和方法仍来自页面运行时声明。

## WXML 高亮与补全

- 高亮标签、属性、注释和 `{{ }}` 表达式，WXSS 复用 CSS 高亮。
- 将插值边界识别为完整的 WXML 双括号对，表达式内部保留 JavaScript 语法及括号行为。
- 补全常用原生与 Skyline 标签、公共属性、事件绑定和已注册自定义组件。
- 根据上下文补全组件属性、data 路径、事件方法、循环局部变量及可用类名。
- 支持尚未输入完整的标签和属性，并提供准确的替换范围。

## 属性悬浮与跳转

在自定义组件属性名上悬浮，可查看声明名称、类型、注释和显式默认值：

```ts
Component({
  properties: {
    /** 显示在卡片内容上方的标题。 */
    headingText: { type: String, value: '' },
  },
})
```

```xml
<my-card heading-text="{{title}}" />
```

悬浮 `heading-text` 时会显示 `headingText: string`、声明注释和默认值 `''`。支持 camelCase、kebab-case 和 `model:` 属性。注释支持 JSDoc、块注释与行注释，继承及对象展开后的属性保留原始说明。

类型支持原生构造器、构造器别名、`optionalTypes` 联合类型、`PropType<T>` 及构造器断言。无法静态确定的运行时类型显示为 `unknown`，不根据默认值猜测。属性跳转定位到实际声明。

## 跨文件定义

macOS 使用 **Cmd+点击**，Windows/Linux 使用 **Ctrl+点击**，也可按 **F12**。

| 起点 | 目标 |
| --- | --- |
| WXML 组件标签 | 实际组件注册声明，或仅有模板的入口文件 |
| 自定义属性 | 属性声明，包括继承来源 |
| 事件或表达式绑定 | 对应方法、data 字段、属性或嵌套成员 |
| `wx:for` 局部变量 | 对应循环声明 |
| 模板类名 | 原始样式选择器 |
| 样式变量或 mixin | 对应作用域中的 Less/SCSS 声明 |
| import 路径 | 解析后的脚本或样式模块 |

定义追踪支持静态 ESM 导入与重导出、CommonJS、转发入口、对象或数组展开、多层 Behavior，以及可静态解析的工厂包装。组件解析支持本地路径、目录入口、显式扩展名、TypeScript 别名、pnpm 链接、包内 `miniprogram`/`main` 字段，以及条件或通配 exports。

完成定义跳转后，编辑器默认将声明居中显示，同文件跳转同样适用。单纯悬浮查询不会打开文件或移动视口，可通过 `skylineMiniapp.centerDefinitions: false` 关闭自动居中。

## 样式

类名补全与跳转覆盖组件同名样式、应用全局样式、显式配置的样式根及递归导入。SCSS 的 `&__child` 等嵌套选择器可定位到原始声明。

支持 Less `@import` 与 mixin、SCSS `@import`/`@use`/`@forward`、局部文件、命名空间、转发前缀、`show`/`hide` 和局部变量作用域。包样式可通过 Sass/CSS exports 条件解析。

## 异步组件与构建路径

原生异步组件沿 `usingComponents` 解析，占位组件保持独立跳转目标：

```json
{
  "usingComponents": {
    "order-card": "/packages/order/components/card/index",
    "loading-card": "/components/loading/index"
  },
  "componentPlaceholder": {
    "order-card": "loading-card"
  }
}
```

本地源码存在时，`order-card` 跳到真实组件，`loading-card` 跳到占位组件。此过程不会执行动态 import 或下载分包。

标准解析无法找到组件时，Devtool 会读取静态工程配置中的别名、源码与产物根目录、复制规则。通过配置导入、字符串表达式、受支持的 Node 路径操作和保留目录结构的复制规则，将产物路径映射回源码；不会执行配置文件，也不会按文件名相似度选择冲突候选。

无法静态解析的目录布局可通过显式映射补充：

```json
{
  "skylineMiniapp.componentRoots": ["packages/shared-mini"],
  "skylineMiniapp.componentAliases": {
    "/generated/widgets": "vendor/widgets",
    "@custom/*": ["packages/custom/src/*"]
  }
}
```

路径相对于当前文件所属工作区。未保存文档和未保存的配置修改均参与解析。

## 设置

| 设置项 | 默认值 | 用途 |
| --- | --- | --- |
| `skylineMiniapp.sourceRoot` | `""` | 覆盖自动发现的小程序根目录 |
| `skylineMiniapp.componentRoots` | `[]` | 额外组件搜索根目录 |
| `skylineMiniapp.componentAliases` | `{}` | 组件别名，值可为路径或路径数组，支持一个通配符 |
| `skylineMiniapp.styleRoots` | `[]` | 额外全局样式文件或导入根目录 |
| `skylineMiniapp.maxFiles` | `500` | 单次请求读取文件数上限，可配置范围为 10–5000 |
| `skylineMiniapp.centerDefinitions` | `true` | 实际定义跳转完成后将声明居中 |

## 支持范围与限制

Devtool 静态读取源码，不执行应用代码、构建配置或任意工厂函数。运行时生成的组件路径、动态属性名、冲突复制映射、缺失依赖和远程 `plugin://` 组件可能无法解析。

当前支持 JavaScript/TypeScript、WXML、WXSS、SCSS、Less；不提供 Pug、Sass 缩进语法、Vue 模板或完整 TypeScript 语言服务。同时启用多个 WXML 提供器可能产生重复补全。

## 开发

在仓库根目录执行：

```sh
pnpm --filter devtool dev
pnpm --filter devtool dev:check
pnpm --filter devtool dev:test
pnpm pack:framework
```

`dev` 监听扩展打包，`dev:check` 检查类型并生成扩展产物，`dev:test` 验证语言核心。工作区打包命令将 VSIX 写入 `artifacts/`。

## 自动发布

独立的 `MiniProgramLab/framework` 仓库通过 [publish-vscode.yml](../.github/workflows/publish-vscode.yml) 发布插件。推送 `vscode-v<版本号>` tag 后，工作流校验版本、运行测试及 `dev:check`，生成一份 VSIX，再分别发布到 Visual Studio Marketplace 和 Open VSX。其他包的版本 tag 不触发插件发布。

首次使用时，在该仓库的 **Settings → Secrets and variables → Actions** 添加以下 Repository secrets：

| Secret | 用途 |
| --- | --- |
| `VSCE_PAT` | Azure DevOps PAT，需要 Marketplace 的 Manage 权限；对应账号必须有 `miniprogramlab` 发布者的发布权限 |
| `OVSX_PAT` | Open VSX Access Token；对应账号必须有 `miniprogramlab` 命名空间的发布权限 |

发布者和命名空间需提前建立。Open VSX 账号还需关联 Eclipse 账号并签署 Publisher Agreement，操作见 [Open VSX 官方发布指南](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions)。VS Code 凭据设置见 [官方发布指南](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。该工作流使用 PAT；微软已宣布 Azure DevOps 全局 PAT 将于 2026 年 12 月 1 日退役，届时需要切换为指南中的 Microsoft Entra ID 发布认证。

发版时先修改并提交 `vscode/package.json` 的 `version`，再在 **framework 仓库根目录**执行与之匹配的 tag，例如版本为 `0.0.3` 时：

```sh
git tag vscode-v0.0.3
git push origin vscode-v0.0.3
```

目前仅接受 `主版本.次版本.修订版本` 格式的正式版本，不接受 `-beta` 等预发布版本。工作流不会自动改版本或创建提交；tag 与清单不一致时会停止。workflow 文件、版本更新和插件源码必须包含在该 tag 指向的提交中。

两个市场使用独立任务；某个市场失败时，可在 Actions 中选择 **Re-run failed jobs**。已经发布的同版本会跳过，不能用同版本覆盖已发布内容。打包结果作为工作流 artifact 保留 14 天；超过保留期需重新运行整个工作流以生成 VSIX。

采用 [Apache-2.0](LICENSE)，内置依赖相关声明见 [NOTICE](NOTICE)。
