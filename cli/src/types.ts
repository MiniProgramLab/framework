// SPDX-License-Identifier: Apache-2.0
import type { RouteParamRule, TabRouteMetadata } from '@miniprogramlab/core/router/types'

/** 原生配置允许各平台声明自身字段，适配器负责其语义校验。 */
export type NativeConfig = Record<string, any>

/** 构建时可公开注入的环境，应用身份不进入脚本。 */
export interface PublicEnvironment {
  /** 当前编译环境。 */
  mode: string
  /** 注册表解析后的平台名称。 */
  platform: string
  /** 公开 API 根地址。 */
  apiBaseUrl: string
  /** 应用标题。 */
  title: string
}

/** 适配器接收的环境信息。 */
export interface BuildEnvironment {
  /** 已解析的平台钩子，保留自定义适配器身份。 */
  adapter?: PlatformAdapter
  /** 可进入小程序产物的公开字段。 */
  public: PublicEnvironment
  /** 仅供工程配置使用的应用身份。 */
  appid: string
}

/** 已发现的路由与底栏元数据。 */
export interface DiscoveredRoute {
  /** 稳定路由名称。 */
  name: string
  /** 用于路由枚举注释的页面说明。 */
  description: string
  /** 相对源码目录且不含扩展名的原生路径。 */
  path: string
  /** 页面类型。 */
  kind: 'page' | 'tab'
  /** 当前环境是否启用。 */
  available: boolean
  /** 原生底栏配置，普通页面不提供。 */
  tab?: TabRouteMetadata
  /** 路由运行时和配置声明共用参数契约。 */
  params: Record<string, RouteParamRule>
}

/** 完整的平台构建协议，新增平台无需修改公共编译流程。 */
export interface PlatformAdapter {
  /** 追加独立调用的公开 API 模块；使用小驼峰名称，成员名称不能冲突。 */
  apiModules?: readonly string[]
  /** 唯一名称，如 wechat。 */
  id: string
  /** 命令行可接受的别名。 */
  aliases?: readonly string[]
  /** 构建日志中的平台名称。 */
  label: string
  /** 原生模板扩展名，包含点号。 */
  templateExtension: string
  /** 原生样式扩展名，包含点号。 */
  styleExtension: string
  /** 开发者工具的工程配置文件名。 */
  projectFile: string
  /** 如有私有配置，则仅首次初始化，后续保持原位。 */
  privateConfigFile?: 'project.private.config.json'
  /** 平台环境变量前缀。 */
  envPrefix: string
  /** 平台专用公开环境常量。 */
  envGlobal: string
  /** 是否支持微信 Worklet 依赖内联。 */
  worklets?: boolean
  /** 校验应用原生配置。 */
  validateApp(config: NativeConfig, filename: string): void
  /** 校验组件或页面原生配置。 */
  validateConfig(config: NativeConfig, filename: string): void
  /** 可选的工程配置校验。 */
  validateProject?(config: NativeConfig, filename: string): void
  /** 转换页面配置。 */
  pageConfig(config: NativeConfig, filename: string): NativeConfig
  /** 生成应用原生入口与底栏字段。 */
  appConfig(config: NativeConfig, context: { entry: DiscoveredRoute; tabs: (DiscoveredRoute & { tab: NonNullable<DiscoveredRoute['tab']> })[]; pages: string[] }): NativeConfig
  /** 生成开发者工具工程配置。 */
  projectConfig(config: NativeConfig, environment: BuildEnvironment): NativeConfig
  /** 检查底栏入口和原生注册要求；pageConfigs 以不带后缀的页面绝对路径为键。 */
  validateTabs(config: NativeConfig, context: { source: string; pages: string[]; pageConfigs: Map<string, NativeConfig>; environment: BuildEnvironment; packageEntry?: string }): void | Promise<void>
  /** 在模块解析前检查原生依赖的兼容性。 */
  validateDependency?(reference: string): void
  /** 平台固定原生入口的组件包与输出位置。 */
  nativeEntries?(config: NativeConfig, options: PlatformBuildConfig): { reference: string; destination: string }[]
  /** 按需提供 definePage、defineComponent 注入模块。 */
  runtime?(context: { root: string; source: string }): string | Promise<string>
  /** 路由导航模块，需导出 createNavigationAdapter；相对路径基于消费项目根目录。 */
  navigationAdapter?: string
}

/** 可针对不同平台覆盖的项目选项，路径均相对项目根目录。 */
export interface PlatformBuildConfig {
  /** 小程序源码目录，默认 src。 */
  source?: string
  /** 产物目录；微信默认 dist，其他平台默认 dist-平台名。 */
  outDir?: string
  /** 开发者工具源配置文件，默认由适配器提供文件名。 */
  projectConfig?: string
  /** 微信原生 custom-tab-bar/index 对应的组件包路径。 */
  customTabBar?: string
  /** 额外监听的依赖目录。 */
  watchDirectories?: string[]
  /** 主动使用轮询监听；原生监听失败时也会自动回退。 */
  poll?: boolean
}

/** 注册型小程序构建配置，省略平台时默认为微信。 */
export interface MiniProgramConfig extends PlatformBuildConfig {
  /** 默认目标平台，命令行 --platform 优先。 */
  platform?: string
  /** 按注册平台名称选择配置覆盖，别名会先归一化。 */
  platforms?: Record<string, PlatformBuildConfig>
  /** 当前项目额外注册的适配器，不能覆盖已有名称或别名。 */
  platformAdapters?: PlatformAdapter[]
}

/** 命令行解析后的原始参数。 */
export interface CliArguments {
  /** 项目根目录。 */
  root?: string
  /** 构建配置文件。 */
  config?: string
  /** 源码目录覆盖。 */
  src?: string
  /** 产物目录覆盖。 */
  'out-dir'?: string
  /** 目标平台名称或别名。 */
  platform?: string
  /** 构建环境。 */
  mode?: string
  /** 是否监听。 */
  watch?: boolean
  /** 是否执行类型检查。 */
  typecheck?: boolean
  /** 是否轮询。 */
  poll?: boolean
}

/** 公共编译流程使用的已解析配置。 */
export interface BuildOptions extends PlatformBuildConfig {
  /** 项目根目录的绝对路径。 */
  root: string
  /** 源码绝对路径。 */
  source: string
  /** 产物绝对路径。 */
  output: string
  /** 平台规范名称。 */
  platform: string
  /** 隔离注册表解析出的平台适配器。 */
  adapter: PlatformAdapter
  /** 编译环境。 */
  mode: string
  /** 是否持续监听。 */
  watch: boolean
  /** 是否执行 TypeScript 检查。 */
  typecheck: boolean
  /** 实际加载的 CLI 配置路径。 */
  configFile: string
}
