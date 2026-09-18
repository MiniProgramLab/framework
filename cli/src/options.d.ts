/** 独立小程序项目的构建配置，路径均相对项目根目录。 */
export interface SkylineConfig {
  /** 小程序源码目录，默认 src。 */
  source?: string
  /** 微信开发者工具导入目录，默认 dist。 */
  outDir?: string
  /** 输出到根 custom-tab-bar/index 的原生组件包路径。 */
  customTabBar?: string
  /** 额外监听的依赖目录。 */
  watchDirectories?: string[]
  /** 主动使用轮询监听；原生监听失败时也会自动回退。 */
  poll?: boolean
}

/** 声明构建配置并提供编辑器类型提示。 */
export function defineConfig(config: SkylineConfig): SkylineConfig
