// SPDX-License-Identifier: Apache-2.0
/** 路由参数的标量类型与必填规则，构建期和运行时共用。 */
export interface RouteParamRule {
  /** 参数的运行时类型。 */
  readonly type: 'string' | 'number' | 'boolean'
  /** 省略时是否拒绝导航。 */
  readonly required?: boolean
}

/** 页面配置中的原生底栏展示信息。 */
export interface TabRouteMetadata {
  /** 稳定的底栏项标识。 */
  readonly id: string
  /** 显示文字。 */
  readonly text: string
  /** 默认图标路径。 */
  readonly iconPath: string
  /** 选中时的图标路径。 */
  readonly selectedIconPath?: string
  /** 显式排序位置。 */
  readonly order: number
}

/** CLI 或应用提供的单条运行时路由，不依赖任何平台全局类型。 */
export interface RouteDefinition {
  /** 必须与路由表的键一致。 */
  readonly name: string
  /** 页面说明，可供导航界面或开发工具读取。 */
  readonly description?: string
  /** 以斜线开头的编译后页面路径，包含当前环境未启用的声明。 */
  readonly path: string
  /** 决定导航方式的页面种类。 */
  readonly kind: 'page' | 'tab'
  /** 当前环境是否启用。 */
  readonly available: boolean
  /** 当前页面允许的查询参数。 */
  readonly params: Readonly<Record<string, RouteParamRule>>
}

/** 每个 Router 实例独立接收一份路由表。 */
export type RouteTable = Readonly<Record<string, RouteDefinition>>
/** 从具体路由表推导页面名称。 */
export type RouteName<R extends RouteTable> = Extract<keyof R, string>
/** 从具体路由表推导 Tab 页面名称。 */
export type TabPageName<R extends RouteTable> = {
  [N in RouteName<R>]: R[N]['kind'] extends 'tab' ? N : never
}[RouteName<R>]
/** 从具体路由表推导编译后的页面路径，可直接接收生成的枚举值。 */
export type RoutePath<R extends RouteTable> = R[RouteName<R>]['path']
/** 原生 Tab 页的具体路径。 */
export type TabPagePath<R extends RouteTable> = R[TabPageName<R>]['path']
/** 枚举成员可赋给路径字面量，通过路径反查精确的参数规则。 */
type DefinitionAtPath<R extends RouteTable, P extends RoutePath<R>> = {
  [N in RouteName<R>]: P extends R[N]['path'] ? R[N] : never
}[RouteName<R>]
/** 将契约中的标量声明转换为调用值类型。 */
type ParamValue<T> = T extends { type: 'number' } ? number : T extends { type: 'boolean' } ? boolean : string
/** 保留每个页面参数的必填、可选与值类型。 */
export type RouteParams<R extends RouteTable, P extends RoutePath<R>, S = DefinitionAtPath<R, P>['params']> = {
  [K in keyof S as S[K] extends { required: true } ? K : never]: ParamValue<S[K]>
} & {
  [K in keyof S as S[K] extends { required: true } ? never : K]?: ParamValue<S[K]>
}
/** 没有参数的页面不接受查询对象，必填参数不能省略。 */
export type RouteArguments<R extends RouteTable, P extends RoutePath<R>> = keyof RouteParams<R, P> extends never
  ? [] : {} extends RouteParams<R, P> ? [params?: RouteParams<R, P>] : [params: RouteParams<R, P>]

/** 一次导航实际选择的宿主动作。 */
export type NavigationMethod = 'navigateTo' | 'redirectTo' | 'switchTab' | 'reLaunch'
/** 统一的失败信息，保留平台原始原因以便诊断。 */
export interface NavigationError {
  /** 失败发生在地址校验还是平台执行阶段。 */
  readonly phase: 'resolve' | 'navigate'
  /** 调用方传入的页面地址，独立返回操作记为 navigateBack。 */
  readonly target: string
  /** 可供日志或统一提示读取的说明。 */
  readonly message: string
  /** 原始校验错误或平台错误对象。 */
  readonly cause: unknown
}
/** 只有显式等待导航时才需要读取结果，失败不会拒绝 Promise。 */
export type NavigationResult =
  | { readonly ok: true; readonly url: string; readonly method: NavigationMethod }
  | { readonly ok: false; readonly error: NavigationError }

