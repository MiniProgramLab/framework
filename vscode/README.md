# Skyline 小程序开发助手

VS Code 1.96+ / Cursor 扩展。提供 WXML 语法高亮、标签/属性/绑定补全、组件属性悬浮说明，以及组件、Behavior、Less 和 SCSS 文件的定义定位。微信开发者工具不安装此 VSIX。

## 安装和开发

在扩展面板选择“从 VSIX 安装”，打开交付的 `skyline-kit-vscode-0.2.1.vsix`。也可运行：

```sh
code --install-extension /交付目录/skyline-kit-vscode-0.2.1.vsix
# 安装到 Cursor。
cursor --install-extension /交付目录/skyline-kit-vscode-0.2.1.vsix
```

仓库内使用 `pnpm --filter skyline-kit-vscode dev:check` 构建，`pnpm --filter skyline-kit-vscode dev:test` 验证语言核心，`pnpm pack:framework` 生成 VSIX。运行时依赖已经打入扩展，不需要使用者安装 TypeScript。

## 已实现

- WXML 标签、属性、注释和 `{{ }}` 表达式高亮，WXSS 复用 CSS 高亮。
- 常用原生及 Skyline 标签、公共属性、事件属性、已注册自定义组件及 properties 补全。
- 在 WXML 属性名上悬浮时显示原始声明注释、属性类型与显式默认值；支持 camelCase、kebab-case、`model:` 属性，以及 npm、异步组件和多层 Behavior 继承的 properties。
- 属性类型支持原生构造器、`optionalTypes` 联合类型、构造器别名和 `PropType<T>` / 构造签名断言。注释支持 JSDoc、块注释和行注释；属性名也可直接跳转到声明。
- 事件方法、data、properties 与嵌套对象字段的定义跳转及补全。
- 沿多层 Behavior 的 import、重导出、默认导出、CommonJS、对象/数组展开及静态工厂返回值追踪定义；本地成员覆盖继承成员，方法别名继续定位到导入函数实现。
- class 补全和定义沿同名样式、app 全局样式及多层样式导入查找，支持 SCSS `&__child` 等静态嵌套选择器。
- Less `@import`、SCSS `@import/@use/@forward` 及局部 `_文件.scss` 解析；变量和 mixin 支持命名空间、转发前缀、show/hide 与块作用域。
- 组件标签通过全局及当前页面/组件的 `usingComponents` 定位到 `Component` / `defineComponent` 声明，支持开始和结束标签，局部配置覆盖全局配置。
- 本地组件支持相对路径、小程序根路径、目录、显式 `.ts/.js/.json/.wxml` 扩展和 tsconfig 别名；npm 组件支持 pnpm 链接、`miniprogram`、`main`、条件及通配 `exports`。尚未生成的 `miniprogram_npm` 路径可以回源已安装的 npm 包。
- 沿 ESM 默认导出、重导出、CommonJS 和副作用导入穿透组件转发入口，定位到实际注册行，并读取真实组件的 properties 提供补全。
- 支持 Vant 的 `VantComponent`、`props/mixins`、编译后的 `(0, module.factory)`、CommonJS 导出初始化以及 JS 与 `.d.ts` 共存；自定义注册函数可沿工程实现识别内部 `Component` 调用。
- 原生分包异步组件沿 `usingComponents` 指向真实组件，`componentPlaceholder` 保留占位语义；无需等待分包运行时下载，本地存在源码即可跳转。
- import 路径支持跳转；未保存文档参与解析；循环引用有去重和文件数限制。
- 支持 TypeScript tsconfig `paths`、extends 与 pnpm/package exports 解析，包括 Sass 条件及通配样式导出。

macOS 使用 Cmd+点击，Windows/Linux 使用 Ctrl+点击，也可以按 F12。请确认 `.wxml` 文件的语言模式为 WXML。

跳转完成后，变量、方法、组件、属性和样式声明默认显示在编辑器视口中部，同文件跳转同样生效。悬浮或单纯查询定义不会移动编辑器；可通过 `skylineMiniapp.centerDefinitions: false` 关闭自动居中。

```ts
properties: {
  /** 卡片标题，显示在内容区域上方。 */
  headingText: { type: String, value: '' },
}
```

