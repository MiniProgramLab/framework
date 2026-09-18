# @miniprogramlab/cli

独立微信 Skyline 小程序构建器，通过 pnpm 安装后提供 `skyline` 命令。要求 Node.js 22+。

```sh
pnpm exec skyline dev
pnpm exec skyline build --mode=development --typecheck
pnpm exec skyline build --mode=production --typecheck
pnpm exec skyline routes
pnpm exec skyline --help
```

`--root` 指定消费项目根，默认当前工作目录；`--src`、`--out-dir` 覆盖源码和产物目录。`--mode` 读取 `.env`、`.env.local`、`.env.<mode>`、`.env.<mode>.local`，系统变量优先。只注入 `mode`、`apiBaseUrl`、`title`；AppID 写入微信工程配置。API 地址可省略；非开发环境配置 API 时须使用 HTTPS。

## 项目配置

```js
import { defineConfig } from '@miniprogramlab/cli'

/** 当前应用需要的构建选项。 */
export default defineConfig({
  source: 'src',
  outDir: 'dist',
  customTabBar: '@miniprogramlab/ui/custom-tab-bar/index',
  watchDirectories: [],
})
```

默认文件名为 `skyline.config.mjs`，也可使用 `--config` 指定。修改目录或底栏入口配置后重启监听。使用 `--poll` 或配置 `poll: true` 可主动使用轮询；原生监听遇到系统资源限制时也会自动回退，开发进程继续等待修正。源码、项目配置、环境文件、应用依赖包与额外目录变更会触发串行防抖编译。

消费项目需提供 `project.config.json`、`src/app.ts`、`src/app.config.ts` 和 `src/pages/*/index.{ts,wxml,config.ts}`，页面样式可选 SCSS、Less 或 WXSS。路由配置语义保持原框架约定：使用 `pagesName` 和 `entryPageName`，不手写 `pages`、`subPackages` 或 `tabBar.list`。当前页面发现规则覆盖主包，尚不支持微信运行时分包。

## 构建保证

- 应用及组件脚本通过实际依赖图生成 CommonJS，框架和 Store 共用一份模块身份。
- `.worklet.ts`/`.worklet.js` 保持调用方内联；其中的运行时依赖也必须是 Worklet 模块。
- `usingComponents` 支持原生 npm 包及包含 TS、SCSS、`.config.ts` 的源码包，递归处理组件依赖。
- `customTabBar` 将包中的原生组件直接重定位到微信固定根入口；应用同时存在本地入口时明确报错。
- 先在暂存目录完成编译，成功后逐文件提交；提交失败恢复旧产物。
- `dist/project.private.config.json` 已存在时不改写、不删除、不挪动。首次使用项目私有文件、示例文件或空对象初始化。
- 不允许输出覆盖项目根、源码或源码的上级目录。

`defineConfig` 是公开配置 API；`buildProject` 和其他构建模块可从包子路径导入。`buildProject` 使用 `loadOptions` 解析后的选项。