/** 成功回调仅接收已经完成的平台导航回执。 */
export type NavigationSuccess = Extract<NavigationResult, { ok: true }>
/** 支持同步或异步成功处理，回调异常不改变导航结果。 */
export type NavigationSuccessHandler = (result: NavigationSuccess) => void | Promise<void>
/** 失败回调接收校验或平台执行产生的统一错误。 */
export type NavigationFailHandler = (error: NavigationError) => void | Promise<void>

/** 回调模式的执行标记，不提供可等待的 Promise 契约。 */
export interface NavigationCallbackExecution {
  /** 拒绝 await 和 Promise 同化；该方法不能直接调用。 */
  then(onfulfilled: never): never
}

/** 注册任意回调后只能通过回调消费结果，未注册时返回 Promise。 */
type NavigationExecutionResult<Result, WithCallbacks extends boolean> = WithCallbacks extends true
  ? NavigationCallbackExecution : Promise<Result>

/** 回调注册保持页面和参数状态，并将新分支切换为回调模式。 */
interface NavigationCallbacks<R extends RouteTable, P extends RoutePath<R>, Ready extends boolean> {
  /** 设置成功回调，重复设置时覆盖当前链的同类回调。 */
  success(handler: NavigationSuccessHandler): NavigationBuilder<R, P, Ready, true>
  /** 设置失败回调，重复设置时覆盖当前链的同类回调。 */
  fail(handler: NavigationFailHandler): NavigationBuilder<R, P, Ready, true>
}

/** 必填参数齐备后才允许打开或替换页面。 */
interface NavigationExecution<WithCallbacks extends boolean> {
  /** 发起普通页面入栈或 Tab 切换，仅无回调模式允许等待结果。 */
  go(): NavigationExecutionResult<NavigationResult, WithCallbacks>
  /** 替换当前普通页面，目标为 Tab 时切换底栏。 */
  replace(): NavigationExecutionResult<NavigationResult, WithCallbacks>
  /** 重建页面栈并打开目标页，目标为 Tab 时切换底栏。 */
  reLaunch(): NavigationExecutionResult<NavigationResult, WithCallbacks>
}

/** 按选定页面收窄参数；Tab 和未声明参数的页面不暴露 params。 */
export type NavigationBuilder<R extends RouteTable, P extends RoutePath<R>, Ready extends boolean = false, WithCallbacks extends boolean = false> =
  P extends RoutePath<R>
    ? NavigationCallbacks<R, P, Ready>
      & (P extends TabPagePath<R> ? unknown : keyof RouteParams<R, P> extends never ? unknown : {
        /** 一次设置完整参数快照，字段提示来自已选页面；再次调用时整体替换。 */
        params(values: RouteParams<R, P>): NavigationBuilder<R, P, true, WithCallbacks>
      })
      & (Ready extends true ? NavigationExecution<WithCallbacks> : {} extends RouteParams<R, P> ? NavigationExecution<WithCallbacks> : unknown)
    : never

/** 完整 URL 已携带查询参数，执行时统一解码并校验，不再提供 params。 */
export interface NavigationUrlBuilder<WithCallbacks extends boolean = false> extends NavigationExecution<WithCallbacks> {
  /** 设置成功回调，派生链进入不可等待的回调模式。 */
  success(handler: NavigationSuccessHandler): NavigationUrlBuilder<true>
  /** 设置失败回调，解析失败与平台失败使用同一错误模型。 */
  fail(handler: NavigationFailHandler): NavigationUrlBuilder<true>
}

/** 返回操作没有目标 URL，回执记录调用方请求的返回层数。 */
export interface NavigationBackSuccess {
  /** 原生返回操作已经成功。 */
  readonly ok: true
  /** 实际使用的原生导航动作。 */
  readonly method: 'navigateBack'
  /** 请求返回的层数，超过页面栈长度时沿用平台行为。 */
  readonly delta: number
}
/** 返回上一页同样以结果对象表达失败，不拒绝 Promise。 */
export type NavigationBackResult = NavigationBackSuccess | { readonly ok: false; readonly error: NavigationError }
/** 返回成功不伪造目标 URL，回调读取返回动作及请求层数。 */
export type NavigationBackSuccessHandler = (result: NavigationBackSuccess) => void | Promise<void>
/** 独立返回链仅允许回调和执行，不接受页面路径、参数或替换操作。 */
export interface NavigationBackBuilder<WithCallbacks extends boolean = false> {
  /** 设置本条返回链的成功回调。 */
  success(handler: NavigationBackSuccessHandler): NavigationBackBuilder<true>
  /** 设置本条返回链的失败回调。 */
  fail(handler: NavigationFailHandler): NavigationBackBuilder<true>
  /** 执行原生返回，仅无回调模式允许等待结果。 */
  go(): NavigationExecutionResult<NavigationBackResult, WithCallbacks>
}