鼠标移动到 `<my-card heading-text="标题" />` 的 `heading-text` 上，会看到 `headingText: string`、上述中文注释和默认值。未保存的声明修改会立即参与解析。未声明注释时只显示类型；无法静态确定类型时显示 `unknown`，不使用默认值猜测完整业务类型。

## 异步组件示例

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

在 `<order-card />` 上 Cmd+点击会打开 `packages/order/components/card/index.ts` 或对应 JS 中的组件声明；`<loading-card />` 则跳到占位组件自身。路径解析同样适用于 `.config.ts` 中通过常量、导入和对象展开声明的配置。此能力用于分析原生分包项目，不会修改项目路由或启用 CLI 的分包构建。

## 根据工程配置推断组件路径

标准注册路径无法命中时，扩展从工程布局与构建配置继续查找，不包含仓库名、业务目录或特定组件路径的特判：

1. 先读取当前组件和 app 的 `usingComponents`，按相对路径、源码根、应用包根、工作区根、tsconfig 别名和 npm 包入口解析。
2. 按需读取配置文件、配置目录、package scripts 指向的脚本及其静态相对导入，提取构建 `alias`、`sourceRoot/srcRoot/srcDir`、`outputRoot/outDir/output.path` 和复制规则。
3. 解释常量、字符串拼接、模板字符串、简单路径工厂及 Node 路径函数，把输出目录中的组件路径沿 `from/to/context` 复制关系回溯到源码。支持常见的目录复制和保留目录层级的 glob 复制，不执行配置或脚本。
4. 找到入口后，沿转发模块和注册函数定位到声明。推断得到多个不同文件时保留未解析状态，避免因遍历顺序或同名文件误跳。

例如构建配置把 `vendor/widgets` 复制到 `output/ui`，且输出根为 `output`，即使尚未运行构建，`/ui/card/index` 也可以定位到 `vendor/widgets/card/index.ts`。路径关系来自配置，目录可以任意命名。复制语义参考 [CopyWebpackPlugin 官方说明](https://webpack.js.org/plugins/copy-webpack-plugin/)。

不能静态解释的特殊构建逻辑可用通用设置补充，路径相对于当前文件所属的工作区目录：

```json
{
  "skylineMiniapp.componentRoots": ["packages/shared-mini"],
  "skylineMiniapp.componentAliases": {
    "/generated/widgets": "vendor/widgets",
    "@custom/*": ["packages/custom/src/*"]
  }
}
```

配置扫描有目录深度、文件数、表达式求值预算和取消检查，不会在整个仓库按组件名称搜索并随意挑选文件。构建配置修改后，下次请求重新读取。

## 设置与边界

`skylineMiniapp.sourceRoot` 可覆盖源码根；默认查找最近的 `app.config.ts/.js` 或 `app.json`，并参考 `project.config.json`。`skylineMiniapp.styleRoots` 配置额外的全局样式文件或导入搜索目录。`skylineMiniapp.maxFiles` 默认 500，控制每次请求的读取范围。

扩展进行静态分析，不执行项目配置或业务代码。运行时动态生成的 Behavior、组件路径、动态键名和插值生成的选择器无法可靠推断时不会猜测目标。异步组件指原生 `usingComponents + componentPlaceholder` 配置，不执行动态 `import()` 加载器。远程 `plugin://` 组件、缺失的源码或尚未安装的 npm 包无法定位；带哈希重命名、依赖环境变量或运行时代码的复制规则无法静态确定时不推断；仅有模板或无法静态识别注册的编译产物会打开入口文件。当前主要支持 JS/TS、WXML、SCSS、Less、WXSS；不提供 Pug、Sass 缩进语法、Vue 模板或全量类型语言服务。与其他 WXML 扩展同时启用可能出现重复补全，可按项目选择保留一个提供器。

功能参考 [minapp-vscode](https://github.com/wx-minapp/minapp-vscode)，本包使用独立实现。语言提供器使用 [VS Code 官方扩展 API](https://code.visualstudio.com/api/language-extensions/programmatic-language-features)，语法高亮使用 [TextMate Grammar](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide)。

图标通过内置 imagegen 生成，原始 PNG 为 1254×1254 像素；文件为 `assets/icon.png`，完整生成提示词保存在 `assets/icon-prompt.txt`，提示词不随 VSIX 分发。
