// SPDX-License-Identifier: Apache-2.0
/** Store 可保存的普通可序列化值。 */
export type StoreValue =
  | null
  | boolean
  | number
  | string
  | StoreValue[]
  | { [key: string]: StoreValue }
/** 未指定具体结构时使用的可序列化状态类型。 */
export type StoreState = Record<string, StoreValue>
/** 初始定义不能占用任何插件私有字段，新增插件不修改此约束。 */
export type StoreInitialState<S extends StoreState> = S & {
  [K in `__${string}__`]?: never
}
/** 响应快照递归只读，不能反向修改 Store。 */
export type StoreSnapshot<S> = {
  readonly [K in keyof S]: S[K] extends object ? StoreSnapshot<S[K]> : S[K]
}
/** 响应函数只接收所属区域的前后快照，初次响应没有前值。 */
export type StoreListener<S> = (
  next: StoreSnapshot<S>,
  previous: StoreSnapshot<S> | undefined,
) => void
/** 初次展示可选择立即接收当前已提交数据。 */
export interface StoreOnOptions {
  readonly immediate?: boolean
}
/** 业务门面严格限定为更新与响应两个方法。 */
export interface Store<S extends object> {
  /** 对象按顶层合并，同步草稿可同时更新多个字段。 */
  update(change: Partial<S> | ((draft: S) => void)): boolean
  /** 订阅成功的数据变更，取消函数可重复调用，卸载时自动清理。 */
  on(listener: StoreListener<S>, options?: StoreOnOptions): () => void
}
/** 定义标记只参与类型推导，不在运行时公开工厂或状态。 */
declare const definitionType: unique symbol
/** 定义与实例分离，各模块通过种类标记区分自己的定义。 */
export interface StoreDefinition<S extends object, K extends string> {
  readonly [definitionType]: { readonly state: S; readonly kind: K }
}
/** 从纯定义提取业务状态类型。 */
export type StoreStateOf<D> =
  D extends StoreDefinition<infer S, string> ? S : StoreState
