// SPDX-License-Identifier: Apache-2.0
import { storeOptions } from './store/binding.js'
import { tabPageOptions } from './page/tab.js'
import type { StorePluginOptions, StorePluginStates } from './store/plugin.js'
import type { GlobalStoreState } from './store/global.js'
import type {
  Store,
  StoreSnapshot,
  StoreState,
} from './store/types.js'

/** 字面量开关提供确定成员，动态布尔值提供可选成员。 */
type Enabled<F extends boolean, K extends string, V> = [F] extends [true]
  ? { [P in K]: V }
  : [F] extends [false]
    ? {}
    : { [P in K]?: V }
/** 页面留白由编译后的底栏行为管理，不允许业务声明同名字段。 */
type TabReserved<IsPage extends boolean> = IsPage extends true ? { tabBarSpace?: never } : {}
/** 全局字段只来自项目公开定义。 */
type GlobalState = GlobalStoreState
/** 插件通过声明合并扩展开关与状态，新增插件不修改包装器泛型。 */
type PluginFlags = { [K in keyof StorePluginStates]?: boolean }
/** 缺省参与开关全部关闭，避免由泛型约束产生可选门面。 */
type DisabledPlugins = {}
/** 业务不能占用已声明插件或全局门面的名称。 */
type Reserved = {
  [K in '$globalStore' | `$${keyof StorePluginStates & string}`]?: never
}
/** 只从注册表中的键推导插件开关，避免 const 泛型将业务 data 收窄为只读字面量。 */
type StoreOptions<
  GF extends boolean,
  S extends StoreState,
  F extends PluginFlags,
> = {
  globalStore?: GF
} & StorePluginOptions<S> & { [K in keyof F & keyof StorePluginStates]: F[K] }
/** 各插件自行关联实例状态，包装器不按插件名称分支。 */
type PluginState<
  K extends keyof StorePluginStates,
  S extends StoreState,
> = Extract<StorePluginStates<S>[K], StoreState>
/** 字面量开启提供必选门面，动态开关提供可选门面，关闭和省略不提供。 */
type PluginMembers<F extends PluginFlags, S extends StoreState> = {
  [K in keyof F & keyof StorePluginStates as F[K] extends true
    ? `$${K & string}`
    : never]: Store<PluginState<K, S>>
} & {
  [K in keyof F & keyof StorePluginStates as F[K] extends true
    ? never
    : true extends F[K]
      ? `$${K & string}`
      : never]?: Store<PluginState<K, S>>
}
/** 全局公开区与注册插件的门面分别按开关推导。 */
type StoreMembers<
  GF extends boolean,
  S extends StoreState,
  F extends PluginFlags,
> = Enabled<GF, '$globalStore', Store<GlobalState>> & PluginMembers<F, S>
/** 只有全局状态自动提供模板快照，页面数据统一通过 on 投影。 */
type GlobalData<GF extends boolean> = Enabled<
  GF,
  '$globalStore',
  StoreSnapshot<GlobalState>
>
/** 重新提供 this 上下文，避免公开数据类型要求业务手动声明框架快照。 */
type Options<
  D extends WechatMiniprogram.Component.DataOption,
  P extends WechatMiniprogram.Component.PropertyOption,
  M extends WechatMiniprogram.Component.MethodOption,
  B extends WechatMiniprogram.Component.BehaviorOption,
  GF extends boolean,
  S extends StoreState,
  F extends PluginFlags,
  IsPage extends boolean,
> = Omit<
  WechatMiniprogram.Component.Options<D, P, M, B, {}, IsPage>,
  'data' | 'properties' | 'methods'
> & {
  data?: D & Reserved & TabReserved<IsPage>
  properties?: P & Reserved & TabReserved<IsPage>
  /** 保留具体方法签名，由函数泛型约束校验，避免整组选项退化为 never。 */
  methods?: { [K in keyof M]: M[K] } & Reserved &
    (IsPage extends true ? Partial<WechatMiniprogram.Page.ILifetime> : {})
} & StoreOptions<GF, S, F> &
  Reserved &
  ThisType<
    WechatMiniprogram.Component.Instance<
      D & GlobalData<GF> & (IsPage extends true ? { tabBarSpace?: number } : {}),
      P,
      M,
      B,
      StoreMembers<GF, S, F> &
        (IsPage extends true ? WechatMiniprogram.Page.InstanceProperties : {}),
      IsPage
    >
  >

/** 页面选项沿用 Component 结构，并提供页面生命周期及路由实例类型。 */
export type PageOptions<
  D extends WechatMiniprogram.Component.DataOption,
  P extends WechatMiniprogram.Component.PropertyOption,
  M extends WechatMiniprogram.Component.MethodOption,
  B extends WechatMiniprogram.Component.BehaviorOption,
  GF extends boolean = false,
  S extends StoreState = StoreState,
  F extends PluginFlags = DisabledPlugins,
> = Options<D, P, M, B, GF, S, F, true>

/** 组件类型保留原生数据、属性、方法和行为推导，不混入页面字段。 */
export type ComponentOptions<
  D extends WechatMiniprogram.Component.DataOption,
  P extends WechatMiniprogram.Component.PropertyOption,
  M extends WechatMiniprogram.Component.MethodOption,
  B extends WechatMiniprogram.Component.BehaviorOption,
  GF extends boolean = false,
  S extends StoreState = StoreState,
  F extends PluginFlags = DisabledPlugins,
> = Options<D, P, M, B, GF, S, F, false>

/** 通过 Component 注册页面，内部归属与 Store 接入在业务生命周期前完成。 */
export function definePage<
  D extends WechatMiniprogram.Component.DataOption = {},
  P extends WechatMiniprogram.Component.PropertyOption = {},
  M extends WechatMiniprogram.Component.MethodOption = {},
  B extends WechatMiniprogram.Component.BehaviorOption = [],
  const GF extends boolean = false,
  S extends StoreState = StoreState,
  const F extends PluginFlags = DisabledPlugins,
>(
  options: PageOptions<D, P, M, B, GF, S, F>,
): WechatMiniprogram.Component.Identifier<D, P, M>
/** 第二参数仅由 CLI 注入，公开签名只接受业务选项。 */
export function definePage(options: object, compiledTabPage = false): WechatMiniprogram.Component.Identifier {
  return Component(storeOptions(tabPageOptions(options, compiledTabPage), true))
}

/** 通过 Component 注册组件，关闭所有参与项的普通组件不附加 Store 生命周期。 */
export function defineComponent<
  D extends WechatMiniprogram.Component.DataOption = {},
  P extends WechatMiniprogram.Component.PropertyOption = {},
  M extends WechatMiniprogram.Component.MethodOption = {},
  B extends WechatMiniprogram.Component.BehaviorOption = [],
  const GF extends boolean = false,
  S extends StoreState = StoreState,
  const F extends PluginFlags = DisabledPlugins,
>(
  options: ComponentOptions<D, P, M, B, GF, S, F>,
): WechatMiniprogram.Component.Identifier<D, P, M> {
  return Component(
    storeOptions(tabPageOptions(options, false), false) as WechatMiniprogram.Component.Options<
      D,
      P,
      M,
      B
    >,
  )
}