/** 运行时平台协议，与 Node.js 中的构建适配器相互独立。 */
export interface NavigationAdapter {
  /** 在当前页面栈中打开普通页面。 */
  navigateTo(url: string): Promise<void>
  /** 替换当前页面；平台未提供此能力时返回统一失败结果。 */
  redirectTo?(url: string): Promise<void>
  /** 返回指定层数，按平台能力选择实现。 */
  navigateBack?(delta: number): Promise<void>
  /** 切换原生 Tab 页面。 */
  switchTab(url: string): Promise<void>
  /** 重建页面栈并打开普通页面。 */
  reLaunch(url: string): Promise<void>
}

/** Router 初始化所需的路由数据与执行能力。 */
export interface RouterOptions<R extends RouteTable> {
  /** 保留字面量类型的路由表。 */
  routes: R
  /** 必须是路由表中的已启用页面，且不能要求必填参数。 */
  entryPageName: NoInfer<RouteName<R>>
  /** 默认使用 CLI 编译时选择的平台，测试或自定义宿主可显式注入。 */
  adapter?: NavigationAdapter
}

/** 类型化路由实例；日常导航不要求 async、await 或 try/catch。 */
export interface Router<R extends RouteTable> {
  /** 判断路径在当前环境是否启用。 */
  isRouteAvailable(path: RoutePath<R>): boolean
  /** 生成可分享 URL；无效输入记录诊断并返回 undefined。 */
  getRouteUrl<P extends RoutePath<R>>(path: P, ...args: RouteArguments<R, NoInfer<P>>): string | undefined
  /** 选择目标页并创建独立导航链，仅在调用终结方法时执行。 */
  navigateTo<P extends RoutePath<R>>(path: P): NavigationBuilder<R, P>
  /** 从完整应用内 URL 创建导航链，查询参数在执行时按路由契约校验。 */
  navigateToUrl(url: string): NavigationUrlBuilder
  /** 创建返回链，默认返回上一页；执行时验证层数必须为正整数。 */
  navigateBack(delta?: number): NavigationBackBuilder
  /** 取得已在初始化时校验过的默认入口 URL。 */
  getEntryRouteUrl(): string
}

/** 可注册的平台导航适配器，平台名称与别名在同一实例内必须唯一。 */
export interface PlatformNavigationAdapter extends NavigationAdapter {
  /** 规范平台名，例如 wechat、douyin、alipay。 */
  readonly id: string
  /** 同一实现允许使用的短名称。 */
  readonly aliases?: readonly string[]
}

/** 原生回调导航的最小参数，不依赖平台的全局类型声明。 */
export interface NativeNavigationOptions {
  /** 已完成校验与编码的页面地址。 */
  url: string
  /** 原生导航成功。 */
  success(): void
  /** 原样保留平台错误对象。 */
  fail(reason: unknown): void
}

/** 原生返回只接收层数与回调，不接受 URL 或查询参数。 */
export interface NativeNavigateBackOptions {
  /** 需要关闭的页面数量。 */
  delta: number
  /** 原生返回成功。 */
  success(): void
  /** 保留原生返回失败原因。 */
  fail(reason: unknown): void
}

/** 当前三个平台共用的回调形状，各平台子入口独立绑定宿主。 */
export interface NativeNavigationApi {
  /** 打开普通页面。 */
  navigateTo(options: NativeNavigationOptions): void
  /** 替换当前页面，按需检查宿主是否提供此能力。 */
  redirectTo?(options: NativeNavigationOptions): void
  /** 返回指定页面层数，按需检查宿主是否提供此能力。 */
  navigateBack?(options: NativeNavigateBackOptions): void
  /** 切换底栏页面。 */
  switchTab(options: NativeNavigationOptions): void
  /** 重建页面栈。 */
  reLaunch(options: NativeNavigationOptions): void
}
