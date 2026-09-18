# MiniProgramLab Framework

独立的 pnpm monorepo，统一维护小程序框架、组件、构建工具和 VS Code / Cursor 扩展。当前实现支持微信 Skyline，包内不依赖宿主应用的业务路由、全局状态、图标或 API。

源码仓库：<https://github.com/MiniProgramLab/framework>。为保持现有应用兼容，当前子包沿用 `@skyline-kit/*` 包名及 `skyline` 命令。

| 子包目录 | 包名 | 职责 |
| --- | --- | --- |
| `cli` | `@skyline-kit/cli` | TS、SCSS/Less、路由、npm 组件、Worklet 与微信产物构建 |
| `framework` | `@skyline-kit/framework` | definePage、defineComponent、Store、页面归属及插件 |
| `components` | `@skyline-kit/components` | page、page-header、overlay、popup、action-sheet、custom-tab-bar |
| `vscode` | `skyline-kit-vscode` | WXML 高亮补全与跨文件定义跳转 |

四个目录都是本仓库的 pnpm workspace 包。组件包通过 peerDependency 依赖框架，应用和组件共享同一框架实例。本仓库既可单独克隆，也可作为宿主项目的 Git submodule 开发。

编辑器扩展支持本地、npm 和原生分包异步组件的 Cmd+点击跳转，可沿配置及组件转发入口定位到注册声明。WXML 属性悬浮显示类型、声明注释与默认值；多层 Behavior、Less/SCSS 类名、变量与 mixin 同样支持跨文件定位，跳转后自动居中；具体能力和静态分析边界见 `vscode/README.md`。

## 开发与打包

独立克隆后，在本仓库根目录运行，要求 Node.js 22+、pnpm 10.13.1：

```sh
git clone git@github.com:MiniProgramLab/framework.git
cd framework
pnpm install --frozen-lockfile
pnpm dev:check
pnpm dev:test
pnpm pack:framework
pnpm dev:framework:install-check
```

`pnpm dev` 启动框架、组件与扩展的开发监听。`pack:framework` 生成三个 npm `.tgz` 和一个 VS Code `.vsix`，统一放在本仓库的 `artifacts/`。`dev:framework:install-check` 会在仓库外用实际 tarball 创建临时项目，验证 SCSS/Less、原生底栏、失败回滚、私有配置与监听。首次执行需要联网安装 npm 构建依赖。

## 在 FitLedger 中联合开发

FitLedger 将本仓库作为 `framework/` submodule 引用，并通过父项目的 `framework/*` workspace 配置保留原有本地包链接。目录布局及 `pnpm dev:wx` 等应用命令保持不变。在 FitLedger 根目录安装时使用父项目锁文件；独立克隆本仓库时使用本仓库锁文件。联调期间统一在 FitLedger 根目录安装依赖。

```sh
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm dev:framework:check
pnpm dev:wx
```

框架与应用分别提交。先在 `framework/` 提交并推送，再在宿主仓库提交新的 submodule 版本指针：

```sh
git -C framework add .
git -C framework commit -m "feat: 更新小程序框架"
git -C framework push origin main
git add framework
git commit -m "chore: 更新框架引用版本"
```

宿主仓库只记录框架提交号，不包含框架源码历史。拉取宿主项目后执行 `git submodule update --init --recursive` 恢复锁定版本；更新到框架远端最新版本时，在确认本地改动已处理后执行 `git -C framework pull --ff-only origin main`，再提交宿主引用。宿主仓库的远端由业务项目单独配置。

当前没有发布到 npm Registry 或 VS Code Marketplace；无需远程发布即可使用本地包。包名和版本可在正式发布前调整。

其他项目安装时，将路径替换成实际交付文件路径：

```sh
pnpm add /交付目录/skyline-kit-framework-0.1.0.tgz /交付目录/skyline-kit-components-0.1.0.tgz
pnpm add -D /交付目录/skyline-kit-cli-0.1.0.tgz typescript miniprogram-api-typings
pnpm exec skyline dev
```

框架和组件包按源码分发，保留 TS 类型、SCSS 和 `.worklet.ts`，由专用 CLI 完成最终编译；无需运行微信开发者工具的“构建 npm”。开发者工具导入应用 `dist` 即可。普通 Node.js 运行器不直接执行这些小程序源码包。

## 接入顺序

1. 创建 `src/app.config.ts`，通过 `defineAppConfig` 指定 `entryPageName`、Skyline 配置及全局组件。
2. 页面使用 `definePage`，各页面通过 `index.config.ts` 声明唯一 `pagesName`；开启原生底栏时在页面 `route.tab` 声明 2–5 个 Tab。
3. `tsconfig.json` 的 `types` 包含 `miniprogram-api-typings` 与 `@skyline-kit/framework/globals`。
4. 在 `App.onLaunch` 中安装应用自己的全局状态、首页导航与 Tab 列表。
5. 使用 `skyline build --mode=development --typecheck` 做单次开发构建验证。

各包 README 说明其公开接口，`checks/install.mjs` 提供不依赖宿主项目的完整消费示例。FitLedger 联调时，也可参考宿主目录中的 `apps/wx/skyline.config.mjs`、`apps/wx/src/app.ts`、`apps/wx/src/app.config.ts` 与 `apps/wx/src/framework.d.ts`。

原生底栏由 CLI 从组件包直接输出至 `dist/custom-tab-bar/index.*`，不增加一层组件包装。业务图标可以留在应用 `src/custom-tab-bar/icons`；该目录不能再同时提供本地 `index.*`。私有项目配置在首次构建后保持原位置及字节内容，失败构建不发布半成品。
