# @miniprogramlab/ui

[English](README.en.md)

用于页面结构、导航、模态界面和动画底栏的原生 Skyline、glass-easel 组件。组件包通过 peer dependency 与应用共享同一份 `@miniprogramlab/core`。

框架声明函数独立调用，如 `definePage(...)`、`defineComponent(...)`；导航、安装等操作也直接调用独立函数，这些入口均由 CLI 按需注入；页面、组件、状态、路由及 UI 装配的用法见 [统一 API 入口](../framework/README.md#统一-api-入口)。

## 组件

| 标签或入口 | 功能 | 包路径 |
| --- | --- | --- |
| `page` | 页头插槽、独立滚动、固定底栏、安全区、弹层插槽 | `@miniprogramlab/ui/page/index` |
| `page-header` | 紧凑或大标题、返回导航、文字操作、胶囊避让 | `@miniprogramlab/ui/page-header/index` |
| `overlay` | 全窗口遮罩、交互隔离、生命周期事件 | `@miniprogramlab/ui/lib/overlay/index` |
| `popup` | 五个入场方向、标题、关闭按钮、滚动内容、底部插槽 | `@miniprogramlab/ui/lib/popup/index` |
| `action-sheet` | 数据驱动选项、禁用及危险操作、退场后提交选择 | `@miniprogramlab/ui/lib/action-sheet/index` |
| 原生自定义底栏 | 稳定 id、角标、主题、手势弹簧、跨页动画接续 | `@miniprogramlab/ui/custom-tab-bar/index` |

按[工具集说明](../README.md)安装 UI、Core 和 CLI 交付包。组件以源码形式分发，由 CLI 统一编译 TypeScript、WXML、SCSS 和 Worklet。

## 注册普通组件

将 `libraryComponents` 合并到应用的全局 `usingComponents` 配置：

```ts

defineAppConfig({
  entryPageName: 'home',
  usingComponents: libraryComponents,
  // 补充 CLI 文档中要求的 Skyline 配置。
})
```

也可按上表路径单独注册组件，内部依赖由组件包自行声明。

## 页面布局与导航

```xml
<page title="Dashboard" footer="{{true}}">
  <view>Page content</view>
  <button slot="footer" bindtap="save">Save</button>
  <popup slot="overlay" model:show="{{dialogVisible}}" title="Details">
    <view>Dialog content</view>
  </popup>
</page>
```

`page` 支持 `header-mode="default|custom|none"`、`safe-top`、`safe-bottom`、`bottom-space`、`scrollable`、`padded` 及底栏选项。插槽包括默认正文、`header`、`header-extra`、`footer` 和 `overlay`。滚动定位及刷新属性会透传给原生滚动容器，滚动和刷新事件保留原生名称及 detail。

`page-header` 支持主标题、副标题、辅助信息、紧凑或大标题模式、可选返回导航、文字操作及强调色。页头与页面布局均响应窗口变化，预留胶囊和安全区空间。

在 `App.onLaunch` 中调用 `installUiComponents(app, { getEntryRouteUrl, navigateToUrl })` 安装同名导航能力。`getEntryRouteUrl()` 返回默认入口 URL；页头通过 `navigateToUrl(url).reLaunch()` 重建页面栈或切换 Tab，并根据 `{ ok }` 结果恢复失败后的按钮状态。`home-url` 可覆盖默认目标；设置 `auto-back="{{false}}"` 后由应用处理返回意图。

## 原生自定义底栏

在 `miniprogram.config.mjs` 中设置 `customTabBar: '@miniprogramlab/ui/custom-tab-bar/index'`。按 [CLI 文档](../cli/README.md)配置原生 `tabBar.custom: true`，并通过页面元数据声明二至五个 Tab 页面。

在底栏实例创建之前安装一致的运行时列表：

```ts

App({
  /** 安装与页面元数据声明一致的底栏路由。 */
  onLaunch() {
    installTabBar(this, {
      tabs: [
        { id: 'home', pagePath: '/pages/home/index', text: 'Home', iconPath: '/icons/home.svg' },
        { id: 'profile', pagePath: '/pages/profile/index', text: 'Profile', iconPath: '/icons/profile.svg' },
      ],
      config: { theme: { background: '#FFFFFF', color: '#10151F' } },
    })
  },
})
```

列表需要与生成的路由元数据保持一致。每个 Tab 页面同步自己所属的原生实例并预留底栏空间：

```ts
definePageConfig({
  page: {
    name: 'home', description: '首页',
    tabBar: { text: 'Home', order: 0, iconPath: '/icons/home.svg' },
  },
})
definePage({
  methods: {
    /** 页面显示时只处理业务，底栏由框架自动同步。 */
    onShow() {
      // 按需刷新业务数据。
    },
  },
})
```

`installTabBar` 同时安装页面适配器。CLI 为声明 `page.tabBar` 的页面自动接入选中项同步、配置订阅、窗口尺寸变化后的留白重算和卸载清理；原有 `onShow`、`onResize` 及 Behavior 方法继续执行。留白通过 `this.data.tabBarSpace` 和模板中的 `tabBarSpace` 读取，不再手动导入行为或调用同步方法。未声明 `page.tabBar` 的页面及普通组件不接入；页面代码不再设置 `tabPage`。

```xml
<page title="Home" bottom-space="{{tabBarSpace}}">
  <view>Tab content</view>
</page>
```

通过 `configureTabBar` 更新应用级配置，通过 `updateTabBarItem` 按 id 更新单项，通过 `resetTabBar` 恢复安装时的默认配置。支持布局、两种不透明主题基础色、动画参数、角标、可见性和禁用状态。手势动画在 UI 线程执行，仅选择语义传回 JavaScript。

CLI 将组件直接输出到原生底栏入口，保留 `getTabBar()` 与页面归属。`standalone` 实例用于事件驱动的预览或内嵌导航，不连接原生路由状态。

## 弹层与样式

弹层组件共享页面级层叠、背景滚动隔离、安全区布局和清理机制；透明遮罩仍拦截交互。属性、事件及示例见[弹层文档](src/lib/README.md)。

通过包路径导入共享 Sass token：

```scss
@use 'pkg:@miniprogramlab/ui/styles/_tokens.scss' as ui;

.content {
  color: ui.$text-primary;
}
```

## 开发

```sh
pnpm --filter @miniprogramlab/ui dev:check
pnpm --filter @miniprogramlab/ui dev
```

组件当前要求微信 Skyline 和 glass-easel，不提供跨平台渲染器或预编译 WebView 组件。

采用 [Apache-2.0](LICENSE)，相关声明见 [NOTICE](NOTICE)。
