# @miniprogramlab/ui

基于 Skyline + glass-easel 的原生组件包，包含页面容器、页头、遮罩、弹窗、动作菜单和弹动 Tabbar。组件通过 peerDependency 使用消费项目的 `@miniprogramlab/core`。

## 普通组件

```ts
import { libraryComponents } from '@miniprogramlab/ui'

/** app.config.ts 中统一注册；页面可直接使用组件标签。 */
defineAppConfig({
  entryPageName: 'home',
  usingComponents: libraryComponents,
})
```

公开路径：

| 标签 | 包路径 |
| --- | --- |
| page | `@miniprogramlab/ui/page/index` |
| page-header | `@miniprogramlab/ui/page-header/index` |
| overlay | `@miniprogramlab/ui/lib/overlay/index` |
| popup | `@miniprogramlab/ui/lib/popup/index` |
| action-sheet | `@miniprogramlab/ui/lib/action-sheet/index` |

页头由应用注入导航，在 `App.onLaunch` 调用 `installComponents(this, { homeUrl, returnTo })`；其中 `homeUrl(): string` 返回默认首页，`returnTo(url): Promise<void>` 按业务路由选择 switchTab 或 reLaunch。`home-url` 属性可覆盖默认首页，`auto-back` 关闭时仍只派发事件。

## 原生 Tabbar

在 `skyline.config.mjs` 中设置：

```js
/** 将包组件输出到微信原生 getTabBar() 对应的固定位置。 */
export default { customTabBar: '@miniprogramlab/ui/custom-tab-bar/index' }
```

应用负责在 `App.onLaunch` 安装静态 Tab 列表：

```ts
import { installTabBar } from '@miniprogramlab/ui/custom-tab-bar/controller'

/** 应用完成原生列表注册后安装运行时外观。 */
installTabBar(app, {
  tabs: [
    { id: 'home', pagePath: '/pages/home/index', text: '首页', iconPath: '/icons/home.svg' },
    { id: 'mine', pagePath: '/pages/mine/index', text: '我的', iconPath: '/icons/mine.svg' },
  ],
  config: { theme: { background: '#FFFFFF', color: '#10151F' } },
})
```

`tabs` 应来自页面 `route.tab` 的生成结果，且与微信注册列表一致。每个 Tab 页的 `onShow` 调用 `syncTabPage(this)`，`tabPageBehavior` 负责底部留白。`configureTabBar`、`updateTabBarItem`、`resetTabBar`、主题、弹簧和独立预览接口均保留。

CLI 直接输出组件原生入口，不包裹额外子组件，保留 `getTabBar()`、组件归属与弹层隔离语义。业务图标、主题默认值和生成路由保留在应用内。独立预览使用 `standalone`，不连接应用导航。

## 分发方式

`miniprogram` 指向包内 `src`。TS、WXML、SCSS 和 Worklet 由专用 CLI 统一处理，不直接交给微信“构建 npm”。样式 token 可通过 `pkg:@miniprogramlab/ui/styles/_tokens.scss` 使用；页面与弹层默认视觉保持当前应用表现。
