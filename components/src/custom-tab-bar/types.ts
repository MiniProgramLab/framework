/** 导航项以稳定 id 标识，排序和文案变化不会改变选中身份。 */
export interface CustomTabItem {
  /** 当前组件内唯一的业务标识。 */
  id: string
  /** 标签及无障碍名称，隐藏标签时仍保留。 */
  text: string
  /** 透明背景的图标形状，支持本地路径或允许的远程地址，颜色由主题统一生成。 */
  iconPath: string
  /** 可选的选中图标形状；省略时沿用普通图标。 */
  selectedIconPath?: string
  /** 原生模式跳转已注册的 Tab 页；独立模式仅透传此字段。 */
  pagePath?: string
  /** 数字零不显示，正数超过 99 显示 99+；短文本原样展示。 */
  badge?: string | number
  dot?: boolean
  disabled?: boolean
  hidden?: boolean
}

/** 尺寸统一使用 rpx，组件测量后将动画位置转换成逻辑像素。 */
export interface CustomTabLayout {
  /** fixed 为悬浮底栏，inline 为父容器中的局部分段导航。 */
  position: 'fixed' | 'inline'
  width: number
  height: number
  horizontalInset: number
  bottomGap: number
  padding: number
  radius: number
  iconSize: number
  labelSize: number
  safeArea: boolean
  zIndex: number
}

/** 仅开放两种不透明基础色，其他颜色由组件混合生成；支持 #RGB 和 #RRGGBB。 */
export interface CustomTabTheme {
  /** 文字主色，同时用于选中的文字、图标与角标底色。 */
  color: string
  /** 底栏背景色。 */
  background: string
}

/** 前端弹簧与形变共用基础物理参数，后端按黏性调整，运行时可直接调整手感。 */
export interface CustomTabMotion {
  enabled: boolean
  reducedMotion: boolean
  stiffness: number
  damping: number
  mass: number
  /** 按住时选中块略微放大，图标仍使用轻量的按压收缩。 */
  pressScale: number
  /** 两端位移差决定流体拉伸，0 关闭拉伸。 */
  stretch: number
  /** 越过两端时的弹性阻力，0 完全限制在边界。 */
  edgeResistance: number
  dragThreshold: number
  /** 后端跟随的滞后程度，0 同步移动，1 形成更明显的流体拉伸。 */
  viscosity: number
  /** 松手速度继承比例，0 忽略手势惯性。 */
  velocityInfluence: number
  /** 按压与回弹时的最大浮起幅度，单位为逻辑像素。 */
  lift: number
}

/** 单次回弹的归一化起点，可跨不同宽度的原生 Tab 实例接续。 */
export interface CustomTabAnimation {
  startedAt: number
  head: number
  tail: number
  headVelocity: number
  tailVelocity: number
  target: number
  press: number
  kick: number
  /** 使用开始时的物理参数，避免跨页时曲线发生变化。 */
  motion: CustomTabMotion
}

/** 完整配置可序列化，可通过属性或实例方法更新。 */
export interface CustomTabBarConfig {
  items: CustomTabItem[]
  showLabel: boolean
  enableDrag: boolean
  haptics: boolean
  hidden: boolean
  layout: CustomTabLayout
  theme: CustomTabTheme
  motion: CustomTabMotion
}

/** 顶层按字段更新，layout、theme、motion 合并，items 整体替换。 */
export type CustomTabBarPatch = Partial<
  Omit<CustomTabBarConfig, 'layout' | 'theme' | 'motion'>
> & {
  layout?: Partial<CustomTabLayout>
  theme?: Partial<CustomTabTheme>
  motion?: Partial<CustomTabMotion>
}

/** 交互事件的 index 对应当前可见项，业务应优先使用 id。 */
export interface CustomTabChange {
  id: string
  previousId: string
  index: number
  item: CustomTabItem
  source: 'tap' | 'drag' | 'api'
  /** 用户手势在 UI 线程提交时携带真实动画起点，业务通常无需读取。 */
  animation?: CustomTabAnimation
}

/** getTabBar 或 selectComponent 获取的同一组件契约，支持 TS 动态调节。 */
export interface CustomTabBarRef
  extends WechatMiniprogram.Component.TrivialInstance {
  /** 原生 Tab 页在 onShow 中同步所属路由，独立模式忽略此调用。 */
  syncRoute(route: string): void
  /** 校验后原子更新配置；原生模式同步所有 Tab 页，独立模式只更新自身。 */
  configure(patch: CustomTabBarPatch): void
  /** 整体替换导航项，选中项被移除时回到首个可用项。 */
  setItems(items: CustomTabItem[]): void
  /** 按稳定 id 调整文案、图标、角标、禁用或隐藏状态。 */
  updateItem(id: string, patch: Partial<Omit<CustomTabItem, 'id'>>): void
  /** 程序选中默认不派发事件；animate=false 用于初始路由同步。 */
  setValue(id: string, emit?: boolean, animate?: boolean): boolean
  /** 原生 Tab 多实例可按开始时间接续回弹，未完成测量时返回 false。 */
  resumeTransition(
    fromId: string,
    toId: string,
    startedAt: number,
    animation?: CustomTabAnimation,
  ): boolean
  /** 返回配置副本，修改副本不会意外影响组件。 */
  getConfig(): CustomTabBarConfig
}
