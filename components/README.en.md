# @miniprogramlab/ui

[简体中文](README.md)

Native Skyline and glass-easel components for page structure, navigation, modal interfaces, and animated tabs. The package shares the application's `@miniprogramlab/core` instance through a peer dependency.

Declarations use standalone calls such as `definePage(...)` and `defineComponent(...)`; navigation and installation operations are also standalone calls. The CLI injects both kinds of bindings as needed. See [Unified API entry](../framework/README.en.md#unified-api-entry) for page, component, state, routing, and UI setup.

## Components

| Tag or entry | Features | Package path |
| --- | --- | --- |
| `page` | Header slots, independent scrolling, fixed footer, safe areas, overlay slot | `@miniprogramlab/ui/page/index` |
| `page-header` | Compact/large titles, back navigation, text actions, capsule clearance | `@miniprogramlab/ui/page-header/index` |
| `overlay` | Full-window mask, interaction isolation, lifecycle events | `@miniprogramlab/ui/lib/overlay/index` |
| `popup` | Five entry directions, title, close button, scrollable content, footer slot | `@miniprogramlab/ui/lib/popup/index` |
| `action-sheet` | Data-driven options, disabled/destructive actions, selection after exit | `@miniprogramlab/ui/lib/action-sheet/index` |
| Native custom tab bar | Stable ids, badges, themes, gesture-driven springs, cross-page animation continuation | `@miniprogramlab/ui/custom-tab-bar/index` |

Install the UI archive alongside Core and the CLI using the [toolkit instructions](../README.en.md). These are source components: the CLI compiles TypeScript, WXML, SCSS, and Worklets together.

## Register ordinary components

Merge `libraryComponents` into the application's global `usingComponents` configuration:

```ts

defineAppConfig({
  entryPageName: 'home',
  usingComponents: libraryComponents,
  // 补充 CLI 文档中要求的 Skyline 配置。
})
```

Individual components may also be registered by the paths above. Their internal dependencies are declared within the package.

## Page layout and navigation

```xml
<page title="Dashboard" footer="{{true}}">
  <view>Page content</view>
  <button slot="footer" bindtap="save">Save</button>
  <popup slot="overlay" model:show="{{dialogVisible}}" title="Details">
    <view>Dialog content</view>
  </popup>
</page>
```

`page` supports `header-mode="default|custom|none"`, `safe-top`, `safe-bottom`, `bottom-space`, `scrollable`, `padded`, and footer options. Slots are the default body, `header`, `header-extra`, `footer`, and `overlay`. Scroll positioning and refresh properties are forwarded to the native scroll container; scroll and refresh events retain their native names and detail.

`page-header` supports title/subtitle/eyebrow content, compact or large presentation, optional back navigation, action text, and accent colors. Both header and page layout respond to window changes and reserve capsule and safe-area space.

Install navigation with `installUiComponents(app, { getEntryRouteUrl, navigateToUrl })` during `App.onLaunch`. The header reads the entry URL and executes `navigateToUrl(url).reLaunch()` to rebuild the stack or switch tabs. It consumes the `{ ok }` result to restore its button after failure. `home-url` overrides the destination; `auto-back="{{false}}"` delegates back intent to the application.

## Native custom tab bar

Set `customTabBar: '@miniprogramlab/ui/custom-tab-bar/index'` in `miniprogram.config.mjs`. Declare native `tabBar.custom: true` and two to five tab pages through page metadata as described in the [CLI guide](../cli/README.en.md).

Install matching runtime items before tab instances are created:

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

Keep this list aligned with generated route metadata. Each tab page synchronizes its own native instance and reserves bar space:

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

`installTabBar` also installs the page adapter. For pages declaring `page.tabBar`, the CLI enables selection synchronization, configuration subscriptions, spacing updates after window resizing, and cleanup on detach. Existing `onShow`, `onResize`, and Behavior methods continue to run. Read spacing through `this.data.tabBarSpace` or `tabBarSpace` in templates; no manual behavior imports or synchronization calls are needed. Pages without `page.tabBar` and ordinary components do not receive this behavior. The page API has no manual `tabPage` switch.

```xml
<page title="Home" bottom-space="{{tabBarSpace}}">
  <view>Tab content</view>
</page>
```

Use `configureTabBar` for application-wide configuration, `updateTabBarItem` for updates by id, and `resetTabBar` to restore installation defaults. Layout, two opaque theme colors, motion parameters, badges, visibility, and disabled state are configurable. Gesture motion runs on the UI thread; only selection semantics cross to JavaScript.

The CLI emits the component directly at the native tab entry, preserving `getTabBar()` and page ownership. A `standalone` instance provides event-driven preview or embedded navigation without connecting to native route state.

## Overlays and styles

Overlay components share page-scoped stacking, background scroll isolation, safe-area layout, and cleanup. Transparent masks still intercept interaction. See the [overlay guide](src/lib/README.en.md) for properties, events, and examples.

Import shared Sass tokens through the package path:

```scss
@use 'pkg:@miniprogramlab/ui/styles/_tokens.scss' as ui;

.content {
  color: ui.$text-primary;
}
```

## Development

```sh
pnpm --filter @miniprogramlab/ui dev:check
pnpm --filter @miniprogramlab/ui dev
```

These components currently require WeChat Skyline and glass-easel. They are not cross-platform renderers or prebuilt WebView components.

Licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE).
