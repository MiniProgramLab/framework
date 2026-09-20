// SPDX-License-Identifier: Apache-2.0
import type { RouteParamRule, TabRouteMetadata } from './router/types.js'

/** 配置使用与路由运行时一致的平台无关协议。 */
export type { RouteParamRule, TabRouteMetadata } from './router/types.js'

/** 原生页面窗口配置；额外微信配置字段按原样保留。 */
export interface WindowConfig {
  /** 导航栏标题。 */
  navigationBarTitleText?: string
  /** 导航栏背景色。 */
  navigationBarBackgroundColor?: string
  /** 导航栏文字颜色。 */
  navigationBarTextStyle?: 'black' | 'white'
  /** Skyline 页面统一使用自定义导航栏。 */
  navigationStyle?: 'custom'
  /** 页面背景色。 */
  backgroundColor?: string
  /** 下拉加载区域的文字样式。 */
  backgroundTextStyle?: 'dark' | 'light'
  /** 下拉刷新由 scroll-view 处理，不启用原生页面刷新。 */
  enablePullDownRefresh?: false
  /** 距离底部多少像素时触发触底事件。 */
  onReachBottomDistance?: number
  /** 屏幕旋转方向。 */
  pageOrientation?: 'auto' | 'portrait' | 'landscape'
  /** 允许透传尚未在本地补充类型的微信配置项。 */
  [key: string]: unknown
}

/** 原生页面公共字段；未知平台字段仅在 config 内透传。 */
export interface NativePageConfig {
  /** 本地、npm 或插件组件的路径映射。 */
  usingComponents?: Record<string, string>
  /** 页面不能注册为原生组件。 */
  component?: false
  /** 原生扩展字段由目标平台适配器校验。 */
  [key: string]: unknown
}

/** 微信 Skyline 原生页面配置，不包含框架路由或构建字段。 */
export interface WechatPageConfig extends WindowConfig, NativePageConfig {
  /** 页面继承纯 Skyline 渲染策略，不允许切换到 WebView。 */
  renderer?: 'skyline'
  /** 页面使用 glass-easel 组件框架。 */
  componentFramework?: 'glass-easel'
  /** 渲染选项统一放在 app.config.ts，避免页面覆盖全局策略。 */
  rendererOptions?: never
  /** 本地、npm 或插件组件的路径映射。 */
  usingComponents?: Record<string, string>
  /** 页面不是自定义组件，不能声明 component: true。 */
  component?: false
  /** 禁止原生页面滚动，滚动区域使用 scroll-view。 */
  disableScroll?: true
  /** 是否允许分享给好友。 */
  enableShareAppMessage?: boolean
  /** 是否允许分享到朋友圈。 */
  enableShareTimeline?: boolean
}

/** 页面参与构建的环境范围；省略时在所有构建模式下启用。 */
export interface PageBuildConfig {
  /** 允许的构建模式，与 CLI 的 --mode 对应。 */
  readonly modes?: readonly string[]
}

/** 页面信息是路由名称、枚举注释和 Tab 注册的唯一来源。 */
export type PageMetadata = {
  /** 应用内唯一的稳定路由名称。 */
  readonly name: string
  /** 生成 PageEnum 枚举成员的注释；省略时使用路由名称。 */
  readonly description?: string
} & (
  | {
      /** 普通页面允许的查询参数及标量规则。 */
      readonly params?: Readonly<Record<string, RouteParamRule>>
      /** 普通页面不注册底栏项。 */
      readonly tabBar?: never
    }
  | {
      /** 声明即为 Tab 页；底栏标识默认使用页面名称。 */
      readonly tabBar: Omit<TabRouteMetadata, 'id'> & { readonly id?: string }
      /** 原生 Tab 路由不接受查询参数。 */
      readonly params?: never
    }
)

/** 页面编译期声明：路由身份、构建范围和原生配置各自独立。 */
export interface PageConfig<TNative extends NativePageConfig = WechatPageConfig> {
  /** 唯一名称、描述、参数或 Tab 展示信息，不写入原生 JSON。 */
  readonly page: PageMetadata
  /** 限定页面参与构建的环境，不在页面中指定平台。 */
  readonly build?: PageBuildConfig
  /** 公共原生页面字段；省略时由平台适配器补齐默认值。 */
  readonly config?: TNative
}

/** 全局 Skyline 选项，固定布局默认值并关闭灰度选择。 */
export interface SkylineOptions {
  /** 普通节点默认按块级元素布局，弹性布局显式声明 display: flex。 */
  defaultDisplayBlock: true
  /** 使用内容盒模型；需要边框盒的容器显式声明 box-sizing。 */
  defaultContentBox: true
  /** 所有受支持的客户端均启用 Skyline，不参与 A/B 灰度。 */
  disableABTest: true
  /** 项目支持的基础库版本下限。 */
  sdkVersionBegin: '3.0.0'
  /** 覆盖后续基础库版本，不人为缩小启用区间。 */
  sdkVersionEnd: '15.255.255'
}

/** 应用配置由构建器补齐 pages；现阶段不允许手工声明分包。 */
export interface AppConfig {
  /** 应用统一使用 Skyline 渲染器。 */
  renderer?: 'skyline'
  /** 应用统一使用 glass-easel 组件框架。 */
  componentFramework?: 'glass-easel'
  /** 按当前页面需要的组件加载代码。 */
  lazyCodeLoading?: 'requiredComponents'
  /** Skyline 渲染行为只允许在应用级配置。 */
  rendererOptions?: { skyline: SkylineOptions }
  /** 默认入口使用页面名称，路径由同一份页面元数据生成。 */
  entryPageName: string
  /** 原生入口路径由构建器生成，源配置不能手写。 */
  entryPagePath?: never
  /** 全局默认窗口配置。 */
  window?: WindowConfig
  /** 全局组件的路径映射。 */
  usingComponents?: Record<string, string>
  /** 微信组件样式版本。 */
  style?: 'v2'
  /** 搜索索引配置文件路径。 */
  sitemapLocation?: string
  /** 页面注册由构建器维护。 */
  pages?: never
  /** 分包需要先扩展页面发现规则。 */
  subPackages?: never
  /** 兼容拼写同样禁止手动分包注册。 */
  subpackages?: never
  /** 允许透传其余微信应用配置项。 */
  [key: string]: unknown
}
